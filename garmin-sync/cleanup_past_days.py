"""Rimuove da index.html i giorni del programma gia' trascorsi.

A mezzanotte, per ogni giorno che e' appena finito, l'attivita' effettivamente
svolta e' gia' visibile nella tabella live "Ultimi allenamenti registrati"
(sincronizzata da Garmin): la riga pianificata diventa quindi ridondante e
viene tolta. Se una settimana rimane senza giorni, anche il suo blocco viene
rimosso.

Non richiede Garmin ne' Docker: e' manipolazione di testo pura, pensata per
girare direttamente con il Python del sistema (vedi run-midnight.ps1).

Nota tecnica: la rimozione avviene per sottostringa esatta (bilanciando i tag
<div>/</div>), non tramite un parser HTML che riserializza il documento --
cosi' il resto del file (formattazione, stile) resta identico byte per byte.
"""

from __future__ import annotations

import os
import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(os.environ.get("REPO_ROOT", Path(__file__).resolve().parent.parent))
INDEX_HTML = REPO_ROOT / "index.html"

MESI_IT = {
    "gen": 1, "feb": 2, "mar": 3, "apr": 4, "mag": 5, "giu": 6,
    "lug": 7, "ago": 8, "set": 9, "ott": 10, "nov": 11, "dic": 12,
}

DAY_ROW_OPEN_RE = re.compile(r'<div class="day-row[^"]*"[^>]*>')
WEEK_BLOCK_OPEN_RE = re.compile(r'<div class="week-block"[^>]*>')
DIV_TAG_RE = re.compile(r"<div\b|</div>")


def parse_label_date(label: str, year: int) -> date | None:
    """'Gio 3 Set' -> date(year, 9, 3). None se il testo non e' riconosciuto."""
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3})", label)
    if not m:
        return None
    mese = MESI_IT.get(m.group(2).lower())
    if not mese:
        return None
    try:
        return date(year, mese, int(m.group(1)))
    except ValueError:
        return None


def find_matching_close(html: str, open_start: int) -> int:
    """Da un <div ...> a 'open_start', ritorna l'indice subito dopo il </div>
    corrispondente (bilanciando eventuali <div> annidati)."""
    tag_end = html.index(">", open_start) + 1
    depth = 1
    pos = tag_end
    while depth > 0:
        m = DIV_TAG_RE.search(html, pos)
        if not m:
            raise ValueError("Tag <div> non bilanciato in index.html")
        depth += 1 if m.group() == "<div" else -1
        pos = m.end()
    return pos


def remove_spans(html: str, spans: list[tuple[int, int]]) -> str:
    for start, end in sorted(spans, reverse=True):
        html = html[:start] + html[end:]
    return html


def remove_past_days(html: str, today: date) -> tuple[str, int]:
    spans = []
    for m in DAY_ROW_OPEN_RE.finditer(html):
        start = m.start()
        end = find_matching_close(html, start)
        date_m = re.search(r'class="day-date">([^<]+)<', html[start:end])
        if not date_m:
            continue
        d = parse_label_date(date_m.group(1), today.year)
        if d and d < today:
            spans.append((start, end))
    return remove_spans(html, spans), len(spans)


def remove_empty_weeks(html: str) -> tuple[str, int]:
    spans = []
    for m in WEEK_BLOCK_OPEN_RE.finditer(html):
        start = m.start()
        end = find_matching_close(html, start)
        if '<div class="day-row' not in html[start:end]:
            spans.append((start, end))
    return remove_spans(html, spans), len(spans)


def main() -> None:
    if not INDEX_HTML.exists():
        print(f"{INDEX_HTML} non trovato", file=sys.stderr)
        sys.exit(1)

    html = INDEX_HTML.read_text(encoding="utf-8")
    today = date.today()

    html, removed_days = remove_past_days(html, today)
    html, removed_weeks = remove_empty_weeks(html)

    if removed_days == 0 and removed_weeks == 0:
        print("Nessun giorno passato da rimuovere.")
        return

    INDEX_HTML.write_text(html, encoding="utf-8")
    print(f"Rimossi {removed_days} giorni passati e {removed_weeks} settimane rimaste vuote da index.html")


if __name__ == "__main__":
    main()
