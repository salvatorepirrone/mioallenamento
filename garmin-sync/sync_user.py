"""Sincronizza i dati di un utente (Garmin e/o Withings) in background e scrive lo stato in un file JSON.

Le cartelle dell'utente (token, dati) arrivano dalle variabili d'ambiente impostate da chi lo avvia (connect-api.php):
sync.py e withings_sync.py le leggono gia' cosi'. Uso: python sync_user.py <file_stato.json> <garmin,withings>
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = {"garmin": "sync.py", "withings": "withings_sync.py"}


def write_status(path: str, st: dict) -> None:
    tmp = path + ".tmp"
    Path(tmp).write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def main(argv: list) -> int:
    status_file = argv[1]
    services = [s for s in argv[2].split(",") if s in SCRIPTS]
    st = {"state": "running", "started": int(time.time()), "results": {}}
    write_status(status_file, st)
    for svc in services:
        try:
            p = subprocess.run([sys.executable, "-u", str(HERE / SCRIPTS[svc])], capture_output=True, text=True, timeout=1500, env=os.environ)
            ok = p.returncode == 0
            tail = (p.stderr or p.stdout or "").strip().splitlines()
            st["results"][svc] = {"ok": ok, "error": None if ok else (tail[-1][:220] if tail else "errore sconosciuto")}
        except subprocess.TimeoutExpired:
            st["results"][svc] = {"ok": False, "error": "Sincronizzazione troppo lenta: riprova."}
        write_status(status_file, st)
    st["state"] = "done"
    st["finished"] = int(time.time())
    write_status(status_file, st)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
