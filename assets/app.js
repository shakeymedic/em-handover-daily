/* EM Handover Daily — shared behaviour.
   Vanilla JS, no framework, no build step. */

/* ---------------------------------------------------------------- helpers */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const CATEGORIES = {
  resus:   'Resus',
  ecg:     'ECG',
  airway:  'Airway',
  tox:     'Tox',
  trauma:  'Trauma',
  pem:     'PEM',
  stroke:  'Stroke',
  safety:  'Safety',
  frcem:   'FRCEM'
};

/** Local calendar date as YYYY-MM-DD (never UTC — a 00:30 handover must
    still show the right day). */
function localISODate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Wraps doses, thresholds and units in <b> so they set in mono. Applied to
    already-escaped text, so no markup can be injected here. */
function markNumbers(escaped) {
  return escaped.replace(
    /(\d+(?:[.,]\d+)?(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?\s?(?:mmol\/L|mmol|mg\/kg|mL\/kg|micrograms?|mcg|mg|mL|kg|units?|u\b|g\b|%|mins?|hours?|h\b|min\b))/gi,
    '<b>$1</b>');
}

/* ------------------------------------------------------- chrome behaviour */

const HANDOVER_KEY = 'ehd:handover';

function initHandoverToggle() {
  const on = localStorage.getItem(HANDOVER_KEY) === '1';
  document.body.classList.toggle('handover', on);

  $$('[data-handover-toggle]').forEach(btn => {
    const sync = () => {
      const active = document.body.classList.contains('handover');
      btn.setAttribute('aria-pressed', String(active));
      btn.textContent = active ? 'Handover mode: on' : 'Handover mode';
    };
    sync();
    btn.addEventListener('click', () => {
      const next = !document.body.classList.contains('handover');
      document.body.classList.toggle('handover', next);
      localStorage.setItem(HANDOVER_KEY, next ? '1' : '0');
      $$('[data-handover-toggle]').forEach(b => {
        b.setAttribute('aria-pressed', String(next));
        b.textContent = next ? 'Handover mode: on' : 'Handover mode';
      });
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'h' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      $('[data-handover-toggle]')?.click();
    }
  });
}

function initPrintButtons() {
  $$('[data-print]').forEach(b => b.addEventListener('click', () => window.print()));
}

function initClock() {
  const el = $('[data-clock]');
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('en-GB',
      { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 30000);
}

/** Reload once a day so a screen left on overnight rolls to the new module. */
function initMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 30, 0);
  setTimeout(() => location.reload(), midnight - now);
}

/* -------------------------------------------------------- module loading */

let modulesCache = null;

async function loadModules() {
  if (modulesCache) return modulesCache;
  const res = await fetch('data/modules.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`modules.json returned ${res.status}`);
  const data = await res.json();
  modulesCache = (data.modules || []).slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || ''));
  return modulesCache;
}

/** Today's module: an exact date match if one is scheduled, otherwise a
    deterministic rotation through the bank so the screen is never blank. */
function pickForDate(modules, iso) {
  const exact = modules.find(m => m.date === iso);
  if (exact) return { module: exact, scheduled: true };
  if (!modules.length) return { module: null, scheduled: false };
  const days = Math.floor(new Date(iso + 'T12:00:00').getTime() / 86400000);
  return { module: modules[days % modules.length], scheduled: false };
}

/* ------------------------------------------------------ module rendering */

function chipsFor(m) {
  const chips = [`<span class="chip chip--cat">${escapeHTML(CATEGORIES[m.category] || m.category)}</span>`];
  if (m.frcem_relevant) chips.push('<span class="chip chip--frcem">FRCEM</span>');
  if (m.difficulty) chips.push(`<span class="chip">${escapeHTML(m.difficulty)}</span>`);
  if (m.status !== 'published') chips.push('<span class="chip chip--draft">Draft</span>');
  return chips.join('');
}

function bulletsHTML(bullets = []) {
  let step = 0;
  return bullets.map(b => {
    const text = typeof b === 'string' ? b : b.text;
    const isStep = typeof b === 'object' && b.step;
    if (isStep) step += 1;
    const attr = isStep ? ` data-step="${step}"` : '';
    return `<li${attr}>${markNumbers(escapeHTML(text))}</li>`;
  }).join('');
}

