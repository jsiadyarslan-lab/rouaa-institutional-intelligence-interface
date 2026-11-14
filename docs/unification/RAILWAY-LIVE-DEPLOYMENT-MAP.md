# RAILWAY-LIVE-DEPLOYMENT-MAP (Phase 1 — read-only evidence, 2026-11-14)

Project: rouaa-intelligence-ops-console (6bd32d3a…) · Environment: production (c96e9b9b…) · Region: sfo

| Service | ID | Public domain | Port | Builder | Volume | Last deploy (UTC) | Source repo/branch/SHA |
|---|---|---|---|---|---|---|---|
| rouaa-intelligence-ops-console (UI) | 5fc09e95… | rouaa-intelligence-ops-console-production.up.railway.app | 8080 | RAILPACK | none | 2026-11-13 21:56 (eb1fabad) | **BLOCKED** — no GitHub source attached |
| rouaa-intelligence-core-api (Core) | a8b0a9c4… | rouaa-intelligence-core-api-production.up.railway.app | 9100 | RAILPACK | rouaa-intelligence-ops-console-volume (500 MB) → /data | 2026-11-14 11:59 (ca3a215b) | **BLOCKED** — no GitHub source attached |

Variables (names only): UI = ACT001_CORE_COMMIT, CORE_TOKEN, CORE_URL. Core = 15 names incl. CORE_API_TOKEN, CORE_SCHEDULER_*, CORE_HTML_ACQUISITION, CORE_P29_READ_CONTRACT, OPS_CONSOLE_OWNER_MODE, PORT.
Start/build commands: not exposed in service config (default RAILPACK).

## Findings
1. Both services were deployed by direct upload (all recent deployments by the account owner); neither is linked to a repo/branch, so deployment → commit mapping cannot be proven. **BLOCKED.**
2. The public page `/proof-workbench.html` matches `proof-workbench.html` on branches `p2.8-r8-complete-institutional-workbench` and `p2.9-interface-verified-intelligence-consumer` (identical file, md5 80e43e3f…); it does NOT match `pwb-001`/`pwb-002`. p2.8 vs p2.9 cannot be distinguished from this file alone. **Partially proven.**
3. The UI service holds CORE_TOKEN as a server-side variable (consistent with the "no browser token" rule; browser exposure not yet verified).
4. Repo state: interface `main` (0c58422, 10 files) carries only delivery configuration; the workbench lives only on feature branches. Core `main` = fe9cc6e; `console/` there is a separate internal console.
5. Core deployment history shows 3 FAILED + 2 REMOVED deployments on 2026-11-14 before the current SUCCESS.

## Not yet verified
Build/start commands, Node Bridge presence, Core API response per endpoint, volume contents.
