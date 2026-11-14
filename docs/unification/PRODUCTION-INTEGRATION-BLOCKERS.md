# PRODUCTION-INTEGRATION-BLOCKERS
1. **No provisioned read channel.** The UI expects same-origin `/core/*` → Core (GET only, token attached server-side). Nothing in this repo provides it; the P2.9 `server.js` is an isolated harness and is not to be deployed as production. Until a channel is provisioned and verified, every contracted module reports CHANNEL_NOT_PROVISIONED.
2. **Deployment not reproducible from GitHub.** Both Railway services have no GitHub source attached (direct uploads); deployment → commit cannot be proven (see `docs/unification/RAILWAY-LIVE-DEPLOYMENT-MAP.md`). Public URL currently serves the R8 snapshot workbench.
3. **Contracts unverified live.** Implementer has no network path to railway.app; all endpoints are CONTRACTED_NOT_LIVE_VERIFIED at best. Verify `/health`, `/metrics`, `/v1/intelligence`, `/v1/intelligence/{id}/trace` from a permitted environment.
4. **Owner-mode routes** require a credentialed server-side path (BLOCKED_NO_SECURE_PATH).
5. **Core gaps** — see `CORE-API-GAPS-REGISTER.md`. EVIDENCE_TRACEABILITY_PASS and PRODUCTION_READY remain withheld.
6. Not done by design: no cutover, no Railway change, no secret handling, no Core change.
