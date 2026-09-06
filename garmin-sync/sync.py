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
            laps = get_laps_cached(client, activity_id)
            if laps and len(laps) > 1:
                entry["laps"] = laps
            download_fit_cached(client, activity_id)
            time.sleep(0.5)  # non martellare l'API Garmin

        entries.append(entry)

    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


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

    print("Sincronizzazione completata.")


if __name__ == "__main__":
    main()
