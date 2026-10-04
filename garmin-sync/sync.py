"""Scarica dati da Garmin Connect e li scrive come JSON in /app/output (montato su data/ del repo).

Primo avvio: eseguire manualmente (`docker compose run --rm garmin-sync`) da un terminale,
cosi' se Garmin richiede un codice MFA lo si puo' inserire a mano. Il token di sessione viene
salvato in /app/.garmin-session (montato su garmin-sync/.garmin-session) e riusato dalle
esecuzioni automatiche successive senza richiedere di nuovo le credenziali.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
import zipfile
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv()

EMAIL = os.environ.get("GARMIN_EMAIL")
PASSWORD = os.environ.get("GARMIN_PASSWORD")
TOKENSTORE = os.environ.get("GARMIN_TOKENSTORE", "/app/.garmin-session")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/app/output"))
DAYS_BACK = int(os.environ.get("DAYS_BACK", "35"))

LAPS_CACHE_DIR = Path(os.environ.get("LAPS_CACHE_DIR", "/app/laps-cache"))
EXERCISE_SETS_CACHE_DIR = Path(os.environ.get("EXERCISE_SETS_CACHE_DIR", "/app/exercise-sets-cache"))
FIT_DIR = Path(os.environ.get("FIT_DIR", "/app/fit-files"))
DOWNLOAD_FIT = os.environ.get("DOWNLOAD_FIT", "true").lower() == "true"

MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]


def label_it(d: date) -> str:
    return f"{d.day} {MESI_IT[d.month - 1]}"


def login() -> Garmin:
    client = Garmin()
    try:
        client.login(TOKENSTORE)
        print("Login riuscito riusando la sessione salvata.")
        return client
    except Exception as exc:
        print(f"Sessione salvata non valida o assente ({exc}), provo login con email/password...")
        if not EMAIL or not PASSWORD:
            print("GARMIN_EMAIL / GARMIN_PASSWORD mancanti nel file .env", file=sys.stderr)
            sys.exit(1)
        try:
            client = Garmin(
                EMAIL,
                PASSWORD,
                prompt_mfa=lambda: input("Inserisci il codice MFA Garmin: ").strip(),
            )
            client.login(TOKENSTORE)
        except TypeError:
            # Versioni piu' vecchie di garminconnect (es. su architetture senza
            # pacchetti precompilati per le dipendenze piu' recenti, come ARM
            # 32-bit) non accettano prompt_mfa, e client.login(tokenstore) con
            # un tokenstore valorizzato *carica soltanto* una sessione salvata
            # (non fa mai un login con credenziali). Bisogna passare da
            # client.garth.login() direttamente: l'MFA usa comunque input()
            # di default dentro garth, quindi funziona uguale in una sessione
            # interattiva. client.garth.dump() salva poi la sessione.
            client = Garmin(EMAIL, PASSWORD)
            client.garth.login(EMAIL, PASSWORD)
            client.garth.dump(TOKENSTORE)
        print(f"Login riuscito, sessione salvata in {TOKENSTORE}.")
        return client


def sync_weight(client: Garmin) -> list[dict]:
    end = date.today()
    start = end - timedelta(days=DAYS_BACK)
    raw = client.get_body_composition(start.isoformat(), end.isoformat())

    entries = []
    for item in raw.get("dateWeightList", []) or []:
        cal_date = item.get("calendarDate")
        if not cal_date:
            continue
        weight_g = item.get("weight")
        bone_g = item.get("boneMass")
        muscle_g = item.get("muscleMass")
        entries.append({
            "date": cal_date,
            "label": label_it(date.fromisoformat(cal_date)),
            "weight": round(weight_g / 1000, 1) if weight_g is not None else None,
            "fat": item.get("bodyFat"),
            "muscle": round(muscle_g / 1000, 1) if muscle_g is not None else None,
            "bone": round(bone_g / 1000, 1) if bone_g is not None else None,
            "water": item.get("bodyWater"),
        })

    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


def get_laps_cached(client: Garmin, activity_id: str) -> list[dict] | None:
    """Lap/split per-ripetuta (distanza, passo, FC). Cache locale: un'attivita' gia'
    scaricata in passato non viene richiesta di nuovo a Garmin (evita rate limiting)."""
    cache_file = LAPS_CACHE_DIR / f"{activity_id}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    try:
        raw = client.get_activity_splits(activity_id)
    except Exception as exc:
        print(f"  Lap non disponibili per l'attivita' {activity_id}: {exc}")
        return None

    laps = []
    for lap in raw.get("lapDTOs", []) or []:
        distance_m = lap.get("distance")
        duration_s = lap.get("duration")
        laps.append({
            "lap": lap.get("lapIndex"),
            "distance_m": round(distance_m, 1) if distance_m is not None else None,
            "duration_s": round(duration_s, 1) if duration_s is not None else None,
            "avg_pace_min_per_km": (
                round((duration_s / 60) / (distance_m / 1000), 2)
                if distance_m and duration_s and distance_m > 0
                else None
            ),
            "avg_hr": lap.get("averageHR"),
            "max_hr": lap.get("maxHR"),
        })

    LAPS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(laps, ensure_ascii=False, indent=2), encoding="utf-8")
    return laps


def get_exercise_sets_cached(client: Garmin, activity_id: str) -> list[dict] | None:
    """Serie svolte per esercizio (ripetizioni, peso, durata) delle sessioni di
    forza, usate dalla home per valutare l'aderenza al programma e i progressi
    rispetto alla sessione precedente dello stesso tipo. Cache locale come per
    i lap: un'attivita' gia' scaricata non viene richiesta di nuovo a Garmin."""
    cache_file = EXERCISE_SETS_CACHE_DIR / f"{activity_id}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    try:
        raw = client.get_activity_exercise_sets(activity_id)
    except Exception as exc:
        print(f"  Serie esercizi non disponibili per l'attivita' {activity_id}: {exc}")
        return None

    sets = (raw or {}).get("exerciseSets", [])
    EXERCISE_SETS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(sets, ensure_ascii=False, indent=2), encoding="utf-8")
    return sets


