/**
 * Netlify Function: submit-learning.js
 *
 * Accepts POST requests from the handover site's "Submit learning point" form
 * and opens a GitHub PR (or direct commit) to add the entry to
 * data/learning-events.json.
 *
 * POST body (JSON):
 *   { title, detail, category, submitted_by }
 *
 * Required env vars (set in Netlify dashboard > Environment variables):
 *   GITHUB_TOKEN   — personal access token with repo write access
 *   GITHUB_REPO    — e.g. "shakeymedic/em-handover-daily"
 *   GITHUB_BRANCH  — e.g. "main"
 *
 * No patient data. Submissions are moderated by Jake before going live
 * (active: false by default — flip to true in the JSON to publish).
 */

const ALLOWED_CATEGORIES = ['safety', 'resus', 'airway', 'tox', 'trauma', 'pem', 'stroke', 'ecg', 'other'];
const MAX_TITLE  = 120;
const MAX_DETAIL = 500;

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { title = '', detail = '', category = 'safety', submitted_by = 'Anonymous' } = body;

  if (!title.trim() || title.length > MAX_TITLE)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title required (max 120 chars)' }) };
  if (detail.length > MAX_DETAIL)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Detail too long (max 500 chars)' }) };

  const cat = ALLOWED_CATEGORIES.includes(category) ? category : 'other';
  const today = new Date().toISOString().slice(0, 10);
  const id = `${today}-${slug(title)}`;

  const newEntry = { id, date: today, title: title.trim(), detail: detail.trim(), category: cat, submitted_by: String(submitted_by).slice(0, 60), active: false };

  // Read current file from GitHub, append entry, write back
  const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
  const GITHUB_REPO   = process.env.GITHUB_REPO  || 'shakeymedic/em-handover-daily';
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

  if (!GITHUB_TOKEN) {
    // Dev/preview mode — just echo back the entry
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, entry: newEntry, note: 'GITHUB_TOKEN not set — entry not persisted' }) };
  }

  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/data/learning-events.json`;
  const ghHeaders = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };

  try {
    // Get current file
    const getRes  = await fetch(apiBase + `?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
    const getJson = await getRes.json();
    const current = JSON.parse(Buffer.from(getJson.content, 'base64').toString('utf8'));

    current.events = current.events || [];
    current.events.push(newEntry);

    const updated = Buffer.from(JSON.stringify(current, null, 2) + '\n').toString('base64');
    const putRes  = await fetch(apiBase, {
      method: 'PUT', headers: ghHeaders,
      body: JSON.stringify({
        message: `Learning submission: ${title.slice(0, 60)}`,
        content: updated,
        sha: getJson.sha,
        branch: GITHUB_BRANCH
      })
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'GitHub write failed', detail: err.slice(0, 200) }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, entry: newEntry, note: 'Submitted. It will appear on the site once approved (active: true).' }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message }) };
  }
};
