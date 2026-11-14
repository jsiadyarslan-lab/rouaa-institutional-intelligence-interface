# R2C — Upstream Provenance & Pagination Edge Integrity Report

**Order:** ROUAA-UNIFIED-UI-001-R2C (PARTIAL PASS — REQUEST CHANGES on R2B)
**Baseline (recorded before any modification):** branch head `e04ce2286a493b27ffe53530f2a061b7c2f67329` (== order reference), worktree clean (0 entries), PR #3 open **Draft** targeting `p2.9-interface-verified-intelligence-consumer`, CI on that head success in both contexts (push `43601896709`, pull_request `43601901538`), `main` `0c5842202e6b` and `p2.9` `56327b3ce10e` unchanged. No undocumented changes existed.
**Implementation head:** `1096b692d2c42e9754708df0a1c6f015bd41fa77` (branch `unify/canonical-ui-r1`)
**Verdict:** `UPSTREAM_ATTRIBUTION_HONEST — TIMEOUT_FAIL_CLOSED — PAGINATION_EDGE_CASES_PASS — CI_PASS`

> **Superseded in part by R2D (ROUAA-UNIFIED-UI-001-R2D):** this report stopped attributing ERROR responses to Core but still treated contract-conforming HTTP 200 answers as `LIVE_RESPONSE` Core data. R2D closed that boundary: every 2xx payload is now `UNVERIFIED_UPSTREAM_RESPONSE`, rendered only as diagnostics under the UPSTREAM ORIGIN UNVERIFIED banner. See `R2D-UPSTREAM-TRUST-BOUNDARY-REPORT.md`; the table in §2 below describes the pre-R2D client behaviour for errors (still accurate) and the pre-R2D treatment of successes (historical).

## 1. Upstream-origin marker — the verified fact (§2.4)

**No verified upstream-origin marker exists in the current system.** What was checked, before writing any code:

- Core's own transport (`intelligence_core/production_transport.py`, `_send_json`): it emits **only** `Content-Type`, `Content-Length`, an optional `ETag`, and optional `extra_headers` (used for failure-integrity provenance inside error bodies — not origin proof). No identifying origin header is defined by Core's contract.
- The interface repository (`docs/unification/*`, README): no documented proxy↔Core origin-marker contract of any kind.
- The `/core` same-origin channel itself is **not provisioned** in any deployment of this repository (PRODUCTION-INTEGRATION-BLOCKERS.md), so there is not even a proxy whose behaviour could constitute evidence.

Consequence adopted in code: a response's shape (JSON, HTML, or even the documented Core error envelope `{error:{code,message}}`) is **never** origin proof. An impersonating proxy or gateway can emit any of these shapes.

## 2. Attribution table — what can and cannot be attributed to Core (§2)

| Response on `/core/...` | R2B behaviour | R2C behaviour | Rationale |
|---|---|---|---|
| JSON 404 **with** the documented envelope | `NOT_FOUND_BY_CORE` (attributed to Core) | **`UNDETERMINED_404`** + detail "shape evidence only; origin not proven" | envelope is reproducible by any proxy; not origin proof |
| JSON 404 without envelope | `UNDETERMINED_404` | `UNDETERMINED_404` | unchanged |
| HTML 404 | `CHANNEL_NOT_PROVISIONED` | **`UNDETERMINED_404`** | a host page alone says nothing provable about provisioning |
| JSON 503 | `DEGRADED` ("Core reported a degraded store") | **`TEMPORARY_FAILURE`** + detail "5xx not attributable to Core without origin proof" | 5xx without origin proof must not be called a Core store fault |
| HTML 200 | `CHANNEL_NOT_PROVISIONED` | **`UNDETERMINED_RESPONSE`** | non-contract response, origin unproven |
| JSON other non-2xx (400/405/429…) | `TEMPORARY_FAILURE` | **`UNDETERMINED_RESPONSE`** (+ "shape evidence only" note when envelope present) | conservative, honest; documented decision under §2.5's principle |
| JSON 200 | `LIVE_RESPONSE` | `LIVE_RESPONSE` (text unchanged: "contract not production-verified") | display stays verbatim; no origin claim added |
| 401/403 | `UNAUTHORIZED` | `UNAUTHORIZED` (text no longer says "Core rejected") | kept distinct per order §2.5; no upstream attribution |
| network error / timeout / 5xx | `TEMPORARY_FAILURE` | `TEMPORARY_FAILURE` | unchanged bucket, now explicitly non-attributing |

`NOT_FOUND_BY_CORE`, `DEGRADED`, and `CHANNEL_NOT_PROVISIONED` remain **defined in the UI vocabulary, marked "reserved — requires origin proof / deployment-level evidence"**, and are unreachable by inference. They become reachable only when a real marker contract exists (future Proxy↔Core work — deliberately **not invented** here, per §2.7). The raw response is shown verbatim on every failure state that carries a body.

**Mandatory test (order §2):** a fake fetch — i.e. an impersonating proxy — answers with the byte-shape Core documents (`{error:{code:'IO_NOT_FOUND',…}}`); the client returns `UNDETERMINED_404`, never `NOT_FOUND_BY_CORE` (node test, and browser test `io-gone` renders it with the "shape evidence only" detail).

