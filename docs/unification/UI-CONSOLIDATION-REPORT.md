# UI-CONSOLIDATION-REPORT
**Status: UI_CONSOLIDATED_WITH_CORE_API_GAPS.**

Moved to `quarantine/legacy-snapshot-ui/` (git mv, history kept): `app.js` (snapshot terminal + OBSERVATORY), `data/`, `proof-data/`, `proof-workbench.*`, `p29-consumer/`, legacy tests. Removed: the R8 CI workflow (it tested the quarantined workbench).
Added: `unified/{capabilities,core-client,app}.js`, `unified/unified.css`, new `index.html`, `tests/unified-ui.test.cjs`, CI workflow `unified-ui.yml`, these docs.
Carried: modules grouped A/B/C; each shows classification, contract, and one of: live response, capability-not-exposed, blocked, channel-not-provisioned, temporary failure. Excluded: the dead global-search box (no Core search endpoint).
Verification: 5 contract/static tests pass; DOM smoke test with stubbed Core confirmed rendering for no-channel, live feed, unavailable module and matrix. Not verified: any real Core response; real browser rendering.
