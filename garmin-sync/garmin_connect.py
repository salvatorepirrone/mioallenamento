"""Collega l'account Garmin di un utente: accede UNA volta con email e password e salva solo i token di sessione.

La password non viene mai conservata: arriva da un file temporaneo (cancellato subito dopo la lettura) e dopo il
login resta soltanto la cartella dei token (GARMIN_TOKENSTORE), che permette alle sincronizzazioni successive di
entrare senza credenziali. Se l'account ha l'autenticazione a due fattori, lo script si ferma in attesa del codice
(file MFA) fino a 5 minuti.

Uso: python garmin_connect.py <file_credenziali.json> <file_stato.json> <file_mfa> <cartella_token>
Lo stato (state: starting | mfa_required | ok | error) si legge dal file di stato.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def write_status(path: str, **fields) -> None:
    tmp = path + ".tmp"
    Path(tmp).write_text(json.dumps(fields, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def main(argv: list) -> int:
    cred_file, status_file, mfa_file, tokenstore = argv[1:5]
    with open(cred_file, encoding="utf-8") as fh:
        cred = json.load(fh)
    os.remove(cred_file)                      # la password non resta su disco
    write_status(status_file, state="starting")

    def prompt_mfa() -> str:
        write_status(status_file, state="mfa_required")
        deadline = time.time() + 300
        while time.time() < deadline:
            if os.path.exists(mfa_file):
                code = Path(mfa_file).read_text(encoding="utf-8").strip()
                os.remove(mfa_file)
                write_status(status_file, state="starting")
                return code
            time.sleep(1)
        raise TimeoutError("Codice di verifica non ricevuto in tempo")

    try:
        import garth

        client = garth.Client()
        client.login(cred["email"], cred["password"], prompt_mfa=prompt_mfa)
        Path(tokenstore).mkdir(parents=True, exist_ok=True)
        client.dump(tokenstore)
        name = None
        try:
            name = client.profile.get("displayName")
        except Exception:
            pass
        write_status(status_file, state="ok", name=name)
        return 0
    except Exception as exc:  # noqa: BLE001 - il messaggio va mostrato all'utente
        msg = str(exc) or exc.__class__.__name__
        if "429" in msg:
            msg = "Garmin ha limitato i tentativi di accesso: riprova tra qualche minuto."
        elif "401" in msg or "credential" in msg.lower() or "password" in msg.lower():
            msg = "Email o password Garmin non corrette."
        write_status(status_file, state="error", error=msg[:220])
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
