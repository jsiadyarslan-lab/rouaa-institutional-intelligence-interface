# CORE-API-CONSUMPTION-MATRIX
Client: `unified/core-client.js`. GET only, same-origin base `/core`, allow-list `health | metrics | console/config | v1/intelligence[/{id}[/trace]][?limit=N]`. No credentials, no base override, no fallback.

| UI module | Request | Fields consumed | Runtime states shown |
|---|---|---|---|
| Executive Overview | /health, /metrics | status; source/document/fact/event/io counts | all client states |
| Intelligence Feed | /v1/intelligence?limit=50 | objects[].io_id, headline, event_type, status, created_at | unrecognized schema → raw verbatim; missing field → "Not provided by Core" |
| Object Detail | /v1/intelligence/{id}, /trace | io_id, event_id, event_type, event_version, status, created_at, supersedes_io_id; chain[].source, document.canonical_url, representation.representation_id/content_sha256, evidence, fact | 404 / 503 degraded (code shown) / 401 |
| Evidence & Provenance | via Object Detail | same | same |

Client states: LIVE_RESPONSE, NOT_FOUND_BY_CORE, UNAUTHORIZED, DEGRADED, CHANNEL_NOT_PROVISIONED (capability unverified), TEMPORARY_FAILURE (retry; says nothing about capability), REJECTED_PATH. Tests: `tests/unified-ui.test.cjs`.