function sourceHTML(m) {
  const s = m.source;
  if (!s) return '';
  const label = escapeHTML([s.title, s.journal || s.publisher].filter(Boolean).join(' — '));
  const link = s.url ? `<a href="${escapeHTML(s.url)}" target="_blank" rel="noopener">${label}</a>` : label;
  const deep = m.deep_dive_url
    ? ` &middot; <a href="${escapeHTML(m.deep_dive_url)}" target="_blank" rel="noopener">Deep dive</a>` : '';
  return `<div class="src">Source: ${link}${deep}</div>`;
}

function renderModule(root, m, opts = {}) {
  const draftNotice = m.status !== 'published'
    ? `<div class="notice">Draft — not yet clinically signed off. Check against local
       guidelines before teaching from it.</div>` : '';

  root.innerHTML = `
    ${draftNotice}
    <article class="module">
      <div class="module__head">
        <div class="eyebrow">${escapeHTML(opts.eyebrow || longDate(m.date))}</div>
        <div class="chips">${chipsFor(m)}</div>
      </div>
      <h1 class="module__title">${escapeHTML(m.title)}</h1>
      <ul class="points">${bulletsHTML(m.bullets)}</ul>
      <div class="module__foot">${sourceHTML(m)}</div>
    </article>

    <div class="btn-row no-print" style="margin-bottom:1.25rem">
      <button class="btn btn--primary" data-screen2>Screen 2 — deep dive and question</button>
    </div>

    <section class="screen2" id="screen2" aria-live="polite">
      ${deepDiveHTML(m)}
      ${quizHTML(m)}
    </section>
  `;

  const toggle = $('[data-screen2]', root);
  const panel = $('#screen2', root);
  toggle?.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    toggle.textContent = open ? 'Back to screen 1' : 'Screen 2 — deep dive and question';
    if (open) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  wireQuiz(panel, m);
}

function deepDiveHTML(m) {
  const dd = m.deep_dive;
  if (!dd) return '';
  if (dd.type === 'algorithm' && Array.isArray(dd.steps)) {
    return `<div class="module deep">
      <h3>${escapeHTML(dd.heading || 'Algorithm')}</h3>
      <ol class="algorithm">${dd.steps.map(s =>
        `<li>${markNumbers(escapeHTML(s))}</li>`).join('')}</ol>
    </div>`;
  }
  if (dd.type === 'notes' && Array.isArray(dd.points)) {
    return `<div class="module deep">
      <h3>${escapeHTML(dd.heading || 'Going deeper')}</h3>
      <ul class="points">${bulletsHTML(dd.points)}</ul>
    </div>`;
  }
  return '';
}

function quizHTML(m) {
  const q = m.quiz;
  if (!q) return '';
  const keys = ['A', 'B', 'C', 'D', 'E'];
  return `<div class="module quiz">
    <h3>Question of the day</h3>
    <p class="stem">${escapeHTML(q.question)}</p>
    <div class="options">
      ${q.options.map((o, i) =>
        `<button class="option" data-i="${i}"><span class="key">${keys[i]}</span>
          <span>${escapeHTML(o)}</span></button>`).join('')}
    </div>
    <div class="explain" hidden data-explain></div>
  </div>`;
}

function wireQuiz(root, m) {
  const q = m.quiz;
  if (!q || !root) return;
  const buttons = $$('.option', root);
  const explain = $('[data-explain]', root);

  buttons.forEach(btn => btn.addEventListener('click', () => {
    const chosen = Number(btn.dataset.i);
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer_index) b.classList.add('is-correct');
      else if (i === chosen) b.classList.add('is-wrong');
    });
    explain.hidden = false;
    explain.innerHTML = markNumbers(escapeHTML(q.explanation || ''));
  }));
}

/* -------------------------------------------------------------- bootstrap */

document.addEventListener('DOMContentLoaded', () => {
  initHandoverToggle();
  initPrintButtons();
  initClock();
  initMidnightRefresh();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
