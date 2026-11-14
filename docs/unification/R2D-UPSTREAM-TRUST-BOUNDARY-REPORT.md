# R2D — Upstream Trust Boundary Report

**Order:** ROUAA-UNIFIED-UI-001-R2D (PARTIAL PASS — REQUEST CHANGES on R2C: success responses were still trusted)
**Baseline (recorded before any modification):** branch head `6d1e132f754e14f2473e25758954d6ce4711b285` (== order reference), worktree clean (0 entries), PR #3 open **Draft** targeting `p2.9-interface-verified-intelligence-consumer` (11 commits / 59 files), CI on that head success in both contexts (push `43605539158`, pull_request `43605544220`), `main` `0c5842202e6b` and `p2.9` `56327b3ce10e` unchanged.
**Implementation head:** `83807b9327a6da98ea0649e2cd78e2920f8f6bbc` (branch `unify/canonical-ui-r1`)
**Verdict:** `SUCCESS_RESPONSE_UNATTRIBUTED — NO_UNVERIFIED_CORE_DATA_RENDERING — R2C_REGRESSIONS_PASS — CI_PASS`

## 1. The contradiction that motivated R2D — and how it is resolved

R2C refused to attribute **error** responses to Core without origin proof, but still classified every contract-conforming HTTP 200 as `LIVE_RESPONSE` and rendered it as Core data ("Core health", "Core store counts", Intelligence Objects, evidence chains). That was strict with 404 and lenient with 200 — while an impersonating proxy can emit a contract-perfect 200 exactly as easily as it can emit the error envelope.

R2D removes the asymmetry: **an HTTP 200 proves only that an HTTP answer arrived on the /core route.** Content-Type, JSON shape and schema conformance are explicitly NOT origin evidence. Every 2xx JSON payload now returns as `UNVERIFIED_UPSTREAM_RESPONSE` with the payload preserved verbatim for diagnostics.

| Concept | Before R2D | After R2D |
|---|---|---|
| Successful HTTP answer | `LIVE_RESPONSE` | `UNVERIFIED_UPSTREAM_RESPONSE` |
| Core-attributed, verified response | `LIVE_RESPONSE` (reachable) | `LIVE_RESPONSE` **reserved-unreachable** — only a verified origin attestation can open it (§6) |
| "Core health" / "Core store counts" | rendered as fact | never rendered; payloads appear only in collapsed diagnostics |
| Intelligence Objects | table of records | never rendered; object count noted, payload in diagnostics |
| Evidence chain | rendered chain sections | never rendered; trace payload in diagnostics |

## 2. Verified facts this boundary rests on (inherited from R2C §2, re-confirmed)

- No origin marker is documented between the `/core` channel and Core; Core's transport emits only `Content-Type`, `Content-Length`, optional `ETag`.
- The `/core` channel is not provisioned in any deployment of this repository.
- No header, token or marker was invented to compensate (order §2 prohibition respected).

## 3. Rendering rules now enforced in `unified/app.js`

Every live view — Executive Overview, Intelligence Feed, Intelligence Object Detail, Evidence & Provenance, and the health/metrics parts of Overview — renders, on an unverified 2xx answer:

1. the banner **UPSTREAM ORIGIN UNVERIFIED** with the exact order wording: "An HTTP response was received from the /core route, but its upstream source has not been verified. The payload is retained for diagnostics only and is not presented as trusted ROUAA Core intelligence.";
2. a de-attribution sentence stating what the payload is NOT (not Core health, not Core store counts, not Intelligence Objects, not a verified evidence chain);
3. the raw payload ONLY inside a collapsed `<details>` labelled "Raw response (diagnostics only — upstream origin unverified)".

No zeros or substitute indicators are displayed for missing verification; no field from an unverified payload is presented as institutional intelligence; no module can be upgraded to `LIVE_VERIFIED` from a 200.

**When raw payload display is allowed (order §4):** always inside the collapsed diagnostics section, always labelled unverified — for engineering diagnosis only. **When interpretation is forbidden:** any tabulation, heading, chain or count derived from an unverified payload as if it were Core data.

## 4. Mandatory success-impersonation tests (order §5)

A fake upstream (node) / Playwright route (browser) serves contract-perfect 200 payloads:

1. HTTP 200 JSON matching the Intelligence Object contract (`io-fake-1` full shape) → `UNVERIFIED_UPSTREAM_RESPONSE`, payload retained;
2. HTTP 200 `/metrics` with plausible-looking figures (document_count 1337, fact_count 424242) → same, figures never rendered as counts;
3. HTTP 200 full Intelligence Feed with `next_cursor` → same, no objects rendered, pagination still driven;
4. HTTP 200 trace with source/document/representation/evidence/fact → same, no `.u-chain` sections rendered.