## 3. Timeout guarantee — fail-closed (§3)

- Supported environments (all modern browsers, Node ≥ 18, CI): unchanged R2B behaviour — 10 s deadline (`ROUAA_TIMEOUT_MS = 10000`), real abort via `AbortController`, timer cleaned in `finally` on every exit path, abort → `TEMPORARY_FAILURE [timeout after 10000ms — request aborted]`. R2B's timeout tests are kept and green.
- **Without `AbortController`: the request is not sent at all.** `coreGet` returns `TEMPORARY_FAILURE [timeout guarantee unavailable (no AbortController) — request not sent (fail-closed)]`. No un-cancellable request can ever be issued, so the "Reading Core…" hang is impossible, not merely unlikely. Tested by removing the global and asserting the fake fetch is never invoked.
- `Promise.race` was not used, exactly as ordered: resolving the UI wait is not cancellation.

## 4. The four next_cursor cases (§4)

| next_cursor value | UI behaviour |
|---|---|
| non-empty string | `Next page →` built from that value (URL-encoded, allow-list-checked) |
| literal `null` | "Core reports no further pages for this query (next_cursor is null) — no records are silently dropped." |
| field absent | "…the feed may be showing only the first 50 records; completeness beyond this page cannot be stated…" |
| any other value (number, object, empty string) | "…invalid value (neither a non-empty string nor null) — continuation state is unknown; no completeness is claimed and no further-page link is offered. Raw response is shown below." |

The "next_cursor is null" wording now renders **only** for a literal `null` (the R2B bug where an invalid value produced a false last-page claim is fixed and browser-tested in `feed-invalid-cursor-value`).

## 5. Pagination recovery (§5)

- A failed page load renders the failure state **plus** `← Previous page` (whenever the stack holds a page) **plus** `Retry this page` — the analyst is never stranded.
- Retry re-requests the **same** cursor; neither the cursor nor the stack is mutated by a failure.
- The silent stack cap (`if (feedStack.length > 200) feedStack.shift()`) is **removed**: navigation history is never silently dropped. The stack is in-memory, session-scoped, and cleared on reload — which is inherent to the documented no-storage policy, not a hidden limit.
- Browser-tested sequence: page 1 → page 2 → page 3 fails (503) → Previous/Retry both visible → Retry re-hits the same page-3 cursor (≥ 2 requests with that cursor asserted) → Previous returns exactly page 2.

## 6. Feed ordering (§6)

- Core sorts ascending by `(derived_at, event_id, event_version)` — **oldest first**. The UI now states this above the feed: "Order: oldest first — Core canonical ordering by (derived_at, event_id, event_version)." and never reverses locally (a client-side reversal would corrupt cross-page cursor semantics).
- `CORE-API-GAPS-REGISTER.md` gained the row "Intelligence feed ordering (R2C §6)": a future, independent Core requirement for a newest-first view via a proper `order` parameter with order-aware cursor semantics; client-side reversal is recorded as NOT an acceptable substitute. Core was not modified.

## 7. Tests and CI (§7)

| Suite | Result |
|---|---|
| Node (`tests/unified-ui.test.cjs`) | **10/10** — incl. the mandatory impersonating-proxy case, the full no-attribution matrix (404 JSON/HTML, 503 with/without envelope, HTML 200, 405 envelope, network error), fail-closed no-`AbortController`, kept R2B timeout tests, cursor allow-list, GET-only/no-token static audit |
| Browser (`tests/browser-acceptance.cjs`) | **17/17** — all R2/R2B checks still green plus `feed-invalid-cursor-value`, `pagination-recovery`, and the browser impersonating-proxy attribution check; 35 screenshots, 5 viewports, zero overflow, zero page errors |
| Workflow | `.github/workflows/unified-ui.yml` **required no change**: it already runs Node contract tests and Playwright acceptance on `push` (`unify/**`) and `pull_request` (targeting `p2.9`), `contents: read` only, pinned Node 22.16.0 / Playwright 1.56.1 |
| CI on `1096b69` | push [43605227341](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43605227341) — **success**; pull_request [43605233250](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43605233250) — **success**; artifact `browser-acceptance-1096b692…` (4,252,566 bytes, not expired) |

## 8. Unresolved limits — require Core or Proxy work, out of R2C scope (§9 respected)

1. **No origin proof is possible yet**: attributing any single response (including 200s) to Core requires a documented, verified upstream-origin marker contract between the `/core` proxy and Core. Until then every error state stays unattributed — honest, but weaker in diagnostics.
2. **Newest-first feed** needs the Core contract change registered in the gaps register; the UI cannot provide it honestly today.
3. **`/core` remains unprovisioned**; Railway remains not GitHub-source-linked; `CHANNEL_NOT_PROVISIONED` stays reserved for explicit deployment-level evidence.
4. No live Core was contacted by any test; all shaping is synthetic and test-only.

## 9. Scope compliance (§9)

No Core change; no `main`/`p2.9` change; no merge; no Railway deploy or cutover; no secrets/volumes; no new proxy and **no invented origin marker**; no module became `LIVE_VERIFIED`; no R3 work. Runtime files touched: `unified/core-client.js`, `unified/app.js` (in scope); tests and the gaps register updated; PR #3 stays **Draft**.
