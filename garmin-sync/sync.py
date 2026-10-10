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


SWIM_TYPES = ("lap_swimming", "open_water_swimming", "swimming")


def get_laps_cached(client: Garmin, activity_id: str, is_swim: bool = False) -> list[dict] | None:
    """Lap/split per-ripetuta (distanza, passo, FC; per il nuoto anche stile e tecnica).
    Cache locale: un'attivita' gia' scaricata in passato non viene richiesta di nuovo a
    Garmin (evita rate limiting). Le cache di nuoto scritte prima che si salvasse lo
    stile vengono rigenerate una volta."""
    cache_file = LAPS_CACHE_DIR / f"{activity_id}.json"
    cached = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else None
    if cached is not None and (not is_swim or any("style" in l for l in cached)):
        return cached

    try:
        raw = client.get_activity_splits(activity_id)
    except Exception as exc:
        print(f"  Lap non disponibili per l'attivita' {activity_id}: {exc}")
        return cached

    laps = []
    for lap in raw.get("lapDTOs", []) or []:
        distance_m = lap.get("distance")
        duration_s = lap.get("duration")
        entry = {
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
        }
        if is_swim:
            # Stile e flag "tecnica" come li mostra Garmin Connect (includono le correzioni
            # fatte dopo il caricamento, che nel FIT originale non ci sono).
            stroke = lap.get("swimStroke")
            entry["style"] = stroke.lower() if stroke else None
            if lap.get("swimDrill") == "DRILL":
                entry["drill"] = True
        laps.append(entry)

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
    try:
        EXERCISE_SETS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(sets, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"  Cache serie esercizi non scrivibile ({exc}): si continua senza.")
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
            laps = get_laps_cached(client, activity_id, entry["type"] in SWIM_TYPES)
            if laps and len(laps) > 1:
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


def _safe_connectapi(client: Garmin, path: str, params: dict | None = None):
    """Chiamata diretta all'API di Garmin Connect: se un dato non c'e' (dispositivo, giorno,
    versione della libreria) si prosegue senza, cosi' un campo mancante non blocca il sync."""
    try:
        return client.connectapi(path, params=params) if params else client.connectapi(path)
    except Exception as exc:
        print(f"  Dato non disponibile ({path.split('/')[-2] if path.count('/') > 1 else path}): {str(exc)[:80]}")
        return None


