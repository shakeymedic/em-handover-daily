/* Paper of the day.
 *
 * Source order:
 *   1. SHEET_CSV_URL, if you set it below — your Google Sheet, read as CSV.
 *   2. data/papers.json — local fallback, always used if the sheet is
 *      unreachable, so the department screen never shows an empty card.
 *
 * ---------------------------------------------------------------------------
 * CONNECTING YOUR SHEET
 *
 * Two ways, both read-only and both work from the browser with no backend:
 *
 *   a) File > Share > Publish to web > choose the sheet > Comma-separated
 *      values. Paste the resulting .../pub?gid=0&single=true&output=csv URL.
 *
 *   b) Share the sheet as "Anyone with the link can view", then use:
 *      https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:csv&sheet=TAB_NAME
 *
 * Option (a) is the more stable of the two. I have not been able to test
 * either from this build environment, so if the browser console shows a CORS
 * error, fall back to the Netlify function in netlify/functions/sheet-proxy.js.
 *
 * Column headers are matched case-insensitively and several names are accepted
 * for each field (see FIELDS). Extra columns are ignored. Only `title` and a
 * link (url, doi or pmid) are required.
 * ---------------------------------------------------------------------------
 */

/* ---------------------------------------------------------------------------
 * YOUR SHEET
 *
 * File ID: 1qjPV9ClYIg6piwwnoWtWt0kBpPWDq_ON_ia0MPEq7fw
 *
 * Two ways to expose it as CSV, both read-only, both browser-fetchable with no
 * backend. Option (b) is set below; switch to (a) if it does not work.
 *
 *   (a) File > Share > Publish to web > pick the tab > Comma-separated values.
 *       Paste the resulting .../pub?gid=0&single=true&output=csv URL here.
 *       More reliable, and does not require the sheet itself to be shared.
 *
 *   (b) Share > General access > "Anyone with the link" > Viewer, then use the
 *       gviz URL below. Add &sheet=TAB_NAME if the paper list is not the first
 *       tab. Note this makes the whole sheet readable by anyone with the link.
 *
 * A private sheet will NOT work from the browser — the fetch returns Google's
 * sign-in page, not your data. The card falls back to data/papers.json and
 * says so on screen, so nothing breaks either way.
 *
 * Not verified from my build environment: whether Google sends CORS headers
 * that permit this fetch. If the console shows a CORS error, deploy
 * netlify/functions/sheet-proxy.js and point SHEET_CSV_URL at
 * '/.netlify/functions/sheet-proxy' instead.
 *
 * Check the URL and your column headers before deploying:
 *     python3 tools/check_sheet.py
 * -------------------------------------------------------------------------*/

/* ---------------------------------------------------------------------------
 * EM Evidence Rundown — All Newsletters Paper Database
 * Sheet ID: 1qjPV9ClYIg6piwwnoWtWt0kBpPWDq_ON_ia0MPEq7fw
 *
 * The sheet has a summary tab (gid=0) and the papers tab.
 * Once the papers tab is published to web via File > Share > Publish to web
 * > Comma-separated values, paste that URL here (it will look like:
 *   .../pub?gid=XXXXXXX&single=true&output=csv)
 *
 * Until then, the fallback data/papers.json (82 EM papers) is used automatically.
 *
 * Column headers in the sheet that are already recognised:
 *   Title, Journal, PMID, Link — match directly
 *   Issue Date — mapped to 'date' (papers.js FIELDS extended to recognise this)
 *   Topic Area — mapped to 'tags' (papers.js FIELDS extended to recognise this)
 * ---------------------------------------------------------------------------*/
export const SHEET_CSV_URL = '';

const CACHE_KEY = 'ehd:papers';
const CACHE_HOURS = 6;

const FIELDS = {
  date:     ['date', 'day', 'scheduled', 'issue date'],
  title:    ['title', 'paper', 'name'],
  authors:  ['authors', 'author', 'first author'],
  journal:  ['journal', 'source', 'publication'],
  year:     ['year', 'published', 'pub year'],
  url:      ['url', 'link', 'full text', 'fulltext'],
  doi:      ['doi'],
  pmid:     ['pmid', 'pubmed', 'pubmed id'],
  takeaway: ['takeaway', 'summary', 'bottom line', 'why it matters', 'comment'],
  design:   ['design', 'type', 'study type', 'study design'],
  tags:     ['tags', 'category', 'topic area', 'topic']
};

/* ------------------------------------------------------------ CSV parse --- */

/** RFC 4180 parser: handles quoted fields, embedded commas, quotes and newlines. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function mapRows(rows) {
  if (!rows.length) return { papers: [], header: [], missing: ['sheet is empty'] };
  const header = rows[0].map(h => h.trim().toLowerCase());
  const indexFor = names => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const cols = Object.fromEntries(
    Object.entries(FIELDS).map(([key, names]) => [key, indexFor(names)]));

  const missing = [];
  if (cols.title === -1) missing.push('title');
  if (cols.doi === -1 && cols.url === -1 && cols.pmid === -1) missing.push('doi, url or pmid');

  const papers = rows.slice(1).map(r => {
    const get = key => cols[key] === -1 ? '' : (r[cols[key]] || '').trim();
    const paper = Object.fromEntries(Object.keys(FIELDS).map(k => [k, get(k)]));
    paper.tags = paper.tags ? paper.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean) : [];
    return paper;
  }).filter(p => p.title);

  return { papers, header, missing };
}

/* --------------------------------------------------------------- links --- */

