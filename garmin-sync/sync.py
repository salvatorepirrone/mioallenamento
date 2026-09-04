"""Scarica dati da Garmin Connect e li scrive come JSON in /app/output (montato su data/ del repo).

Primo avvio: eseguire manualmente (`docker compose run --rm garmin-sync`) da un terminale,
cosi' se Garmin richiede un codice MFA lo si puo' inserire a mano. Il token di sessione viene
salvato in /app/.garmin-session (montato su garmin-sync/.garmin-session) e riusato dalle
esecuzioni automatiche successive senza richiedere di nuovo le credenziali.
"""

import json
import os
import sys
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
        client = Garmin(
            EMAIL,
            PASSWORD,
            prompt_mfa=lambda: input("Inserisci il codice MFA Garmin: ").strip(),
        )
        client.login(TOKENSTORE)
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


def sync_activities(client: Garmin) -> list[dict]:
    raw = client.get_activities(0, 60)  # ultime 60 attivita'

    cutoff = (date.today() - timedelta(days=DAYS_BACK)).isoformat()
    entries = []
    for a in raw or []:
        start_local = a.get("startTimeLocal", "")
        act_date = start_local.split(" ")[0] if start_local else None
        if not act_date or act_date < cutoff:
            continue
        distance_m = a.get("distance")
        duration_s = a.get("duration")
        entries.append({
            "date": act_date,
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
        })

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
