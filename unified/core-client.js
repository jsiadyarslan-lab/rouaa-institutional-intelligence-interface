'use strict';
/* The ONLY network layer of the unified UI. Read-only (GET), same-origin.
   Credentials: the client adds no auth/API-key headers and embeds no token; nothing is stored
   in the browser. Requests use credentials:'same-origin', so cookies set by the serving origin
   would be sent; any token a proxy-side needs must stay on the server (see README "Credentials").
   Core is reached through a same-origin read channel mounted at /core (NOT provisioned by this repo —
   see PRODUCTION-INTEGRATION-BLOCKERS.md). No base-URL override, no snapshot fallback.
   Reliability (R2B): every request is bounded by a hard timeout — a hung connection is aborted
   into TEMPORARY_FAILURE, so the UI can never sit in "Reading Core…" indefinitely. */
const ROUAA_CORE_BASE = '/core';
const ROUAA_TIMEOUT_MS = 10000;
/* Allow-list. cursor = the opaque, URL-encoded continuation token documented by the Core contract
   (GET /v1/intelligence?limit=&cursor= → {objects, next_cursor:string|null}); charset deliberately
   tight — raw '|', extra query parameters or paths inside the value are rejected. */
const ROUAA_ALLOWED = /^\/(health|metrics|v1\/intelligence(\/[A-Za-z0-9._:-]+(\/trace)?)?)(\?limit=\d{1,3}(&cursor=[A-Za-z0-9._~%-]{1,512})?)?$/;
/* states: LIVE_RESPONSE | NOT_FOUND_BY_CORE | UNDETERMINED_404 | UNAUTHORIZED | DEGRADED |
           CHANNEL_NOT_PROVISIONED | TEMPORARY_FAILURE | REJECTED_PATH */

function _aborted(ctrl, e) {
  return !!(ctrl && ctrl.signal && ctrl.signal.aborted) || !!(e && (e.name === 'AbortError' || e.code === 20));
}
/* The documented Core error contract (ROUAA_CORE_INTELLIGENCE_CONTRACT_V1): errors are
   {error:{code, message}}. A JSON 404 carrying this envelope is attributable to Core;
   one without it is not — it gets UNDETERMINED_404, never NOT_FOUND_BY_CORE. */
function _coreErrorEnvelope(body) {
  return !!(body && typeof body === 'object' && body.error && typeof body.error === 'object' &&
    typeof body.error.code === 'string' && body.error.code.length > 0);
}

async function coreGet(path, fetchImpl, timeoutMs) {
  if (!ROUAA_ALLOWED.test(path)) return { state: 'REJECTED_PATH', path };
  const f = fetchImpl || fetch;
  const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : ROUAA_TIMEOUT_MS;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, budget);
  try {
    let r;
    try {
      r = await f(ROUAA_CORE_BASE + path, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      return _aborted(ctrl, e)
        ? { state: 'TEMPORARY_FAILURE', path, detail: 'timeout after ' + budget + 'ms — request aborted' }
        : { state: 'TEMPORARY_FAILURE', path, detail: 'network error' };
    }
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    const isJson = /json/i.test(ct);
    let body = null;
    if (isJson) {
      try { body = await r.json(); } catch (e) {
        return _aborted(ctrl, e)
          ? { state: 'TEMPORARY_FAILURE', path, detail: 'timeout after ' + budget + 'ms — request aborted' }
          : { state: 'TEMPORARY_FAILURE', path, status: r.status, detail: 'invalid JSON' };
      }
    }
    if (r.status === 401 || r.status === 403) return { state: 'UNAUTHORIZED', path, status: r.status, body };
    if (!isJson) return { state: r.status >= 500 ? 'TEMPORARY_FAILURE' : 'CHANNEL_NOT_PROVISIONED', path, status: r.status, detail: r.status >= 500 ? undefined : 'non-JSON answer on the /core channel' };
    if (r.status === 404) {
      /* 404 origin classification (R2B): envelope present → evidence Core answered → NOT_FOUND_BY_CORE;
         JSON 404 without the envelope → origin not provable → UNDETERMINED_404 (never attributed to Core).
         A non-JSON 404 was already routed to CHANNEL_NOT_PROVISIONED above. */
      if (_coreErrorEnvelope(body)) return { state: 'NOT_FOUND_BY_CORE', path, status: 404, body };
      return { state: 'UNDETERMINED_404', path, status: 404, body, detail: 'JSON 404 without the documented Core error envelope; origin not attributable to Core' };
    }
    if (r.status === 503) return { state: 'DEGRADED', path, status: 503, body };
    if (r.status >= 500) return { state: 'TEMPORARY_FAILURE', path, status: r.status, body };
    if (r.ok) return { state: 'LIVE_RESPONSE', path, status: r.status, body };
    return { state: 'TEMPORARY_FAILURE', path, status: r.status, body };
  } finally {
    clearTimeout(timer); /* timer cleaned on every exit path — success, error or abort */
  }
}
if (typeof module !== 'undefined') module.exports = { coreGet, ROUAA_ALLOWED, ROUAA_CORE_BASE, ROUAA_TIMEOUT_MS };
