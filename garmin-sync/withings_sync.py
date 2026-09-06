"""Scarica peso e grasso corporeo da Withings e li scrive come JSON in
/app/output (montato su data/ del repo), sullo stesso pattern di sync.py
per Garmin.

Parla direttamente con l'endpoint OAuth di Withings (nessun intermediario
Netlify): il client secret vive solo in questo .env, che sta fuori dalla
cartella pubblica del sito.

Primo avvio: serve un'autorizzazione una tantum nel browser (l'utente va
autenticato su Withings a mano, non e' automatizzabile). Il codice ottenuto
va passato una sola volta in WITHINGS_SETUP_CODE; da quel momento il
refresh_token viene salvato in WITHINGS_SESSION_DIR e riusato dalle
esecuzioni automatiche successive.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

WITHINGS_CLIENT_ID = os.environ.get(
    "WITHINGS_CLIENT_ID", "3fbf541859fb9995d2e1ea7e89754aafc8375d2e6af6cc20846de2db87a91445"
)
WITHINGS_CLIENT_SECRET = os.environ.get("WITHINGS_CLIENT_SECRET", "")
WITHINGS_REDIRECT_URI = os.environ.get(
    "WITHINGS_REDIRECT_URI", "https://pirrone.direct.quickconnect.to/callback.html"
)
OAUTH_ENDPOINT = "https://wbsapi.withings.net/v2/oauth2"
MEASURE_ENDPOINT = "https://wbsapi.withings.net/measure"

SESSION_DIR = Path(os.environ.get("WITHINGS_SESSION_DIR", "/app/.withings-session"))
TOKEN_FILE = SESSION_DIR / "token.json"
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/app/output"))
DAYS_BACK = int(os.environ.get("DAYS_BACK", "35"))

MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]


def label_it(d: date) -> str:
    return f"{d.day} {MESI_IT[d.month - 1]}"


def load_cached_token() -> dict | None:
    if TOKEN_FILE.exists():
        return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    return None


def save_token(body: dict) -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps({
        "access_token": body["access_token"],
        "refresh_token": body["refresh_token"],
        "expires_at": time.time() + body["expires_in"],
    }, indent=2), encoding="utf-8")


def _require_client_secret() -> None:
    if not WITHINGS_CLIENT_SECRET:
        print("WITHINGS_CLIENT_SECRET mancante nel file .env", file=sys.stderr)
        sys.exit(1)


def exchange_code(code: str) -> dict:
    _require_client_secret()
    res = requests.post(OAUTH_ENDPOINT, data={
        "action": "requesttoken",
        "grant_type": "authorization_code",
        "client_id": WITHINGS_CLIENT_ID,
        "client_secret": WITHINGS_CLIENT_SECRET,
        "code": code,
        "redirect_uri": WITHINGS_REDIRECT_URI,
    }, timeout=30)
    data = res.json()
    if data.get("status") != 0:
        raise RuntimeError(f"Errore scambio codice Withings: {data}")
    return data["body"]


def refresh_access_token(refresh_token: str) -> dict:
    _require_client_secret()
    res = requests.post(OAUTH_ENDPOINT, data={
        "action": "requesttoken",
        "grant_type": "refresh_token",
        "client_id": WITHINGS_CLIENT_ID,
        "client_secret": WITHINGS_CLIENT_SECRET,
        "refresh_token": refresh_token,
    }, timeout=30)
    data = res.json()
    if data.get("status") != 0:
        raise RuntimeError(f"Errore refresh token Withings: {data}")
    return data["body"]


def get_access_token(force_refresh: bool = False) -> str:
    cached = load_cached_token()
    setup_code = os.environ.get("WITHINGS_SETUP_CODE", "").strip()
    setup_refresh_token = os.environ.get("WITHINGS_SETUP_REFRESH_TOKEN", "").strip()

    if not cached:
        if setup_refresh_token:
            print("Prima autorizzazione Withings: uso il refresh token gia' presente nel browser...")
            body = refresh_access_token(setup_refresh_token)
            save_token(body)
            print(f"Autorizzazione riuscita, refresh token salvato in {TOKEN_FILE}.")
            return body["access_token"]
        if setup_code:
            print("Prima autorizzazione Withings: scambio il codice fornito...")
            body = exchange_code(setup_code)
            save_token(body)
            print(f"Autorizzazione riuscita, refresh token salvato in {TOKEN_FILE}.")
            return body["access_token"]
        print(
            "Nessun token Withings salvato e ne' WITHINGS_SETUP_CODE ne' "
            "WITHINGS_SETUP_REFRESH_TOKEN sono impostati.\n"
            "Serve un'autorizzazione una tantum: vedi le istruzioni fornite.",
            file=sys.stderr,
        )
        sys.exit(1)

    if not force_refresh and cached["expires_at"] > time.time() + 60:
        return cached["access_token"]

    print("Rinnovo il token Withings...")
    body = refresh_access_token(cached["refresh_token"])
    save_token(body)
    return body["access_token"]


def get_height_m(access_token: str) -> float | None:
    """L'altezza non viene misurata ad ogni pesata: va cercata su tutto lo
    storico (nessun limite di data), non solo negli ultimi DAYS_BACK giorni."""
    res = requests.post(
        MEASURE_ENDPOINT,
        data={"action": "getmeas", "meastypes": "4", "category": 1, "access_token": access_token},
        timeout=30,
    )
    data = res.json()
    if data.get("status") != 0:
        return None
    groups = sorted(data["body"].get("measuregrps", []), key=lambda g: g.get("date", 0), reverse=True)
    for group in groups:
        for m in group.get("measures", []):
            if m["type"] == 4:
                return m["value"] * (10 ** m["unit"])
    return None


def sync_weight(access_token: str) -> list[dict]:
    # L'endpoint legacy /measure vuole access_token come parametro nel body,
    # non come header Authorization: Bearer (a differenza delle API OAuth2 piu' recenti).
    height_m = get_height_m(access_token)

    start = int((datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).timestamp())
    res = requests.post(
        MEASURE_ENDPOINT,
        data={
            "action": "getmeas",
            "meastypes": "1,6",
            "category": 1,
            "startdate": start,
            "access_token": access_token,
        },
        timeout=30,
    )
    data = res.json()
    if data.get("status") != 0:
        raise RuntimeError(f"Errore lettura misure Withings: {data}")

    entries = []
    for group in data["body"].get("measuregrps", []):
        ts = group.get("date")
        if not ts:
            continue
        d = date.fromtimestamp(ts)
        weight = fat = None
        for m in group.get("measures", []):
            value = m["value"] * (10 ** m["unit"])
            if m["type"] == 1:
                weight = value
            elif m["type"] == 6:
                fat = value
        if weight is None:
            continue
        entries.append({
            "date": d.isoformat(),
            "label": label_it(d),
            "weight": round(weight, 1),
            "fat": round(fat, 1) if fat is not None else None,
            "bmi": round(weight / (height_m ** 2), 1) if height_m else None,
        })

    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


def write_json(name: str, payload) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Scritto {path} ({len(payload)} voci)")


def main() -> None:
    access_token = get_access_token()
    try:
        weight = sync_weight(access_token)
    except RuntimeError as exc:
        if "invalid_token" not in str(exc).lower():
            raise
        # Il browser (o un'altra esecuzione) potrebbe aver gia' rinnovato lo stesso
        # refresh_token nel frattempo: forza un rinnovo e riprova prima di arrenderti.
        print("Token rifiutato da Withings, forzo il rinnovo e riprovo...")
        access_token = get_access_token(force_refresh=True)
        weight = sync_weight(access_token)
    write_json("withings-weight.json", weight)
    print("Sincronizzazione Withings completata.")


if __name__ == "__main__":
    main()