def sync_trends(client: Garmin, today: date) -> dict:
    """Prontezza all'allenamento e andamento delle prestazioni nel tempo (VO2max, previsioni
    di gara, FC a riposo), usati dal consiglio del giorno per valutare quanto spingere."""
    out: dict = {}

    # Prontezza (Training Readiness): l'ultimo valore di oggi, altrimenti di ieri.
    for days_back in (0, 1):
        d = (today - timedelta(days=days_back)).isoformat()
        raw = _safe_connectapi(client, f"/metrics-service/metrics/trainingreadiness/{d}")
        entries = [e for e in (raw or []) if isinstance(e, dict) and e.get("score") is not None]
        if entries:
            e = sorted(entries, key=lambda x: x.get("timestamp") or "")[-1]
            out["training_readiness"] = {
                "date": e.get("calendarDate") or d,
                "score": e.get("score"),
                "level": e.get("level"),
                "feedback": e.get("feedbackShort"),
                "recovery_time_min": e.get("recoveryTime"),  # minuti (4320 = 72 h)
                "acute_load": e.get("acuteLoad"),
                "acwr_feedback": e.get("acwrFactorFeedback"),
                "recovery_feedback": e.get("recoveryTimeFactorFeedback"),
                "hrv_weekly_avg": e.get("hrvWeeklyAverage"),
            }
            break

    # Storico del VO2max (corsa), fino a un anno.
    raw = None
    for span in (365, 120):
        raw = _safe_connectapi(client, f"/metrics-service/metrics/maxmet/daily/{(today - timedelta(days=span)).isoformat()}/{today.isoformat()}")
        if raw:
            break
    history = {}
    for item in raw or []:
        generic = (item or {}).get("generic") or {}
        v = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
        if v and generic.get("calendarDate"):
            history[generic["calendarDate"]] = round(v, 1)
    if history:
        out["vo2max_history"] = [{"date": k, "value": history[k]} for k in sorted(history)]

    # Previsioni di gara di Garmin: ultima e serie (un punto a settimana).
    display = getattr(client, "display_name", None)
    if display:
        latest = _safe_connectapi(client, f"/metrics-service/metrics/racepredictions/latest/{display}")
        if isinstance(latest, dict) and latest.get("time5K"):
            out["race_predictions"] = {
                "date": latest.get("calendarDate"), "time_5k_s": latest.get("time5K"), "time_10k_s": latest.get("time10K"),
                "time_half_s": latest.get("timeHalfMarathon"), "time_marathon_s": latest.get("timeMarathon"),
            }
        series = _safe_connectapi(client, f"/metrics-service/metrics/racepredictions/daily/{display}", {
            "fromCalendarDate": (today - timedelta(days=120)).isoformat(), "toCalendarDate": today.isoformat()})
        rows = [r for r in (series or []) if isinstance(r, dict) and r.get("time5K")]
        if rows:
            picked = rows[::7]
            if picked[-1] is not rows[-1]:
                picked.append(rows[-1])
            out["race_predictions_history"] = [
                {"date": r.get("calendarDate"), "time_5k_s": r.get("time5K"), "time_10k_s": r.get("time10K")} for r in picked]

        # FC a riposo, ultimi 14 giorni.
        rhr = _safe_connectapi(client, f"/userstats-service/wellness/daily/{display}", {
            "fromDate": (today - timedelta(days=14)).isoformat(), "untilDate": today.isoformat(), "metricId": 60})
        values = (((rhr or {}).get("allMetrics") or {}).get("metricsMap") or {}).get("WELLNESS_RESTING_HEART_RATE") or []
        if values:
            out["resting_hr"] = [{"date": v.get("calendarDate"), "value": v.get("value")} for v in values if v.get("value")]


    # Record personali dalla sezione "Record personali" di Connect (tempi in secondi).
    if display:
        prs = _safe_connectapi(client, f"/personalrecord-service/personalrecord/prs/{display}")
        keys = {1: "run_1k_s", 2: "run_mile_s", 3: "run_5k_s", 4: "run_10k_s", 18: "swim_50m_s", 20: "swim_400m_s", 22: "swim_800m_s", 25: "swim_1500m_s"}
        records: dict = {}
        for p in prs or []:
            key = keys.get(p.get("typeId"))
            value = p.get("value")
            if not key or not value or p.get("status") not in (None, "ACCEPTED"):
                continue
            if key not in records or value < records[key]["value"]:
                records[key] = {"value": round(value, 1), "date": (p.get("actStartDateTimeInGMTFormatted") or "")[:10]}
        if records:
            out["personal_records"] = records

    return out


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

    result = {
        "vo2max_running": vo2max_running,
        "vo2max_date": vo2max_date,
        "training_status_label": training_status_label,
        "training_status_category": training_status_category,
        "training_status_date": training_status_date,
        "acwr_ratio": acwr_ratio,
        "acwr_status": acwr_status,
    }
    result.update(sync_trends(client, today))
    return result


# ── Dati per precompilare il profilo (sesso, nascita, altezza, peso) ──
# Se PROFILE_HINTS_FILE e' impostato (lo fa il sito per ogni utente), i dati anagrafici letti da Garmin e da Withings
# vengono salvati li', in un file privato fuori dalla cartella pubblica; il profilo poi li propone all'utente.
def write_profile_hints(source: str, data: dict) -> None:
    path = os.environ.get("PROFILE_HINTS_FILE")
    if not path or not data:
        return
    try:
        p = Path(path)
        cur = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        cur[source] = data
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(cur, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:  # non deve mai far fallire la sincronizzazione
        print(f"Dati del profilo non salvati: {exc}")


def garmin_profile_hints(client: Garmin) -> dict:
    ud = client.garth.connectapi("/userprofile-service/userprofile/user-settings").get("userData", {})
    out = {}
    g = str(ud.get("gender") or "").upper()
    if g in ("MALE", "FEMALE"):
        out["sex"] = "m" if g == "MALE" else "f"
    bd = str(ud.get("birthDate") or "")
    if len(bd) >= 4 and bd[:4].isdigit():
        out["birth_year"] = int(bd[:4])
    if ud.get("height"):
        out["height_cm"] = round(float(ud["height"]), 1)
    if ud.get("weight"):
        out["weight_kg"] = round(float(ud["weight"]) / 1000, 1)
    return out


def write_json(name: str, payload) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Scritto {path} ({len(payload) if isinstance(payload, list) else 'ok'} voci)")


def main() -> None:
    client = login()
    try:
        write_profile_hints("garmin", garmin_profile_hints(client))
    except Exception as exc:
        print(f"Dati anagrafici Garmin non letti: {exc}")

    weight = sync_weight(client)
    write_json("garmin-weight.json", weight)

    activities = sync_activities(client)
    write_json("garmin-activities.json", activities)

    fitness = sync_fitness(client)
    write_json("garmin-fitness.json", fitness)

    print("Sincronizzazione completata.")


if __name__ == "__main__":
    main()