In all cases: no `LIVE_RESPONSE` anywhere (browser asserts its absence from rendered text), no module `LIVE_VERIFIED`, the banner appears with the exact wording, raw payloads are retained in diagnostics. A **static trust gate** additionally greps the runtime: `core-client.js` contains no code path returning `LIVE_RESPONSE`, and `app.js` never branches on it; the runtime-integrity test forbids any test-mode/bypass hook (`test_mode`, `bypass`, `X-Test`, …) and the network audit asserts no `?test=|mock=|fixture=|bypass=` parameter ever appears on a request URL.

## 5. Pagination without trust bypass (order §6)

R2B/R2C pagination behaviour is fully preserved — but now *under* the banner and separated from data trust:

- the cursor/stack decision logic moved into `unified/feed-pagination.js`, a pure presentation-logic module (no network, no trust decisions, no product data), unit-tested in node with synthetic fixtures confined to the test file: the four `next_cursor` cases, goNext/goPrevious/retry semantics, and a 500-deep navigation proving the stack is uncapped and walkable back to the first page;
- the browser still exercises the full sequence under the banner: page 1 → page 2 → last page (`next_cursor: null` → "no further pages" wording only for literal null) → Previous returns exactly page 2; the failure path (page 3 → 503) keeps Previous + Retry, Retry re-requests the same cursor, Previous then restores page 2 — all while no feed page ever renders as a data table;
- the invalid-value case (`next_cursor: 5`) shows "continuation state is unknown", builds no Next link, claims no completeness, keeps the raw payload.

No Test Mode, header or query parameter was added to the product runtime (asserted by tests).

## 6. What a future origin attestation must provide (order §8 — requirement registered, NOT implemented)

`CORE-PROXY-ORIGIN-ATTESTATION` is registered in `CORE-API-GAPS-REGISTER.md` as an independent future requirement: a documented, verifiable method proving that a response on the `/core` channel originated from ROUAA Core through the approved proxy channel. Until such a contract exists (and is verified end-to-end), `LIVE_RESPONSE` — and with it any Core-attributed error state — remains unreachable by construction. Opening the boundary later requires: a Core-emitted origin identifier, a proxy-side attestation/verification step, a documented contract for both, and acceptance tests proving the client cannot be convinced by shape or status alone. None of this was implemented in R2D; no Core, proxy or Railway change was made.

## 7. Test and CI results

| Suite | Result |
|---|---|
| Node (`tests/unified-ui.test.cjs`) | **13/13** — mandatory 200-impersonation (object/metrics/feed/trace contracts), static LIVE_RESPONSE-unreachable gate, R2C regressions (impersonating-proxy 404 envelope, 5xx/401/403/non-JSON matrix, fail-closed no-AbortController, both timeout tests), pure pagination unit tests, allow-list, GET-only/no-token static audit |
| Browser (`tests/browser-acceptance.cjs`) | **19/19** — banner + no-data-table/no-chain on overview/feed/detail/evidence, collapsed-diagnostics retention (payload readable only when expanded), full pagination + recovery + invalid-cursor + missing-field cases under the banner, hung-request abort, 404 attribution, network audit incl. no trust-bypass parameter, 5 viewports zero overflow, 35 screenshots, zero page errors |
| CI on `83807b9` | push and pull_request — see §9 for run IDs and conclusions |
| Workflow | `.github/workflows/unified-ui.yml` unchanged (order §7 did not request workflow changes): Node + Playwright run on `push` (`unify/**`) and `pull_request` (targeting `p2.9`) |

## 8. Unresolved limits (require Core/Proxy work, out of R2D scope)

1. No single response — success or error — can be attributed to Core today; every payload is diagnostics-only. The interface is strictly read-and-diagnose until `CORE-PROXY-ORIGIN-ATTESTATION` exists.
2. `/core` remains unprovisioned; Railway remains unlinked to a GitHub source.
3. Newest-first feed ordering remains a Core contract change (registered in R2C, still open).
4. The unverified-payload banner makes the UI diagnostic rather than analytical by design: that is the honest state of the system, not a regression to fix in the interface.

## 9. Scope compliance (order §9)

No Core change; no `main`/`p2.9` change; no merge (PR #3 stays **Draft**); no deploy or cutover; no secrets/volumes; no invented origin marker; no snapshot data; no 200-as-origin-evidence anywhere; no R3 work. Runtime diff `6d1e132..83807b9`: `unified/core-client.js`, `unified/app.js`, `unified/feed-pagination.js` (new), `index.html` (script tag) — plus the two test files.
