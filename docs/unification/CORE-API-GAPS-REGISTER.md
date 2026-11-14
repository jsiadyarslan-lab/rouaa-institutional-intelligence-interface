# CORE-API-GAPS-REGISTER
Requirements for a separate Core task (no Core change was made here). Common rules for every gap: read-only GET; each record carries source_id, document_id/canonical_url, representation_id + content_sha256, evidence ids; pagination (`limit`, `cursor`); 401 without token; errors as `{code, message}`; acceptance test = live response matches schema and every record resolves to its source via the trace.

| Gap | Needed data | Endpoint (proposed) | Response shape (proposed) | Acceptance test |
|---|---|---|---|---|
| Documents | document list/filter by source, date | GET /v1/documents | `{documents:[{document_id, source_id, canonical_url, retrieved_at, representation_ids[]}], next_cursor}` | every document_id resolves to ≥1 representation and its source |
| Representations | representation metadata | GET /v1/representations[/{id}] | `{representation_id, document_id, content_sha256, media_type, size, retrieved_at}` | recomputed sha256 of served blob equals content_sha256 |
| Evidence | evidence rows | GET /v1/evidence[/{id}] | `{evidence_id, fact_id, representation_id, locator}` | locator resolves inside the representation |
| Facts | facts list/filter | GET /v1/facts[/{id}] | `{fact_id, event_id, evidence_ids[], version}` | each fact lists ≥1 evidence |
| Events | events list | GET /v1/events[/{id}] | `{event_id, event_type, fact_ids[], io_ids[]}` | event ↔ IO link round-trips |
| Source traceability | reverse lookup source → objects | GET /v1/sources/{id}/objects | `{source_id, io_ids[]}` | forward trace and reverse lookup agree |
| Search | text search over objects | GET /v1/search?q= | `{results:[{type,id,snippet}]}` | known object returned by its headline |
| Production runs/accounting/audit | run registry, counts, cost, audit log | GET /v1/runs, /v1/accounting, /v1/audit | to be specified | owner-mode only; figures reconcile with /metrics |
| Owner routes via UI | credentialed read for registry | server-side channel (see blockers); never a browser token | — | no secret reaches the browser |
