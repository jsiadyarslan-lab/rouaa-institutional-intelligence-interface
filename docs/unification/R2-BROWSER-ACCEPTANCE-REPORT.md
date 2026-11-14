# R2 — Browser Acceptance Report

**Order:** ROUAA-UNIFIED-UI-001-R2 (PR #3 remediation), references finalized by R2A (ROUAA-UNIFIED-UI-001-R2A)
**Tested commit (SHA):** `e9bc35a395ff30477b8255595870ddbfc97e54dc` (branch `unify/canonical-ui-r1`, base `p2.9-interface-verified-intelligence-consumer` @ `56327b3`)
**Status:** `UI_CONSOLIDATED — BROWSER_ACCEPTANCE_PASS — CORE_INTEGRATION_BLOCKED`

## 1. Final evidence references

| Item | Value |
|---|---|
| Tested SHA | `e9bc35a395ff30477b8255595870ddbfc97e54dc` |
| CI run | [43597877354](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43597877354) — conclusion `success` on the same SHA |
| Artifact | [14114609614](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43597877354/artifacts/14114609614) — `browser-acceptance-e9bc35a395ff30477b8255595870ddbfc97e54dc` |
| Artifact size | 4,152,448 bytes |
| Artifact SHA256 | `e2a7ff553c4001ed128271f1c0b7a0e6f00b1ad16d30ad10e19f644abd25b403` |
| Node contract tests | 5/5 pass |
| Browser acceptance tests | 11/11 pass |
| Viewports | 1440, 1280, 1024, 768, 390 |
| Screenshots | 35 |

The artifact contains the 35 full-page screenshots, `acceptance-report.json` (recorded `sha: e9bc35a…`, `passed: true`, 11/11 checks) and `TESTED_SHA.txt` = `e9bc35a…`.

**Test history (superseded):** the same browser suite also passed on the earlier head `3c9fb68` (CI run 43594238982, artifact 14113717337). The run on the final head `e9bc35a` above is the reference of record. The diff between the two heads touches no runtime file (`.gitignore` and documentation only).

## 2. What was tested

Real-browser acceptance of the unified interface (`index.html` + `unified/`) with **Playwright 1.56.1 / Chromium (headless)**, driven by `tests/browser-acceptance.cjs`. The product runtime is untouched: synthetic Core responses and network interception exist **inside the test only**. The product itself contains no fixtures, no mock data, no snapshot fallback and no `/production/*` traffic.

Two modes are exercised:

- **synthetic** — `/core/**` requests are intercepted and answered with in-test synthetic JSON (health, metrics, intelligence feed/object/trace). This verifies rendering paths only; it is **not** a claim about real Core behaviour.
- **nochannel** — `/core` answers nothing (no JSON). This verifies the honest `CHANNEL_NOT_PROVISIONED` states and UI resilience.

## 3. Environment

| Item | Value |
|---|---|
| Runner | `ubuntu-24.04`, Node 22.16.0, Playwright `1.56.1` (pinned), Chromium via `npx playwright install --with-deps chromium` |
| Local re-run | Same suite, Node 24.22.3 — identical results (11/11 pass) |
| Workflow permissions | `contents: read` only; checkout with `persist-credentials: false` |

## 4. Test scope and results (11/11 pass)

| # | Test | Verified | Result |
|---|---|---|---|
| 1 | shell | `index.html` + linked assets load; the three navigation groups (`Executive Intelligence`, `Research & Evidence`, `Production & Governance`); 16 top-nav links; zero page errors / console errors / ≥400 responses outside `/core` | PASS |
| 2 | synthetic-core-flows | `Executive Overview` (contract states + metrics render, no `LIVE_VERIFIED` upgrade), `Intelligence Feed` (rows render, `Not provided by Core` stated), Intelligence Object detail (evidence chain: source URL, representation id, `Evidence chain (trace)`), `Evidence & Provenance` (io_id lookup renders chain), `Data-source Matrix` (1+16 rows; 4 `SNAPSHOT_QUARANTINED`; zero `LIVE_VERIFIED` cells) | PASS |
| 3 | unavailable-modules | 11 `NOT_EXPOSED_BY_CORE` modules and 2 `BLOCKED_NO_SECURE_PATH` modules state it plainly and show no data tables | PASS |
| 4 | no-channel | With `/core` absent: `CHANNEL_NOT_PROVISIONED` stated on overview/feed/evidence/detail; malformed io_id yields `REJECTED_PATH`; navigation intact | PASS |
| 5 | wording | No absolute traceability claim; footer states tracing is shown **only where Core successfully returns a trace**; no `PRODUCTION_READY` / `EVIDENCE_TRACEABILITY_PASS` / `prototype` text | PASS |
| 6 | network-audit | Every product request is **GET, same-origin**, no `authorization`/`x-api-key` headers, no `/production`, `/data/`, `proof-data`, `quarantine` paths; server log GET-only; `localStorage`/`sessionStorage` both empty (no token reaches the browser) | PASS |
| 7–11 | layout @1440/1280/1024/768/390 | Six views per viewport (overview, feed, object detail, evidence, documents, matrix) + no-channel overview: horizontal overflow ≤ 1px; zero page errors; full-page screenshots captured | PASS |

## 5. Honest limits (what this does NOT prove)

- **No live Core was contacted.** All response shaping is synthetic, in-test. No claim of live Core acceptance is made anywhere.
- `LIVE_RESPONSE` in the UI means "Core answered a request" — it is never rendered as `LIVE_VERIFIED`; no module is classified `LIVE_VERIFIED` (matrix asserts zero such cells).
- `/core` is **not provisioned** in any deployment for this repository; Railway services are not linked to a GitHub source (see `RAILWAY-LIVE-DEPLOYMENT-MAP.md`), so no deployment or cutover is part of this change.
- Connection failure renders as `TEMPORARY_FAILURE`, distinct from `CHANNEL_NOT_PROVISIONED` and never conflated with `NOT_EXPOSED_BY_CORE`.
- Screenshots prove rendering integrity and absence of horizontal overflow; they do not by themselves constitute approval of a final commercial/UX design.
- Verdict is bounded to: `UI_CONSOLIDATED — BROWSER_ACCEPTANCE_PASS — CORE_INTEGRATION_BLOCKED`. `PRODUCTION_READY` and `EVIDENCE_TRACEABILITY_PASS` remain withheld.

## R2A addendum (2026-11-14)

R2A (ROUAA-UNIFIED-UI-001-R2A) finalized the evidence record before independent review: this report's reference of record was moved from the `3c9fb68` run to the successful run on the final head `e9bc35a` (CI run 43597877354, artifact 14114609614, SHA256-verified at download); `UI-CONSOLIDATION-REPORT.md`'s outdated "real browser rendering not verified" line was corrected; `README.md`'s credentials wording was made exact (`credentials: 'same-origin'` — same-origin cookies possible, no Core token in the browser); PR #3's description was updated to the final evidence; the workflow gained a `pull_request` trigger targeting `p2.9` (Node + Playwright run in PR context, `contents: read` unchanged). No runtime file changed in R2A.
