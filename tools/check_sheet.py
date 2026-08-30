#!/usr/bin/env python3
"""Check that the Google Sheet is reachable and its headers map correctly.

Run this from your own machine — it needs internet access to docs.google.com.

    python3 tools/check_sheet.py                 # uses SHEET_CSV_URL from papers.js
    python3 tools/check_sheet.py "<other url>"   # test a different URL

Reports: whether the URL returns CSV rather than a sign-in page, which of your
column headers matched which field, what is unmatched, and a preview of the
first few rows as the site will read them.
"""

import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_papers import ALIASES, link_for  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def url_from_papers_js():
    src = (ROOT / "assets" / "papers.js").read_text()
    m = re.search(r"export const SHEET_CSV_URL\s*=\s*\n?\s*['\"]([^'\"]+)['\"]", src)
    if not m:
        sys.exit("SHEET_CSV_URL is not set to a string in assets/papers.js")
    return m.group(1)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "em-handover-daily/check"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace"), r.headers, r.url


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else url_from_papers_js()
    print(f"URL: {url}\n")

    try:
        body, headers, final = fetch(url)
    except Exception as e:
        sys.exit(f"FAILED to fetch: {e}\n\nIf this is a 404, the sheet may not be published "
                 f"to the web. If it is a 401/403, it is not shared publicly.")

    if final != url:
        print(f"Redirected to: {final}")
    print(f"Content-Type: {headers.get('Content-Type', '?')}")

    if body.lstrip().startswith("<") or "accounts.google.com" in body[:2000]:
        sys.exit("\nFAILED: Google returned an HTML page, not CSV.\n"
                 "The sheet is not publicly readable. Either:\n"
                 "  - File > Share > Publish to web > Comma-separated values, or\n"
                 "  - Share > Anyone with the link > Viewer\n"
                 "The browser fetch will fail in exactly the same way.")

    import csv
    import io
    rows = list(csv.reader(io.StringIO(body)))
    if not rows:
        sys.exit("\nFAILED: no rows returned.")

    header = [h.strip().lower() for h in rows[0]]
    print(f"\n{len(rows) - 1} data rows, {len(header)} columns")
    print(f"Headers: {', '.join(header)}\n")

    matched, unmatched_fields = {}, []
    for field, names in ALIASES.items():
        hit = next((n for n in names if n in header), None)
        if hit:
            matched[field] = hit
        else:
            unmatched_fields.append(field)

    for field, col in matched.items():
        print(f"  {field:<9} <- '{col}'")
    if unmatched_fields:
        print(f"\n  not matched: {', '.join(unmatched_fields)}")
        print("  (rename the column, or add the name to FIELDS in assets/papers.js)")

    problems = []
    if "title" not in matched:
        problems.append("no title column — nothing will render")
    if not {"doi", "url", "pmid"} & matched.keys():
        problems.append("no doi, url or pmid column — no QR code can be generated")

    print("\nFirst rows as the site will read them:")
    for r in rows[1:4]:
        row = dict(zip(header, r))
        get = lambda f: row.get(matched.get(f, ""), "")
        print(f"  - {get('title')[:60] or '(no title)'}")
        print(f"    link: {link_for({k: get(k) for k in ('doi', 'url', 'pmid')}) or '(none)'}")

    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("\nOK — headers map correctly.")


if __name__ == "__main__":
    main()