def download_fit_cached(client: Garmin, activity_id: str) -> None:
    """Salva il file FIT originale in locale (non versionato), utile per l'Editor FIT
    del sito. Non viene ri-scaricato se gia' presente."""
    if not DOWNLOAD_FIT:
        return
    fit_path = FIT_DIR / f"{activity_id}.fit"
    if fit_path.exists():
        return
    try:
        raw_zip = client.download_activity(activity_id, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
        with zipfile.ZipFile(io.BytesIO(raw_zip)) as zf:
            fit_names = [n for n in zf.namelist() if n.lower().endswith(".fit")]
            if not fit_names:
                return
            FIT_DIR.mkdir(parents=True, exist_ok=True)
            fit_path.write_bytes(zf.read(fit_names[0]))
    except Exception as exc:
        print(f"  FIT non disponibile per l'attivita' {activity_id}: {exc}")


SWIM_TYPES = ("lap_swimming", "open_water_swimming", "swimming")
SWIM_STYLES = {0: "freestyle", 1: "backstroke", 2: "breaststroke", 3: "butterfly", 4: "drill", 5: "mixed", 6: "im"}


def fit_lap_styles(fit_path: Path) -> list[str | None] | None:
    """Stile di nuoto di ogni lap (messaggi 'lap' del FIT, campo swim_style = 38), nello
    stesso ordine dei lap restituiti da Garmin. Lettura minimale del formato FIT, senza
    dipendenze: None se il file manca o non e' leggibile."""
    import struct

    if not fit_path.exists():
        return None
    try:
        b = fit_path.read_bytes()
        off = b[0]
        end = off + struct.unpack("<I", b[4:8])[0]
        defs: dict[int, tuple] = {}
        styles: list[str | None] = []
        while off < end:
            h = b[off]
            off += 1
            if h & 0x80:  # compressed timestamp: record dati senza definizione propria
                loc = (h >> 5) & 0x03
                is_def = False
            else:
                loc = h & 0x0F
                is_def = bool(h & 0x40)
            if is_def:
                off += 1
                little = b[off] == 0
                off += 1
                gnum = struct.unpack("<H" if little else ">H", b[off:off + 2])[0]
                off += 2
                nfields = b[off]
                off += 1
                fields = []
                for _ in range(nfields):
                    fields.append((b[off], b[off + 1]))
                    off += 3
                dev_size = 0
                if h & 0x20:
                    ndev = b[off]
                    off += 1
                    for _ in range(ndev):
                        dev_size += b[off + 1]
                        off += 3
                defs[loc] = (gnum, fields, dev_size)
            else:
                gnum, fields, dev_size = defs[loc]
                for num, size in fields:
                    if gnum == 19 and num == 38 and size == 1:
                        styles.append(SWIM_STYLES.get(b[off]))
                    off += size
                off += dev_size
        return styles
    except Exception as exc:
        print(f"  Stili di nuoto non leggibili da {fit_path.name}: {exc}")
        return None


def attach_swim_styles(activity_id: str, laps: list[dict]) -> None:
    styles = fit_lap_styles(FIT_DIR / f"{activity_id}.fit")
    if styles is None:
        return
    if len(styles) == len(laps):
        targets = laps
    else:
        # Garmin conta anche le pause come lap, il FIT a volte no: si allineano solo i lap con distanza.
        targets = [l for l in laps if l.get("distance_m")]
        styles = [s for s in styles if s]
        if len(styles) != len(targets):
            return
    for lap, style in zip(targets, styles):
        if style:
            lap["style"] = style


def sync_activities(client: Garmin) -> list[dict]:
    raw = client.get_activities(0, 60)  # ultime 60 attivita'

    cutoff = (date.today() - timedelta(days=DAYS_BACK)).isoformat()
    entries = []
    for a in raw or []:
        start_local = a.get("startTimeLocal", "")
        act_date = start_local.split(" ")[0] if start_local else None
        if not act_date or act_date < cutoff:
            continue
        activity_id = a.get("activityId")
        distance_m = a.get("distance")
        duration_s = a.get("duration")

        entry = {
            "date": act_date,
            "activity_id": activity_id,
            "type": (a.get("activityType") or {}).get("typeKey"),
            "name": a.get("activityName"),
            "distance_km": round(distance_m / 1000, 2) if distance_m else None,
            "duration_min": round(duration_s / 60, 1) if duration_s else None,
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "calories": a.get("calories"),
            "avg_pace_min_per_km": (
                round((duration_s / 60) / (distance_m / 1000), 2)
                if distance_m and duration_s and distance_m > 0
                else None
            ),
        }

        if activity_id:
            download_fit_cached(client, activity_id)
            laps = get_laps_cached(client, activity_id)
            if laps and len(laps) > 1:
                if entry["type"] in SWIM_TYPES:
                    attach_swim_styles(activity_id, laps)
                entry["laps"] = laps
            if entry["type"] == "strength_training":
                exercise_sets = get_exercise_sets_cached(client, activity_id)
                if exercise_sets:
                    entry["exercise_sets"] = exercise_sets
            time.sleep(0.5)  # non martellare l'API Garmin

        entries.append(entry)

    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


TRAINING_STATUS_CATEGORIES = (
    "NO_STATUS", "DETRAINING", "RECOVERY", "MAINTAINING",
    "PRODUCTIVE", "PEAKING", "OVERREACHING", "STRAINED", "UNPRODUCTIVE",
)


def sync_fitness(client: Garmin) -> dict:
    """VO2max e training status, usati dalla home per il consiglio di allenamento
    del giorno. Garmin non li ricalcola tutti i giorni: si cerca a ritroso finche'
    non si trova un valore valido."""
    today = date.today()
    vo2max_running = None
    vo2max_date = None
    for days_back in range(0, 14):
        d = today - timedelta(days=days_back)
        try:
            raw = client.get_max_metrics(d.isoformat())
        except Exception:
            continue
        if not raw:
            continue
        generic = (raw[0] or {}).get("generic") or {}
        v = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
        if v:
            vo2max_running = round(v, 1)
            vo2max_date = generic.get("calendarDate") or d.isoformat()
            break

    training_status_label = None
    training_status_category = None
    training_status_date = None
    acwr_ratio = None
    acwr_status = None
    try:
        raw = client.get_training_status(today.isoformat())
    except Exception:
        raw = None
    if raw:
        devices = (raw.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
        for device_data in devices.values():
            phrase = device_data.get("trainingStatusFeedbackPhrase") or ""
            training_status_label = phrase
            # La fase (es. "PRODUCTIVE") e' il prefisso della frase, che include
            # anche una variante numerica del messaggio (es. "PRODUCTIVE_3").
            for cat in TRAINING_STATUS_CATEGORIES:
                if phrase.startswith(cat):
                    training_status_category = cat
                    break
            training_status_date = device_data.get("calendarDate")
            load = device_data.get("acuteTrainingLoadDTO") or {}
            acwr_ratio = load.get("dailyAcuteChronicWorkloadRatio")
            acwr_status = load.get("acwrStatus")
            if device_data.get("primaryTrainingDevice"):
                break

    return {
        "vo2max_running": vo2max_running,
        "vo2max_date": vo2max_date,
        "training_status_label": training_status_label,
        "training_status_category": training_status_category,
        "training_status_date": training_status_date,
        "acwr_ratio": acwr_ratio,
        "acwr_status": acwr_status,
    }


def write_json(name: str, payload) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Scritto {path} ({len(payload) if isinstance(payload, list) else 'ok'} voci)")


def main() -> None:
    client = login()

    weight = sync_weight(client)
    write_json("garmin-weight.json", weight)

    activities = sync_activities(client)
    write_json("garmin-activities.json", activities)

    fitness = sync_fitness(client)
    write_json("garmin-fitness.json", fitness)

    print("Sincronizzazione completata.")


if __name__ == "__main__":
    main()
