# CANONICAL-UI-DATA-SOURCE-MATRIX
Registry of record: `unified/capabilities.js` (also rendered at `#/matrix`). No module is LIVE_VERIFIED: the implementer cannot reach production and observed no production response.

| Group | Module | Class | Core endpoint |
|---|---|---|---|
| A | Executive Overview | CONTRACTED_NOT_LIVE_VERIFIED | GET /health, /metrics |
| A | Intelligence Feed | CONTRACTED_NOT_LIVE_VERIFIED | GET /v1/intelligence |
| A | Intelligence Object Detail | CONTRACTED_NOT_LIVE_VERIFIED | GET /v1/intelligence/{io_id}, /trace |
| A | Global Search | NOT_EXPOSED_BY_CORE | — |
| B | Documents / Facts / Events | NOT_EXPOSED_BY_CORE | — (only inside per-object chain) |
| B | Evidence & Provenance | CONTRACTED_NOT_LIVE_VERIFIED | GET /v1/intelligence/{io_id}/trace |
| B | Source Detail | BLOCKED_NO_SECURE_PATH | GET /v1/ops/registry/{source_id} (owner) |
| C | Source Registry | BLOCKED_NO_SECURE_PATH | GET /v1/ops/registry, /summary (owner) |
| C | Production Runs, Acquisition & Access, Representations, Retrievals, Production Accounting, Audit & Raw Records | NOT_EXPOSED_BY_CORE | — |
| Legacy | Snapshot Intelligence/Documents/Facts/Sources, R8 Proof Workbench, OBSERVATORY, P2.9 consumer | SNAPSHOT_QUARANTINED | `quarantine/legacy-snapshot-ui/` |

Basis for "contracted": `CORE-API-COVERAGE-MATRIX.md` (Core repo, commit 5581fd12, 2026-11-08) and route literals in Core source (fe9cc6e). Contract-only evidence; a live run may differ.
