#!/usr/bin/env python3
"""Check data/papers.json (or a CSV exported from the sheet) before it goes live.

    python3 tools/validate_papers.py
    python3 tools/validate_papers.py sheet-export.csv

Checks that every row has a title and a resolvable link, that dates parse, and
that the resulting link is short enough to fit a version 10 QR code at EC level
M (213 bytes). Exits 1 on error.
"""

import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

QR_BYTE_LIMIT = 213

ALIASES = {
    "date": ["date", "day", "scheduled", "issue date"],
    "title": ["title", "paper", "name"],
    "authors": ["authors", "author", "first author"],
    "journal": ["journal", "source", "publication"],
    "year": ["year", "published", "pub year"],
    "url": ["url", "link", "full text", "fulltext"],
    "doi": ["doi"],
    "pmid": ["pmid", "pubmed", "pubmed id"],
    "takeaway": ["takeaway", "summary", "bottom line", "why it matters", "comment"],
    "tags": ["tags", "category", "topic area", "topic"],
}


def link_for(p):
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", (p.get("doi") or "").strip(), flags=re.I)
    if doi:
        return f"https://doi.org/{doi}"
    if (p.get("url") or "").strip():
        return p["url"].strip()
    if str(p.get("pmid") or "").strip():
        return f"https://pubmed.ncbi.nlm.nih.gov/{str(p['pmid']).strip()}/"
    return None


def load(path):
    if path.suffix.lower() == ".csv":
        with open(path, newline="", encoding="utf-8-sig") as fh:
            rows = list(csv.DictReader(fh))
        out = []
        for r in rows:
            lower = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
            out.append({field: next((lower[a] for a in names if a in lower), "")
                        for field, names in ALIASES.items()})
        return out
    return json.loads(path.read_text(encoding="utf-8")).get("papers", [])


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/papers.json")
    papers = load(path)

    errors, warnings = [], []
    seen_dates = {}

    for i, p in enumerate(papers, start=1):
        who = (p.get("title") or f"row {i}")[:50]

        if not (p.get("title") or "").strip():
            errors.append(f"row {i}: no title")

        link = link_for(p)
        if not link:
            errors.append(f"{who}: no url, doi or pmid — nothing to put in the QR code")
        elif len(link.encode("utf-8")) > QR_BYTE_LIMIT:
            errors.append(f"{who}: link is {len(link)} bytes, over the {QR_BYTE_LIMIT}-byte "
                          f"QR limit — use the DOI instead of a long publisher URL")

        d = (p.get("date") or "").strip()
        if d:
            try:
                date.fromisoformat(d)
                if d in seen_dates:
                    errors.append(f"{who}: date {d} already used by '{seen_dates[d][:40]}'")
                seen_dates[d] = who
            except ValueError:
                errors.append(f"{who}: date '{d}' is not YYYY-MM-DD")

        if not (p.get("takeaway") or "").strip():
            warnings.append(f"{who}: no takeaway line")
        if not (p.get("journal") or "").strip():
            warnings.append(f"{who}: no journal")

    pinned = len(seen_dates)
    print(f"{len(papers)} papers — {pinned} pinned to a date, {len(papers) - pinned} in rotation")
    for w in warnings:
        print(f"  warn  {w}")
    for e in errors:
        print(f"  ERROR {e}")

    if errors:
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
