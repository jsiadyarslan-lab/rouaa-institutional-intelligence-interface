# ROUAA Institutional Terminal — Unified UI (R1/R2)

**Status: `UI_CONSOLIDATED — CORE_INTEGRATION_BLOCKED`.** Not `PRODUCTION_READY`. Evidence traceability is **not** certified.

## What this is
The single institutional interface for ROUAA. **ROUAA Core is the only source of data.** The interface presents what Core returns and states plainly what Core does not provide. It is read-only.

Runtime files: `index.html`, `brand-tokens.css`, `style.css`, `unified/` (`capabilities.js`, `core-client.js`, `app.js`, `unified.css`).

## Data flow
Browser → `unified/core-client.js` → same-origin `GET /core/...` → Core. The client sends GET only, to an allow-list (`/health`, `/metrics`, `/v1/intelligence`, `/v1/intelligence/{id}`, `/v1/intelligence/{id}/trace`), with no base-URL override. There is no snapshot fallback, no sample data and no call to `/production/*`.

**Credentials.** There is no Core token in the JavaScript, in `localStorage` or in `sessionStorage`, and the client never adds `Authorization` or `X-API-Key` headers. Requests use `credentials: 'same-origin'`, so same-origin cookies (if a deployment sets any) would be sent; the browser itself holds no Core credential. If a server-side proxy ever needs a Core token, that token stays on the server side and is not part of this repository.

**This repository does not provide the `/core` channel, and no deployment has been verified to serve it.** Wherever `/core` does not answer with JSON, contracted modules show `CHANNEL_NOT_PROVISIONED`. A temporary connection failure is shown separately (`TEMPORARY_FAILURE`) and is not a statement about Core's capabilities.

## Module classifications
Defined in `unified/capabilities.js`; rendered at `#/matrix`.

| Class | Meaning |
|---|---|
| `LIVE_VERIFIED` | Real production response observed and schema-checked. **No module has this status.** |
| `CONTRACTED_NOT_LIVE_VERIFIED` | Documented in the Core contract; production behaviour not verified. |
| `NOT_EXPOSED_BY_CORE` | No documented Core endpoint supports it (see gaps register). |
| `BLOCKED_NO_SECURE_PATH` | Needs a credentialed server-side channel that is not verified. |
| `SNAPSHOT_QUARANTINED` | Formerly snapshot-backed; isolated from the runtime in `quarantine/legacy-snapshot-ui/`. |

A response labelled `LIVE_RESPONSE` means Core answered a request; it does not upgrade a module to `LIVE_VERIFIED`.

## Deployment
Per the recorded evidence (`docs/unification/RAILWAY-LIVE-DEPLOYMENT-MAP.md`), the Railway services are not linked to a GitHub source, so the deployed page cannot be rebuilt from a known commit. The public Railway URL does not serve this interface. No deployment or cutover is part of this change.

## Tests
- `node --test tests/unified-ui.test.cjs` — static runtime audit (no snapshots, `/production`, tokens or non-GET) and client-state contract.
- `node tests/browser-acceptance.cjs` — Playwright acceptance (needs `playwright`); uses synthetic responses defined inside the test only, never in the product.
- CI: `.github/workflows/unified-ui.yml`.

## Documents (`docs/unification/`)
Decision, data-source matrix, API consumption matrix, Core API gaps register, integration blockers, consolidation report, R2 browser acceptance report, Railway map.

## History
The pre-R1 description is kept as `quarantine/legacy-snapshot-ui/README.legacy.md`.
