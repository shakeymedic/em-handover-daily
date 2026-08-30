/**
 * Netlify serverless function: sheet-proxy.js
 *
 * Used if the Google Sheet returns a CORS error when fetched directly from the
 * browser. Point SHEET_CSV_URL in assets/papers.js at:
 *   /.netlify/functions/sheet-proxy
 *
 * The function fetches the sheet server-side (no CORS restriction) and returns
 * it to the browser with the correct Content-Type header.
 *
 * No auth needed — the sheet must still be shared publicly or published to web;
 * this proxy only bypasses the browser's same-origin restriction.
 */

const SHEET_ID = '1qjPV9ClYIg6piwwnoWtWt0kBpPWDq_ON_ia0MPEq7fw';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

exports.handler = async function (event) {
  try {
    const res = await fetch(SHEET_URL);
    if (!res.ok) {
      return {
        statusCode: res.status,
        body: `Google Sheets returned ${res.status}`
      };
    }
    const body = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      },
      body
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: `Proxy error: ${err.message}`
    };
  }
};
