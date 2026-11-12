# PWB-001 — Proof Workbench Acceptance Status

Branch: `pwb-001-verified-intelligence-workbench`  
Base: `main` @ `0c5842202e6be54ea1c7edc0b296a1d6ac609f00`

## Implemented

- Added `proof-workbench.html`, `proof-workbench.css` and `proof-workbench.js`.
- Added a navigation link from the existing Institutional Terminal; existing Observatory routes and snapshot data were not replaced.
- Mirrored Core-owned ROUAA proof snapshot files under `proof-data/` (manifest, summary, sources, runs, documents, facts, evidence, events, intelligence objects, deliveries, quality).
- Added 11 read-only views: Overview, Source Universe, Acquisition, Documents, Facts, Evidence, Events, Intelligence Objects, Deliveries, Production Runs, Quality & Integrity.
- The interface distinguishes `R4_ISOLATED_BENCHMARK` from `PRODUCTION_BASELINE`.
- Fixture Facts/Events are explicitly marked `FIXTURE_NOT_INTELLIGENCE`; no Intelligence Object or Delivery is fabricated.
- Snapshot read failures render `DATA SOURCE UNAVAILABLE`; there is no mock-data fallback.
- Responsive styles are present for tablet/mobile widths.

## Data verdict

The snapshot is archived, not live. OP-IO-001 is `BLOCKED_NO_SUPPORTED_INTELLIGENCE_INPUT`. The UI must not be presented as a Live IO-production console.

## Acceptance still pending

No browser session was available to execute screenshots at 1440, 1280, 1024, 768 and 390 pixels; no automated console, horizontal-overflow, route-interaction or visual-regression run was made. The branch and files are committed, but the UI has **not** passed Visual Acceptance.

No changes were merged to `main`; no deployment was made.


## R6 — Snapshot trust controls (2026-11-12)

### Implemented on this branch

- Added `proof-workbench-integrity.js`, loaded before the Workbench controller.
- Before a snapshot is rendered, the browser now checks all ten declared `proof-*.json` exports against the manifest: exact export inventory, byte length, SHA-256, UTF-8/JSON validity, Proof Contract version and `data_scope`; optional `snapshot_kind` and `generated_at` fields are cross-checked when present.
- Missing, modified, malformed, cross-scope or wrong-contract exports fail closed to `DATA SOURCE UNAVAILABLE`. No partial snapshot or mock data is rendered.
- Overview and Quality now distinguish local verification of mirrored JSON export files from upstream attestation states.
- The prior claim “Raw document SHA verified” was replaced. The original 30-document hashes remain `EXECUTOR_REPORTED`; independent reread of original raw blobs is explicitly `NOT_PROVEN` by this Workbench.
- Manifest source-artifact states are displayed as recorded; `EXECUTOR_REPORTED` is never represented as `VERIFIED`.
- Added Node test cases for valid, missing, byte-mutated, cross-scope, wrong-contract and extra-manifest-export snapshots.

### Targeted checks and remaining acceptance

A local Node 22.16.0 smoke harness exercised the verifier logic in six scenarios and all six behaved as expected. This was not execution of the committed repository test file from a branch checkout. The committed tests remain pending.

No real browser session was available. Screenshots at 1440 / 1280 / 1024 / 768 / 390 pixels, console capture, horizontal-overflow checks, eleven-route interaction checks and stale-state acceptance remain **NOT RUN**. The snapshot contract exposes an archived snapshot, but no TTL/freshness threshold was found; the Workbench does not invent one.

### R6 data/acceptance boundary

- `VERIFIED`: the mirrored JSON files pass local SHA-256, byte-length and contract/scope checks in the current browser session.
- `EXECUTOR_REPORTED`: the manifest-level attestation and the prior 30 original-document SHA claim.
- `OBSERVED` / `BLOCKED`: carried source-artifact states, shown as reported in the manifest.
- `NOT_PROVEN`: independent byte reread of the 30 original raw documents and visual/browser acceptance.

This implementation improves snapshot integrity controls; it does not establish a live Core API connection or prove an Intelligence Object. The Workbench remains an archived, read-only R4 snapshot.
