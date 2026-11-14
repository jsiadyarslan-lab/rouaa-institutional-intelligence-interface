'use strict';
/* The ONLY network layer of the unified UI. Read-only (GET), same-origin.
   Credentials: the client adds no auth/API-key headers and embeds no token; nothing is stored
   in the browser. Requests use credentials:'same-origin', so cookies set by the serving origin
   would be sent; any token a proxy-side needs must stay on the server (see README "Credentials").
   Core is reached through a same-origin read channel mounted at /core (NOT provisioned by this repo —
   see PRODUCTION-INTEGRATION-BLOCKERS.md). No base-URL override, no snapshot fallback.
   Reliability (R2B/R2C): every request is bounded by a hard timeout enforced with AbortController;
   if abort support is unavailable the request is NOT SENT at all (fail-closed) — no un-cancellable
   request is ever issued.
   Upstream attribution (R2C/R2D): the current system has NO verified upstream-origin marker between
   the /core channel and Core (Core's transport emits only Content-Type/Content-Length/ETag), so NO
   response — error OR success — is attributed to Core from its shape, Content-Type or HTTP status
   alone. An impersonating proxy can emit any shape, including a contract-perfect HTTP 200. Therefore
   every 2xx JSON payload is returned as UNVERIFIED_UPSTREAM_RESPONSE: preserved verbatim for
   diagnostics, never presented as trusted Core data. See R2D-UPSTREAM-TRUST-BOUNDARY-REPORT.md. */
const ROUAA_CORE_BASE = '/core';
const ROUAA_TIMEOUT_MS = 10000;
/* Allow-list. cursor = the opaque, URL-encoded continuation token documented by the Core contract
   (GET /v1/intelligence?limit=&cursor= → {objects, next_cursor:string|null}); charset deliberately
   tight — raw '|', extra query parameters or paths inside the value are rejected. */
const ROUAA_ALLOWED = /^\/(health|metrics|v1\/intelligence(\/[A-Za-z0-9._:-]+(\/trace)?)?)(\?limit=\d{1,3}(&cursor=[A-Za-z0-9._~%-]{1,512})?)?$/;
/* states returned by coreGet: UNVERIFIED_UPSTREAM_RESPONSE | UNDETERMINED_404 | UNDETERMINED_RESPONSE |
   UNAUTHORIZED | TEMPORARY_FAILURE | REJECTED_PATH.
   LIVE_RESPONSE stays in the UI vocabulary but is UNREACHABLE (R2D): it may only become reachable
   when a documented, verified upstream-origin attestation contract exists (CORE-PROXY-ORIGIN-
   ATTESTATION in CORE-API-GAPS-REGISTER.md) — never from HTTP 200, Content-Type or schema
   conformance alone. NOT_FOUND_BY_CORE / DEGRADED / CHANNEL_NOT_PROVISIONED likewise remain
   reserved-unreachable. */

function _aborted(ctrl, e) {
  return !!(ctrl && ctrl.signal && ctrl.signal.aborted) || !!(e && (e.name === 'AbortError' || e.code === 20));
}
/* Shape check against the documented Core error envelope {error:{code,message}}.
   R2C: shape evidence ONLY — never origin proof. Kept for diagnostic detail strings only;
   it never upgrades any state to a Core-attributed one. */
function _coreErrorEnvelope(body) {
  return !!(body && typeof body === 'object' && body.error && typeof body.error === 'object' &&
    typeof body.error.code === 'string' && body.error.code.length > 0);
}

async function coreGet(path, fetchImpl, timeoutMs) {
  if (!ROUAA_ALLOWED.test(path)) return { state: 'REJECTED_PATH', path };
  const f = fetchImpl || fetch;
  if (typeof AbortController === 'undefined') {
    /* R2C fail-closed: without a real cancellation mechanism the timeout guarantee cannot be
       enforced, so the request is not sent — a hung connection becomes impossible, not unlikely. */
    return { state: 'TEMPORARY_FAILURE', path, detail: 'timeout guarantee unavailable (no AbortController) — request not sent (fail-closed)' };
  }
  const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : ROUAA_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    let r;
    try {
      r = await f(ROUAA_CORE_BASE + path, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: ctrl.signal });
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
    if (r.status === 404) {
      /* R2C: no upstream-origin marker exists — every 404, JSON or not, stays UNDETERMINED_404;
         never attributed to Core, never read as proof about the channel's provisioning state. */
      return _coreErrorEnvelope(body)
        ? { state: 'UNDETERMINED_404', path, status: 404, body, detail: 'contract-shaped error envelope present — shape evidence only; no upstream-origin marker exists, origin not proven' }
        : { state: 'UNDETERMINED_404', path, status: 404, body, detail: 'origin not provable from the response alone' };
    }
    if (r.status >= 500) return { state: 'TEMPORARY_FAILURE', path, status: r.status, body, detail: 'HTTP ' + r.status + ' — 5xx not attributable to Core without origin proof' };
    if (r.ok) {
      /* R2D: a successful HTTP answer proves ONLY that an HTTP answer arrived on the /core route.
         Content-Type, JSON shape and schema conformance are NOT origin evidence — a proxy or
         gateway can emit a contract-perfect 200 (success-response impersonation). The payload is
         preserved verbatim for diagnostics only and is never classified as trusted Core data.
         A non-JSON 2xx carries no payload to interpret. */
      return isJson
        ? { state: 'UNVERIFIED_UPSTREAM_RESPONSE', path, status: r.status, body, detail: 'HTTP ' + r.status + ' received on the /core route — upstream origin not verified; payload retained for diagnostics only, not presented as trusted ROUAA Core intelligence' }
        : { state: 'UNVERIFIED_UPSTREAM_RESPONSE', path, status: r.status, detail: 'HTTP ' + r.status + ' received on the /core route — non-JSON body, upstream origin not verified' };
    }
    /* other non-2xx JSON (400/405/429/…) — envelope shape is not origin proof either (R2C) */
    return { state: 'UNDETERMINED_RESPONSE', path, status: r.status, body, detail: _coreErrorEnvelope(body) ? 'contract-shaped error envelope — shape evidence only; origin not proven' : 'JSON error response — origin not provable from the response alone' };
  } finally {
    clearTimeout(timer); /* timer cleaned on every exit path — success, error or abort */
  }
}
if (typeof module !== 'undefined') module.exports = { coreGet, ROUAA_ALLOWED, ROUAA_CORE_BASE, ROUAA_TIMEOUT_MS };
