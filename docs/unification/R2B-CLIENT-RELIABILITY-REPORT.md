# R2B — Core Client Reliability & Intelligence Feed Completeness Report

**Order:** ROUAA-UNIFIED-UI-001-R2B (REQUESTED CHANGES on PR #3)
**Baseline:** `docs/unification/R2B-BASELINE-REPORT.md` (recorded before any modification; reference head `4384735`)
**Implementation head:** `7e61c518e9e476dd3ed4315e68a576450c6e82dc` (branch `unify/canonical-ui-r1`, base `p2.9-interface-verified-intelligence-consumer`)
**Verdict:** `CLIENT_RELIABILITY_PASS — FEED_COMPLETENESS_VERIFIED_OR_EXPLICITLY_BOUNDED — CI_PASS`

## 1. Fix 1 — Request timeout (§2)

`unified/core-client.js` now bounds **every** Core request:

- Hard deadline of `ROUAA_TIMEOUT_MS = 10000` (≤ 10 s as ordered), enforced with `AbortController`.
- At the deadline the request is **aborted** and returns `{state:'TEMPORARY_FAILURE', detail:'timeout after 10000ms — request aborted'}` — the UI can never sit in `Reading Core…` indefinitely.
- The timer is cleared in a `finally` block on **every** exit path (success, HTTP error, network error, abort) — no dangling timers.
- All prior distinctions are preserved: `UNAUTHORIZED` (401/403), `NOT_FOUND_BY_CORE`, `DEGRADED` (503), `TEMPORARY_FAILURE` (network error / ≥500 / invalid JSON), `REJECTED_PATH`.
- Timeout can never become `NOT_EXPOSED_BY_CORE` — the abort path returns before any response classification; asserted by test.

Tests added (node): success inside the budget is `LIVE_RESPONSE` with the timer provably cleaned (signal still un-aborted 280 ms past a 200 ms budget); a hung request (signal-respecting fake) returns promptly (< 2 s) as `TEMPORARY_FAILURE` with a `timeout` detail, the signal is genuinely aborted, and the state is never `NOT_EXPOSED_BY_CORE`.
Test added (browser, real Chromium): a `/core/health` route that answers after 10.5 s — the UI aborts at its own 10 s deadline, renders `TEMPORARY_FAILURE [timeout after 10000ms — request aborted]`, leaves no loading state, keeps the answered metrics visible, zero page errors.

## 2. Fix 2 — Intelligence Feed pagination (§3)

**The actual Core contract — extracted before implementation, no invention (full detail in the baseline report):**

| Item | Verified value | Source |
|---|---|---|
| Endpoint | `GET /v1/intelligence?limit=&cursor=` | contract V1 §; `production_transport.py` (`cursor = params.get("cursor", …)`) |
| Response | `{objects: [item…], next_cursor: string \| null}` | contract V1 (`` {objects: [item…], next_cursor: string|null} ``) and the implementation building `objects` + `next_cursor` |
| Cursor | opaque tuple `"derived_at\|event_id\|event_version"`, URL-encoded on the wire; single-part legacy form accepted by Core | `_make_cursor` / `_parse_cursor` |
| Semantics | `next_cursor` = last item of the page, set **only** when more pages exist; `null` ⇔ last page | implementation: `if len(events) > limit and page` |
| Limit | default 50, capped at 200 | implementation docstring |
| Errors | `{error:{code, message}}` envelope | `_send_error` |

**UI behaviour now:**

- Allow-list accepts `?limit=<1-3 digits>(&cursor=<URL-encoded [A-Za-z0-9._~%-]{1,512}>)?`; raw `|`, extra query parameters or cursor-only requests are `REJECTED_PATH`. The client treats the cursor as opaque and URL-encodes it via `encodeURIComponent`.
- 50 records per page is unchanged; a count line states it: `Showing N record(s) — page limit 50 per Core request.`
- `Next page →` button rendered **only** when the response carries a non-null `next_cursor`; `← Previous page` rendered from an in-memory cursor stack (no storage anywhere in the browser — the no-storage audit stays green). Cursors sent are only Core's own values, never user input.
- Completeness honesty: with the contract, `next_cursor: null` renders "Core reports no further pages for this query (next_cursor is null) — no records are silently dropped." If a response lacks the `next_cursor` field entirely, the UI says so and states that results **may** be limited to the first 50 records — the remaining records cannot silently disappear.
- FEED_COMPLETENESS is therefore **VERIFIED** (contract implemented by Core and consumed by the UI) with an **explicit bounded fallback** for contract-violating responses.

Tests added (node): encoded contract-format cursor accepted; cursor-without-limit, raw-`|` cursor, extra params, raw `/` cursor rejected.
Tests added (browser): full next→page 2→prev→page 1 cycle over the documented cursor (asserting the URL-encoded `limit=50&cursor=2026-01-01T00%3A00%3A00Z%7Cev-test-2%7C1` on the wire, the count lines, the last-page statement); a `next_cursor`-less response renders the explicit bound and no buttons.

## 3. Fix 3 — 404 origin classification (§4)

`coreGet()` no longer infers a 404's origin from Content-Type alone. Classification per the documented contract:

| Response on `/core/...` | State | Evidence rule |
|---|---|---|
| JSON 404 carrying `{error:{code,…}}` (the documented Core error envelope) | `NOT_FOUND_BY_CORE` | consistent with Core's canonical error surface → attributed to Core |
| JSON 404 **without** the envelope | **`UNDETERMINED_404`** (new explicit state) | origin not provable — never attributed to Core; detail states exactly this |
| non-JSON 404 (e.g. host HTML page) | `CHANNEL_NOT_PROVISIONED` | a host page, not Core's contract surface → evidence the `/core` mount is not serving Core |
| JSON 503 | `DEGRADED` (unchanged) | Core-reported degraded store |
| JSON 200 | `LIVE_RESPONSE` (unchanged) | — |

The UI renders `UNDETERMINED_404` with its own truthful text ("origin not attributable to Core") and shows the machine-readable detail line. Limitations are stated honestly: envelope-matching is *contract-shape evidence*, and the report does not claim cryptographic origin proof — that would require the Proxy↔Core marker contract which does not exist yet and is recorded as a proxy-work item, not invented here.

Tests added (node): envelope 404 → `NOT_FOUND_BY_CORE`; bare `{}` 404 and malformed-envelope 404 → `UNDETERMINED_404`; HTML 404 → `CHANNEL_NOT_PROVISIONED`; plus 200/503 controls.
Tests added (browser, real Chromium): `intelligence/io-gone` renders `NOT_FOUND_BY_CORE — Core answered 404 for this resource`; `intelligence/io-ambiguous` renders `UNDETERMINED_404 — origin not attributable to Core`; no-channel (host HTML 404) keeps rendering `CHANNEL_NOT_PROVISIONED`.

## 4. §5 — Credentials wording

The `core-client.js` header comment now matches the README exactly: no token embedded in JavaScript, nothing stored in the browser, the client adds no auth/API-key headers, `credentials: 'same-origin'` means same-origin cookies set by the serving origin would be sent, and any token a proxy needs stays server-side. **No authentication behaviour changed.**

## 5. Verification totals

| Suite | Result |
|---|---|
| Node contract/runtime tests (`tests/unified-ui.test.cjs`) | **9/9** (was 5; +4 R2B tests) |
| Browser acceptance (`tests/browser-acceptance.cjs`, Playwright 1.56.1/Chromium) | **15/15** (11 R2 checks all still green + 4 R2B checks: feed-pagination, feed-bounded-no-contract, 404-origin-classification, request-timeout) |
| Viewports | 1440 / 1280 / 1024 / 768 / 390 — 35 screenshots, zero horizontal overflow, zero page errors |
| Static runtime audit | no snapshots, no `/production`, no tokens, GET-only — still enforced on every runtime file |
| Synthetic data | strictly inside the tests; product runtime unchanged in that respect |

## 6. CI evidence

- **Implementation head `7e61c51`**: push run [43601608030](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43601608030) — **success** (all steps green: Node tests → Playwright → annotations → artifacts); pull_request run [43601614447](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43601614447) — **success** (Node + Playwright execute in PR context, as required).
- Artifact: `browser-acceptance-7e61c518…` (4,188,050 bytes, not expired) containing the 35 screenshots + `acceptance-report.json` (`passed: true`, 15 checks) + `TESTED_SHA.txt`.
- Workflow: unchanged from R2A — `push` on `unify/**` **and** `pull_request` targeting `p2.9`, `contents: read` only, pinned Node 22.16.0 / Playwright 1.56.1.

## 7. Scope compliance (§7)

No Core change; no `main`/`p2.9` change; no merge; no Railway deploy or cutover; no secrets/volumes; no new proxy or `/core` channel; no module became `LIVE_VERIFIED`; no R3 work. Runtime files touched: `unified/core-client.js`, `unified/app.js` (both in scope); tests + docs updated. The PR stays **Draft**.

## 8. Remaining limits (unchanged truths)

- No live Core was contacted by any test; all shaping is synthetic and in-test only.
- `/core` remains unprovisioned in deployments; Railway remains not GitHub-source-linked.
- Verdict bounded to `CLIENT_RELIABILITY_PASS — FEED_COMPLETENESS_VERIFIED_OR_EXPLICITLY_BOUNDED — CI_PASS`. `PRODUCTION_READY` and `EVIDENCE_TRACEABILITY_PASS` remain withheld.
