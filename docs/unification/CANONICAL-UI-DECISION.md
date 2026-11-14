# CANONICAL-UI-DECISION (ROUAA-UNIFIED-UI-001-R1)
- Canonical UI: Institutional Terminal (shell from `index.html`, brand tokens), single entry `index.html`.
- Base: `p2.9-interface-verified-intelligence-consumer` @ `56327b3ce10ecbfafacba2cc2bf7abd82262bc07`. Contains `main` (0c58422) and `p2.8-r8-…` (4184dec) per `git merge-base --is-ancestor`; worktree clean. Work branch: `unify/canonical-ui-r1`.
- Data source: ROUAA Core only, via a same-origin read-only channel `/core/*` (not provisioned by this repo).
- R8 Workbench: not retained as an interface; its R7 snapshot data is quarantined. Its useful structure (evidence chain) is rebuilt on Core `/trace`.
- P2.9 consumer and `server.js`: quarantined as an integration harness; not deployed, not presented as a production bridge.
- Out of scope / untouched: Core, `main`, Railway, secrets, volumes, scheduler.
- Status: `UI_CONSOLIDATED_WITH_CORE_API_GAPS`. Not PRODUCTION_READY; not EVIDENCE_TRACEABILITY_PASS.
