# UI-CONSOLIDATION-REPORT
**Status: UI_CONSOLIDATED_WITH_CORE_API_GAPS.**

Moved to `quarantine/legacy-snapshot-ui/` (git mv, history kept): `app.js` (snapshot terminal + OBSERVATORY), `data/`, `proof-data/`, `proof-workbench.*`, `p29-consumer/`, legacy tests. Removed: the R8 CI workflow (it tested the quarantined workbench).
Added: `unified/{capabilities,core-client,app}.js`, `unified/unified.css`, new `index.html`, `tests/unified-ui.test.cjs`, CI workflow `unified-ui.yml`, these docs.
Carried: modules grouped A/B/C; each shows classification, contract, and one of: live response, capability-not-exposed, blocked, channel-not-provisioned, temporary failure. Excluded: the dead global-search box (no Core search endpoint).
Verification: Node contract/static tests 5/5. Browser acceptance verified by Playwright (Chromium) — 11/11 checks, five viewports (1440–390), 35 screenshots as CI artifacts. Not verified: any real Core response; production `/core` provisioning. Production readiness: not established.

## R2 remediation addendum (2026-11-14, PR #3)

R2 (ROUAA-UNIFIED-UI-001-R2) closed the three acceptance blockers on this PR:

1. **README rewritten** to describe the R1 unified interface only; the pre-R1 description moved to `quarantine/legacy-snapshot-ui/README.legacy.md`. No OBSERVATORY/`/production/*`/snapshot-runtime claims remain in the product description.
2. **Footer/wording corrected**: evidence-chain tracing is presented as available *only where Core successfully returns a trace* — no absolute traceability claim; verified in-browser by the `wording` check.
3. **Real browser acceptance added**: `tests/browser-acceptance.cjs` (Playwright 1.56.1, Chromium) covers the six module views, unavailable/blocked states, no-`/core` resilience, GET-only same-origin network audit, no-token-to-browser, and overflow checks at 1440/1280/1024/768/390. CI uploads screenshots + report as artifacts pinned to the tested SHA.

Verification now: 5/5 node contract tests; 11/11 browser acceptance checks — reference of record CI run [43597877354](https://github.com/jsiadyarslan-lab/rouaa-institutional-intelligence-interface/actions/runs/43597877354), success on final head `e9bc35a`, artifact 14114609614. See `R2-BROWSER-ACCEPTANCE-REPORT.md`.
Still not verified: any real Core response; `/core` provisioning. Status remains `UI_CONSOLIDATED_WITH_CORE_API_GAPS` (R2 verdict: `UI_CONSOLIDATED — BROWSER_ACCEPTANCE_PASS — CORE_INTEGRATION_BLOCKED`).

## R2A evidence-alignment addendum (2026-11-14, PR #3)

R2A (ROUAA-UNIFIED-UI-001-R2A) aligned the evidence record with the actual runs before independent review: the verification paragraph above was rewritten (the outdated "real browser rendering not verified" line removed); the browser acceptance report's reference of record was set to the successful run on final head `e9bc35a` (CI run 43597877354, artifact 14114609614, SHA256 `e2a7ff55…403`, 4,152,448 bytes); README credentials wording made exact; PR #3 description updated; workflow gained a `pull_request` trigger targeting `p2.9`. No runtime file changed in R2A. Verdict: `R2_DOCUMENTATION_ALIGNED — CI_PASS — READY_FOR_INDEPENDENT_REVIEW`.
