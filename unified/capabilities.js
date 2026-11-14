'use strict';
/* ROUAA unified UI — capability registry (single source of truth for the data-source matrix).
   Classifications: LIVE_VERIFIED | CONTRACTED_NOT_LIVE_VERIFIED | NOT_EXPOSED_BY_CORE |
   BLOCKED_NO_SECURE_PATH | SNAPSHOT_QUARANTINED.
   Nothing here is LIVE_VERIFIED: no production response has been observed by the implementer. */
const ROUAA_CLASSIFICATIONS = {
  LIVE_VERIFIED: 'Real production response observed and schema-checked.',
  CONTRACTED_NOT_LIVE_VERIFIED: 'Endpoint is documented in the Core contract; production behaviour not verified.',
  NOT_EXPOSED_BY_CORE: 'No documented Core endpoint supports this capability (see CORE-API-GAPS-REGISTER.md).',
  BLOCKED_NO_SECURE_PATH: 'Needs a credentialed (owner-mode) server-side channel; none is verified for production.',
  SNAPSHOT_QUARANTINED: 'Formerly snapshot-backed; isolated from the product runtime path.'
};
const ROUAA_GROUPS = {
  A: 'Executive Intelligence',
  B: 'Research & Evidence',
  C: 'Production & Governance'
};
const C = 'CONTRACTED_NOT_LIVE_VERIFIED', N = 'NOT_EXPOSED_BY_CORE', B = 'BLOCKED_NO_SECURE_PATH';
const ROUAA_MODULES = [
  { key: 'overview', group: 'A', title: 'Executive Overview', cls: C, endpoints: ['/health', '/metrics'],
    note: 'Evidence coverage and processing latency are not exposed by Core.' },
  { key: 'intelligence', group: 'A', title: 'Intelligence Feed', cls: C, endpoints: ['/v1/intelligence'],
    note: 'Confidence is not emitted by Core.' },
  { key: 'object', group: 'A', title: 'Intelligence Object Detail', cls: C, route: false,
    endpoints: ['/v1/intelligence/{io_id}', '/v1/intelligence/{io_id}/trace'], note: 'Opened from the feed: #/intelligence/<io_id>.' },
  { key: 'search', group: 'A', title: 'Global Search', cls: N, endpoints: [],
    note: 'No search endpoint in the Core contract.' },
  { key: 'documents', group: 'B', title: 'Documents', cls: N, endpoints: [],
    note: 'Documents appear only inside a per-object trace chain; there is no list or browse endpoint.' },
  { key: 'facts', group: 'B', title: 'Facts', cls: N, endpoints: [],
    note: 'Facts appear only inside a per-object chain; there is no list or query endpoint.' },
  { key: 'events', group: 'B', title: 'Events', cls: N, endpoints: [],
    note: 'Events are visible only as event_id/event_type on an object; no events endpoint.' },
  { key: 'evidence', group: 'B', title: 'Evidence & Provenance', cls: C, endpoints: ['/v1/intelligence/{io_id}/trace'],
    note: 'Per-object only. Chain: source → document → representation → evidence → fact.' },
  { key: 'source-detail', group: 'B', title: 'Source Detail', cls: B, endpoints: ['/v1/ops/registry/{source_id}'],
    note: 'Owner-mode route; requires a server-side credential.' },
  { key: 'runs', group: 'C', title: 'Production Runs', cls: N, endpoints: [],
    note: 'The Core contract has no /production/* routes; the browser must not call them.' },
  { key: 'registry', group: 'C', title: 'Source Registry', cls: B, endpoints: ['/v1/ops/registry', '/v1/ops/registry/summary'],
    note: 'Owner-mode routes (404 outside Owner Mode).' },
  { key: 'acquisition', group: 'C', title: 'Acquisition & Access', cls: N, endpoints: [], note: 'No acquisition/access endpoint.' },
  { key: 'representations', group: 'C', title: 'Representations', cls: N, endpoints: [],
    note: 'representation_id and content_sha256 appear only inside a trace; no list endpoint.' },
  { key: 'retrievals', group: 'C', title: 'Retrievals', cls: N, endpoints: [], note: 'No retrievals endpoint.' },
  { key: 'accounting', group: 'C', title: 'Production Accounting', cls: N, endpoints: [],
    note: '/metrics gives aggregate counts only; no production accounting or cost data.' },
  { key: 'audit', group: 'C', title: 'Audit & Raw Records', cls: N, endpoints: [],
    note: 'Core states the audit log is not available; raw JSON exists only per object.' }
];
const ROUAA_QUARANTINED = [
  { title: 'Snapshot Intelligence / Documents / Facts / Sources (data/*.json)', path: 'quarantine/legacy-snapshot-ui/' },
  { title: 'R8 Proof Workbench (proof-data/*.json, R7 snapshot)', path: 'quarantine/legacy-snapshot-ui/' },
  { title: 'OBSERVATORY (browser calls to /production/*)', path: 'quarantine/legacy-snapshot-ui/app.js' },
  { title: 'P2.9 consumer + Node Bridge harness (p29-consumer/)', path: 'quarantine/legacy-snapshot-ui/p29-consumer/' }
];
if (typeof module !== 'undefined') module.exports = { ROUAA_CLASSIFICATIONS, ROUAA_GROUPS, ROUAA_MODULES, ROUAA_QUARANTINED };
