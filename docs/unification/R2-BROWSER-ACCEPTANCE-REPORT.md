# R2 — Browser Acceptance Report

**Order:** ROUAA-UNIFIED-UI-001-R2 (PR #3 remediation)
**Tested commit (SHA):** `3c9fb68b8b925a73f704de6c78fa15a85ebc8ae9` (branch `unify/canonical-ui-r1`, base `p2.9-interface-verified-intelligence-consumer` @ `56327b3`)
**Status:** `UI_CONSOLIDATED — BROWSER_ACCEPTANCE_PASS — CORE_INTEGRATION_BLOCKED`

## 1. What was tested

Real-browser acceptance of the unified interface (`index.html` + `unified/`) with **Playwright 1.56.1 / Chromium (headless)**, driven by `tests/browser-acceptance.cjs`. The product runtime is untouched: synthetic Core responses and network interception exist **inside the test only**. The product itself contains no fixtures, no mock data, no snapshot fallback and no `/production/*` traffic.

Two modes are exercised:

- **synthetic** — `/core/**` requests are intercepted and answered with in-test synthetic JSON (health, metrics, intelligence feed/object/trace). This verifies rendering paths only; it is **not** a claim about real Core behaviour.
- **nochannel** — `/core` answers nothing (no JSON). This verifies the honest `CHANNEL_NOT_PROVISIONED` states and UI resilience.

## 2. Environment

| Item | Value |
|---|---|
| CI run | [Unified UI acceptance — run 43594238982](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43594238982) (conclusion: `success`, 2026-11-14T12:20:10Z) |
| Runner | `ubuntu-24.04`, Node 22.16.0, Playwright `1.56.1` (pinned), Chromium via `npx playwright install --with-deps chromium` |
| Local re-run | Same SHA, Node 24.22.3 — identical results (11/11 pass) |
| Workflow permissions | `contents: read` only; checkout with `persist-credentials: false` |

## 3. Test scope and results (11/11 pass)

| # | Test | Verified | Result |
|---|---|---|---|
| 1 | shell | `index.html` + linked assets load; the three navigation groups (`Executive Intelligence`, `Research & Evidence`, `Production & Governance`); 16 top-nav links; zero page errors / console errors / ≥400 responses outside `/core` | PASS |
| 2 | synthetic-core-flows | `Executive Overview` (contract states + metrics render, no `LIVE_VERIFIED` upgrade), `Intelligence Feed` (rows render, `Not provided by Core` stated), Intelligence Object detail (evidence chain: source URL, representation id, `Evidence chain (trace)`), `Evidence & Provenance` (io_id lookup renders chain), `Data-source Matrix` (1+16 rows; 4 `SNAPSHOT_QUARANTINED`; zero `LIVE_VERIFIED` cells) | PASS |
| 3 | unavailable-modules | 11 `NOT_EXPOSED_BY_CORE` modules and 2 `BLOCKED_NO_SECURE_PATH` modules state it plainly and show no data tables | PASS |
| 4 | no-channel | With `/core` absent: `CHANNEL_NOT_PROVISIONED` stated on overview/feed/evidence/detail; malformed io_id yields `REJECTED_PATH`; navigation intact | PASS |
| 5 | wording | No absolute traceability claim; footer states tracing is shown **only where Core successfully returns a trace**; no `PRODUCTION_READY` / `EVIDENCE_TRACEABILITY_PASS` / `prototype` text | PASS |
| 6 | network-audit | Every product request is **GET, same-origin**, no `authorization`/`x-api-key` headers, no `/production`, `/data/`, `proof-data`, `quarantine` paths; server log GET-only; `localStorage`/`sessionStorage` both empty (no token reaches the browser) | PASS |
| 7–11 | layout @1440/1280/1024/768/390 | Six views per viewport (overview, feed, object detail, evidence, documents, matrix) + no-channel overview: horizontal overflow ≤ 1px; zero page errors; full-page screenshots captured | PASS |

## 4. Viewports

`1440px, 1280px, 1024px, 768px, 390px` — all pass overflow and error checks; 35 screenshots total.

## 5. Artifacts

- CI artifact: [`browser-acceptance-3c9fb68b8b925a73f704de6c78fa15a85ebc8ae9`](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43594238982) (≈4.15 MB, 30-day retention): screenshots for all 5 viewports + `acceptance-report.json` + `TESTED_SHA.txt`.
- The `acceptance-report.json` records the tested SHA, browser build, viewport list and per-check results; failures would additionally surface as CI annotations.

## 6. Honest limits (what this does NOT prove)

- **No live Core was contacted.** All response shaping is synthetic, in-test. No claim of live Core acceptance is made anywhere.
- `LIVE_RESPONSE` in the UI means "Core answered a request" — it is never rendered as `LIVE_VERIFIED`; no module is classified `LIVE_VERIFIED` (matrix asserts zero such cells).
- `/core` is **not provisioned** in any deployment for this repository; Railway services are not linked to a GitHub source (see `RAILWAY-LIVE-DEPLOYMENT-MAP.md`), so no deployment or cutover is part of this change.
- Connection failure renders as `TEMPORARY_FAILURE`, distinct from `CHANNEL_NOT_PROVISIONED` and never conflated with `NOT_EXPOSED_BY_CORE`.
- Verdict is bounded to: `UI_CONSOLIDATED — BROWSER_ACCEPTANCE_PASS — CORE_INTEGRATION_BLOCKED`. `PRODUCTION_READY` and `EVIDENCE_TRACEABILITY_PASS` remain withheld.
