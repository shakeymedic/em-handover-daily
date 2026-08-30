#!/usr/bin/env python3
"""Turn a content-calendar spreadsheet into module JSON.

Expected CSV columns (blank cells are fine):
  id, date, title, category, tags, difficulty, frcem,
  bullet1..bullet7, question, optionA, optionB, optionC, optionD,
  answer, explanation, source_title, source_publisher, source_url, deep_dive_url

'tags' is semicolon-separated. 'answer' is the letter A-D.
A bullet prefixed with '#' is treated as a numbered step.

Usage:
  python3 tools/csv_to_modules.py calendar.csv > new-modules.json
  python3 tools/csv_to_modules.py calendar.csv --merge data/modules.json
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

LETTERS = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4}


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def row_to_module(row):
    bullets = []
    for i in range(1, 8):
        raw = (row.get(f"bullet{i}") or "").strip()
        if not raw:
            continue
        if raw.startswith("#"):
            bullets.append({"text": raw[1:].strip(), "step": True})
        else:
            bullets.append({"text": raw})

    options = [(row.get(f"option{L}") or "").strip() for L in "ABCDE"]
    options = [o for o in options if o]

    module = {
        "id": (row.get("id") or slug(row.get("title", ""))).strip(),
        "date": (row.get("date") or "").strip(),
        "title": (row.get("title") or "").strip(),
        "category": (row.get("category") or "").strip().lower(),
        "tags": [t.strip() for t in (row.get("tags") or "").split(";") if t.strip()],
        "difficulty": (row.get("difficulty") or "core").strip().lower(),
        "status": "draft",
        "frcem_relevant": (row.get("frcem") or "").strip().lower() in {"y", "yes", "true", "1"},
        "bullets": bullets,
    }

    if row.get("question") and options:
        module["quiz"] = {
            "question": row["question"].strip(),
            "options": options,
            "answer_index": LETTERS.get((row.get("answer") or "A").strip().upper(), 0),
            "explanation": (row.get("explanation") or "").strip(),
        }

    module["source"] = {
        "title": (row.get("source_title") or "").strip(),
        "publisher": (row.get("source_publisher") or "").strip(),
        "url": (row.get("source_url") or "").strip(),
    }
    if row.get("deep_dive_url"):
        module["deep_dive_url"] = row["deep_dive_url"].strip()

    return module


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--merge", help="existing modules.json to merge into (writes in place)")
    args = ap.parse_args()

    with open(args.csv_path, newline="", encoding="utf-8-sig") as fh:
        new = [row_to_module(r) for r in csv.DictReader(fh) if (r.get("title") or "").strip()]

    if not args.merge:
        json.dump({"schema_version": 1, "modules": new}, sys.stdout, indent=2, ensure_ascii=False)
        print()
        return

    path = Path(args.merge)
    data = json.loads(path.read_text(encoding="utf-8"))
    existing = {m["id"]: m for m in data.get("modules", [])}
    added = 0
    for m in new:
        if m["id"] in existing:
            print(f"skipped (id exists): {m['id']}", file=sys.stderr)
            continue
        existing[m["id"]] = m
        added += 1
    data["modules"] = sorted(existing.values(), key=lambda m: m.get("date", ""))
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"added {added} modules, {len(data['modules'])} total", file=sys.stderr)


if __name__ == "__main__":
    main()
