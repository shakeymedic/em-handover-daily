# EM Handover Daily

One teaching point, one safety alert, and one question — every day — sized for the department screen at handover.

**Live site:** connect this repo to Netlify and it deploys automatically.

---

## What it does

| Feature | How |
|---|---|
| Daily module | Rotates through `data/modules.json`; an exact date match is shown on its scheduled day, otherwise the bank cycles deterministically |
| Safety alerts | Live MHRA Drug Safety Updates and Drug/Device Alerts pulled from the GOV.UK API, filtered to ED-relevant drugs, cached for 4 hours |
| Paper of the day | Reads from your Google Sheet (or `data/papers.json` as fallback), generates a QR code so attendees can scan directly to the paper |
| Night handover | Prompt sheet — 7 structured sections, date/time auto-fill, pre-populates today's safety alerts, clipboard copy, print-to-A4 |
| Handover mode | Press **h** or the button — dark background, 30px bullets, readable from across the department |
| Offline | Service worker caches the shell; content (modules, papers) is network-first so new modules appear without clearing the cache |

---

## Deploying to Netlify

1. Push this repo to GitHub
2. In Netlify: **Add new site > Import an existing project** > choose this repo
3. Build command: *(leave blank — no build step)*
4. Publish directory: `.`
5. Deploy

The site is live immediately. The service worker only registers over HTTPS, which Netlify provides.

---

## Connecting the Google Sheet (Paper of the day)

The "Paper of the day" card can pull directly from the EM Evidence Rundown Google Sheet.

**Option A — Publish to web (recommended):**
1. In the sheet: **File > Share > Publish to web**
2. Select the tab containing papers
3. Choose **Comma-separated values (.csv)**
4. Copy the URL and paste it into `SHEET_CSV_URL` in `assets/papers.js`

**Option B — Anyone with the link:**
1. **Share > General access > Anyone with the link > Viewer**
2. The `gviz` URL already set in `assets/papers.js` uses the sheet ID from the EM Evidence project — it will work once the sheet is shared
3. If the browser console shows a CORS error, change `SHEET_CSV_URL` to `'/.netlify/functions/sheet-proxy'` — the proxy function in `netlify/functions/` fetches it server-side

**Check your headers first:**
```
python3 tools/check_sheet.py
```
This confirms the URL returns CSV (not a sign-in page) and that the column headers map correctly.

---

## Adding content

### Teaching modules

Each module in `data/modules.json` has a structured format. The easiest way to add in bulk is via the CSV tool:

```
python3 tools/csv_to_modules.py my-calendar.csv --merge data/modules.json
```

Expected CSV columns: `id, date, title, category, tags, difficulty, frcem, bullet1…bullet7, question, optionA-D, answer, explanation, source_title, source_publisher, source_url, deep_dive_url`

Prefix a bullet with `#` to render it as a numbered step.

**Status:** every module starts as `draft`. Flip to `published` after you have checked it against the cited source and your local guideline.

**Categories:** `resus`, `ecg`, `airway`, `tox`, `trauma`, `pem`, `stroke`, `safety`

### Safety alerts

MHRA alerts are pulled live. To add a locally curated RCEM or other alert, add an entry to `data/rcem-alerts.json`:

```json
{
  "title": "RCEM Clinical Standards — fluid resuscitation update",
  "date": "2026-08-01",
  "url": "https://rcem.ac.uk/...",
  "source": "RCEM"
}
```

Entries older than 90 days are filtered out automatically.

---

## Tools

| Script | Purpose |
|---|---|
| `tools/validate_papers.py` | Check `data/papers.json` or a CSV export — catches missing titles, broken links, QR-code-too-long errors |
| `tools/check_sheet.py` | Verify the Google Sheet URL returns CSV and that columns map correctly |
| `tools/csv_to_modules.py` | Convert a content-calendar spreadsheet into module JSON |
| `tools/build_preview.py` | Build a self-contained `preview.html` for checking locally without a server |

---

## Running locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

The site uses ES modules and `fetch()` — both require HTTP, not a `file://` URL. The error message in the browser will tell you this if you open `index.html` directly.

---

## Disclaimer

Educational resource only. Not a substitute for clinical judgement. Always refer to local guidelines and current BNF/NICE guidance. Safety alerts link directly to MHRA or RCEM rather than being paraphrased.

Content created by Jake Turner. Curated with the assistance of AI (Perplexity). All content editorially reviewed.
