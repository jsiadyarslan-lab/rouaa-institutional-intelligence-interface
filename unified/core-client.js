'use strict';
/* The ONLY network layer of the unified UI. Read-only (GET), same-origin, no credentials in the browser.
   Core is reached through a same-origin read channel mounted at /core (NOT provisioned by this repo —
   see PRODUCTION-INTEGRATION-BLOCKERS.md). No base-URL override, no snapshot fallback. */
const ROUAA_CORE_BASE = '/core';
const ROUAA_ALLOWED = /^\/(health|metrics|console\/config|v1\/intelligence(\/[A-Za-z0-9._:-]+(\/trace)?)?)(\?limit=\d{1,3})?$/;
/* states: LIVE_RESPONSE | NOT_FOUND_BY_CORE | UNAUTHORIZED | DEGRADED |
           CHANNEL_NOT_PROVISIONED | TEMPORARY_FAILURE | REJECTED_PATH */
async function coreGet(path, fetchImpl) {
  if (!ROUAA_ALLOWED.test(path)) return { state: 'REJECTED_PATH', path };
  const f = fetchImpl || fetch;
  let r;
  try { r = await f(ROUAA_CORE_BASE + path, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' }); }
  catch (e) { return { state: 'TEMPORARY_FAILURE', path, detail: 'network error' }; }
  const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
  const isJson = /json/i.test(ct);
  let body = null;
  if (isJson) { try { body = await r.json(); } catch (e) { return { state: 'TEMPORARY_FAILURE', path, status: r.status, detail: 'invalid JSON' }; } }
  if (r.status === 401 || r.status === 403) return { state: 'UNAUTHORIZED', path, status: r.status, body };
  if (!isJson) return { state: r.status >= 500 ? 'TEMPORARY_FAILURE' : 'CHANNEL_NOT_PROVISIONED', path, status: r.status };
  if (r.status === 404) return { state: 'NOT_FOUND_BY_CORE', path, status: 404, body };
  if (r.status === 503) return { state: 'DEGRADED', path, status: 503, body };
  if (r.status >= 500) return { state: 'TEMPORARY_FAILURE', path, status: r.status, body };
  if (r.ok) return { state: 'LIVE_RESPONSE', path, status: r.status, body };
  return { state: 'TEMPORARY_FAILURE', path, status: r.status, body };
}
if (typeof module !== 'undefined') module.exports = { coreGet, ROUAA_ALLOWED, ROUAA_CORE_BASE };
