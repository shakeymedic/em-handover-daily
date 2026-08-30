/* Safety alerts — MHRA (GOV.UK search API) plus locally curated RCEM entries.
   Runs client-side. If the fetch fails for any reason (CORS, offline, API
   change) the strip degrades to the local RCEM file and says so rather than
   silently showing nothing. */

const ED_KEYWORDS = [
  'resuscitation', 'cardiac', 'anaesthe', 'sedation', 'thrombolysis',
  'anticoagulant', 'insulin', 'potassium', 'adrenaline', 'epinephrine',
  'naloxone', 'pabrinex', 'paracetamol', 'overdose', 'paediatric', 'children',
  'intubation', 'oxygen', 'transfusion', 'allergy', 'anaphylaxis',
  'suxamethonium', 'rocuronium', 'midazolam', 'lorazepam', 'morphine',
  'ketamine', 'propofol', 'amiodarone', 'aspirin', 'thrombus', 'sepsis',
  'antibiotic', 'defibrillat', 'tranexamic', 'nitrous oxide', 'infusion pump'
];

const MAX_AGE_DAYS = 90;
const CACHE_KEY = 'ehd:alerts';
const CACHE_HOURS = 4;

const GOVUK = 'https://www.gov.uk/api/search.json';
const MHRA_ORG = 'medicines-and-healthcare-products-regulatory-agency';

function govukURL(docType) {
  const p = new URLSearchParams({
    filter_organisations: MHRA_ORG,
    filter_content_store_document_type: docType,
    order: '-public_timestamp',
    count: '20'
  });
  return `${GOVUK}?${p}`;
}

function isEDRelevant(item) {
  const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  return ED_KEYWORDS.some(kw => text.includes(kw));
}

function isRecent(iso, days = MAX_AGE_DAYS) {
  const t = Date.parse(iso);
  return Number.isFinite(t) && (Date.now() - t) < days * 86400000;
}

async function fetchMHRA(docType, label) {
  const res = await fetch(govukURL(docType));
  if (!res.ok) throw new Error(`GOV.UK API returned ${res.status}`);
  const data = await res.json();
  return (data.results || [])
    .filter(isEDRelevant)
    .filter(r => isRecent(r.public_timestamp))
    .map(r => ({
      source: label,
      title: r.title,
      date: r.public_timestamp,
      url: r.link?.startsWith('http') ? r.link : `https://www.gov.uk${r.link}`
    }));
}

async function fetchLocalRCEM() {
  try {
    const res = await fetch('data/rcem-alerts.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.alerts || [])
      .filter(a => isRecent(a.date))
      .map(a => ({ source: a.source || 'RCEM', title: a.title, date: a.date, url: a.url }));
  } catch { return []; }
}

/** Returns { alerts, degraded, message } */
export async function getAlerts({ limit = 3 } = {}) {
  const cached = readCache();
  if (cached) return cached;

  const local = await fetchLocalRCEM();
  let mhra = [];
  let degraded = false;
  let message = '';

  try {
    const [dsu, dda] = await Promise.all([
      fetchMHRA('drug_safety_update', 'MHRA Drug Safety Update'),
      fetchMHRA('drug_device_alert', 'MHRA Drug/Device Alert')
    ]);
    mhra = [...dsu, ...dda];
  } catch (err) {
    degraded = true;
    message = 'Live MHRA feed unavailable — showing locally held alerts only.';
  }

  const alerts = [...mhra, ...local]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, limit);

  const payload = { alerts, degraded, message };
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
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload }));
  } catch { /* private mode — not important */ }
}

const fmt = iso => new Date(iso).toLocaleDateString('en-GB',
  { day: 'numeric', month: 'short', year: 'numeric' });

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderAlerts(container, { alerts, degraded, message }) {
  if (!container) return;
  if (!alerts.length) {
    container.innerHTML = `<div class="alert alert--quiet">
      <div class="alert__meta">Safety alerts</div>
      <div class="alert__title">No ED-relevant alerts in the last ${MAX_AGE_DAYS} days.
        ${degraded ? esc(message) : ''}</div></div>`;
    return;
  }
  container.innerHTML =
    (degraded ? `<div class="alert alert--quiet"><div class="alert__meta">Notice</div>
       <div class="alert__title">${esc(message)}</div></div>` : '') +
    alerts.map(a => `
      <a class="alert" href="${esc(a.url)}" target="_blank" rel="noopener">
        <div class="alert__meta">${esc(a.source)} &middot; ${esc(fmt(a.date))}</div>
        <div class="alert__title">${esc(a.title)}</div>
      </a>`).join('');
}

/** Plain-text one-liners, used to pre-populate the night handover sheet. */
export function alertLines({ alerts }) {
  return alerts.map(a => `${a.source} (${fmt(a.date)}): ${a.title}`);
}