/** The URL the QR code points at. DOI is preferred: it survives site moves. */
export function paperLink(paper) {
  if (paper.doi) {
    const doi = paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
    if (doi) return `https://doi.org/${doi}`;
  }
  if (paper.url) return paper.url.trim();
  if (paper.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${String(paper.pmid).trim()}/`;
  return null;
}

export function citation(paper) {
  return [paper.authors, paper.journal, paper.year]
    .map(part => String(part || '').trim().replace(/\.+$/, ''))
    .filter(Boolean)
    .join('. ');
}

/* -------------------------------------------------------------- loading --- */

async function fromSheet() {
  if (!SHEET_CSV_URL) return null;
  const res = await fetch(SHEET_CSV_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Sheet returned ${res.status}`);
  const text = await res.text();

  // A private sheet returns Google's sign-in page, not CSV. Catch that here so
  // the failure names the real cause instead of "no rows found".
  if (/^\s*</.test(text) || /accounts\.google\.com/.test(text.slice(0, 2000))) {
    throw new Error('sheet is not publicly readable — Google returned a sign-in page');
  }
  return mapRows(parseCSV(text));
}

async function fromLocal() {
  const res = await fetch('data/papers.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`papers.json returned ${res.status}`);
  const data = await res.json();
  return (data.papers || []).map(p => ({ ...p, tags: p.tags || [] }));
}

/** Returns { papers, source, degraded, message }. */
export async function loadPapers() {
  const cached = readCache();
  if (cached) return cached;

  const fallback = async message => ({
    papers: await fromLocal(), source: 'local', degraded: true, message
  });

  let payload;
  try {
    const sheet = await fromSheet();

    if (sheet && sheet.missing.length) {
      payload = await fallback(
        `Sheet is missing a ${sheet.missing.join(' and ')} column. ` +
        `Headers found: ${sheet.header.join(', ') || 'none'}.`);
    } else if (sheet && sheet.papers.length) {
      payload = { papers: sheet.papers, source: 'sheet', degraded: false, message: '' };
    } else if (sheet) {
      payload = await fallback('Sheet has headers but no rows with a title.');
    } else {
      payload = { papers: await fromLocal(), source: 'local', degraded: false, message: '' };
    }
  } catch (err) {
    try {
      payload = await fallback(
        `Could not read the Google Sheet (${err.message}) — showing the local list.`);
    } catch {
      payload = { papers: [], source: 'none', degraded: true, message: 'No paper list available.' };
    }
  }
  writeCache(payload);
  return payload;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, payload } = JSON.parse(raw);
    if (Date.now() - at > CACHE_HOURS * 3600000) return null;
    return payload;
  } catch { return null; }
}

function writeCache(payload) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload })); }
  catch { /* private mode */ }
}

export function clearPaperCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/* ------------------------------------------------------------ selection --- */

/** Exact date match if the sheet schedules one, otherwise a stable rotation. */
export function pickPaperForDate(papers, iso) {
  if (!papers.length) return null;
  const exact = papers.find(p => (p.date || '').trim() === iso);
  if (exact) return exact;
  const days = Math.floor(new Date(iso + 'T12:00:00').getTime() / 86400000);
  return papers[days % papers.length];
}

/* ------------------------------------------------------------ rendering --- */

import { qrSVG } from './qr.js';

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderPaper(container, paper, { degraded = false, message = '' } = {}) {
  if (!container) return;

  if (!paper) {
    container.innerHTML = `<div class="empty">No paper scheduled.
      ${degraded ? esc(message) : 'Add one to your sheet or to data/papers.json.'}</div>`;
    return;
  }

  const link = paperLink(paper);
  const cite = citation(paper);

  let qr;
  if (link) {
    try {
      qr = `<div class="paper__qr">${qrSVG(link, { size: 220, label: 'Scan to open the paper' })}
        <div class="paper__scan">Scan to read</div></div>`;
    } catch (err) {
      qr = `<div class="paper__qr paper__qr--missing">Link too long to encode as a QR code</div>`;
    }
  } else {
    qr = `<div class="paper__qr paper__qr--missing">No link on this row</div>`;
  }

  const titleHTML = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(paper.title)}</a>`
    : esc(paper.title);

  container.innerHTML = `
    <section class="paper" aria-label="Paper of the day">
      <div class="paper__body">
        <div class="eyebrow">Paper of the day${paper.design ? ' &middot; ' + esc(paper.design) : ''}</div>
        <h2 class="paper__title">${titleHTML}</h2>
        ${cite ? `<p class="paper__cite">${esc(cite)}</p>` : ''}
        ${paper.takeaway ? `<p class="paper__takeaway">${esc(paper.takeaway)}</p>` : ''}
        ${degraded ? `<p class="paper__cite">${esc(message)}</p>` : ''}
      </div>
      ${qr}
    </section>`;
}
