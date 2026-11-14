> **ARCHIVAL — historical description of the pre-R1 snapshot-era interface (p2.9). It does not describe the current product. See /README.md.**

# ROUAA INSTITUTIONAL INTELLIGENCE — INTERFACE PROTOTYPE V2 (BLACK INSTITUTIONAL TERMINAL)

**Public deployment (GitHub Pages)** of the institutional consumption interface, evolved per
*ROUAA INSTITUTIONAL INTELLIGENCE INTERFACE — V2* executive directive: presentation layer only,
**better consumption of existing truth — not creation of new truth.**

## OBSERVATORY — live production observation (V1 integration)

The **OBSERVATORY** navigation key is a *live read window* onto the ROUAA Core
**Production Observation API** (`/production/*`, read-only, GET only, polling V1),
delivered by *FRONTEND LIVE OBSERVATORY INTEGRATION V1*. It is distinct from the frozen
snapshot below:

- **Live, not stored.** Every run, metric, source and failure figure is read from the live
  API response through a single dedicated client layer (`OBS` in `app.js`). No production
  number is stored in, or hard-coded by, this interface. If the API is unreachable, the
  surface states **NOT AVAILABLE** — it never fabricates.
- **Read-only invariant.** The client can only issue `GET`. Starting, stopping or mutating a
  run is impossible from the interface.
- **Real run drill-down.** RUN registry → run detail (identity / environment / source,
  document and intelligence accounting / failure classes / reconciliation status) →
  sources, documents, facts, events, intelligence and failures ledgers, each row expandable
  to its verbatim API record.
- **Failures are honest.** The order's eight failure classes are rendered as served; a zero
  is displayed as an explicit zero — never hidden, never restyled as "healthy".
- **Operator configuration.** API base resolves from the `?api=` query parameter, then a
  persisted setting (in-browser), then the documented default. The Core server grants
  origins via its per-origin CORS allowlist — deployment operators decide who may read.
- **Static audit.** The observatory code contains zero production constants; the whole file
  issues exactly one class of production reads (GET through the OBS client).

## What you are looking at

A **read-only black institutional intelligence terminal** built exclusively from real ROUAA
Core production outputs. V2 re-architects the interface around the analyst workstation:
dense tables, evidence traces, and first-class documents, facts and sources — not cards.

- **It is NOT a live feed.** It is a frozen repository production snapshot.
- **It is NOT a mockup.** Every intelligence object, fact, excerpt, document and source
  is real, committed output of ROUAA Core.
- **Nothing is invented.** Missing Core capabilities (semantic titles, interpretation
  layer, fact units/periods) are stated explicitly, never filled by the interface.

## V2 interface architecture

`OVERVIEW · INTELLIGENCE · DOCUMENTS · FACTS · SOURCES · PRODUCTION`
(EVENTS omitted deliberately: no separate events store exists in the snapshot.)

- **OVERVIEW** — answers *What happened? / What is important? / What can I verify?* in
  seconds, then the Intelligence Feed ordered FRESH (26) → HISTORICAL (47) → UNDATED (74);
  no temporal class is hidden.
- **INTELLIGENCE** — IO as the primary unit, identified by real metadata (institution +
  event type); Core template headlines demoted to technical provenance. Table view:
  `Status | Institution | Type | Date | Facts | Evidence | Document` with sorting,
  filtering and pagination. Detail pages follow the institutional reading order:
  identity → CONTEXT → WHAT HAPPENED → KEY FACTS → EVIDENCE → PRIMARY DOCUMENT → SOURCE.
- **EVIDENCE VIEW & TRACE EVIDENCE** — per-fact chain `FACT → EXCERPT → DOCUMENT → SOURCE`
  and per-IO chain `SOURCE → DOCUMENT → EVIDENCE → FACT → INTELLIGENCE OBJECT`; every
  level clickable; `pattern:…#occ` shown only as *Technical location*.
- **FACTS** — dedicated explorer over 1,989 IO-bound facts (2,360 exist; 371 not IO-bound,
  stated honestly). `UNIT` and `PERIOD` columns reserved for future Core schema — never
  invented.
- **DOCUMENTS** — first-class objects: 957 records, search across url / institution /
  source / jurisdiction / type / date, pagination 25/50/100, document record pages.
- **SOURCES** — real entity profiles: metadata, production, freshness, evidence coverage,
  and the `SOURCE → DOCUMENT → FACT → INTELLIGENCE` relationship (42 VIO-producing
  sources vs 357 registered).
- **PRODUCTION** — deliberately demoted transparency section with committed wave
  accounting, S-levels, verification, and discovered/acquired/stored/productive
  definitions.
- **Global search** — one search bar across intelligence, facts, documents and sources
  with categorized results.
- **Trust badges are data-backed only**: OFFICIAL SOURCE / EVIDENCE LINKED / TRACEABLE /
  FRESH / HISTORICAL / UNDATED. No "verified/trusted/high-quality" claims — Core supplies
  no basis for them.
- **CONTEXT is honest**: *"No interpretation supplied by Core."* — the interface never
  sells analysis that does not exist.

## Snapshot provenance

| Field | Value |
|---|---|
| Core repository | `jsiadyarslan-lab/rouaa-intelligence-core` (private) |
| Interface branch | `rouaa-institutional-intelligence-interface-v1` (V2 commit `d8b1fc5`) |
| Production commit | `c78b96af53e4d66eb81a45557cc82e952cd973da` |
| Production wave | LSE-V4 (run `lsev4-targeted-high-yield-fresh-production`) |
| Snapshot date | 2026-09-19 |
| Fresh window (frozen) | 2026-08-19 → 2026-09-18 (retrieval time never used as publication) |

## Contents

- 147 intelligence objects — 100% of the wave's VIO production (135 net-new + 12
  re-discoveries; net-new freshness ladder 23 fresh / 39 historical / 73 undated, exact
  match to official scorecard; all-147 ladder 26/47/74)
- 957 official documents (canonical URLs, freshness classification, text layers)
- 357 wave sources with full registry profiles
- Full wave + global production accounting (demoted PRODUCTION view)

## Reproducibility

The presentation data in `data/` is generated by the read-only adapter
(`interface/build_presentation.py`) committed on the interface branch of the Core
repository, from committed Core production artifacts. The committed JSON is
byte-identical to the adapter output at the production commit above. V2 changed
presentation files only (`index.html`, `style.css`, `app.js`); data files are unchanged.

## Primary user persona

> A senior bank executive / institutional investment or risk executive reviewing
> intelligence at the beginning of the business day; an institutional analyst working a
> dense desk; a forensic reviewer who must verify every claim to its official source.

Acceptance-tested against all three personas (executive 10 s / analyst 30 s / forensic
60 s). Desktop-first; tablet-responsive.


## P2.8-R8 — COMPLETE INSTITUTIONAL WORKBENCH

The R8 Workbench is an additive, read-only institutional explorer on the isolated
branch `p2.8-r8-complete-institutional-workbench`. It is not a replacement for
the existing Institutional Terminal or Observatory, and this branch is not a
Railway deployment record.

### Data scope and trust boundary

- The current R7 dataset is an `ARCHIVED_SNAPSHOT`, generated from Core commit
  `5d7b76feed6215673da800d5b60e9690477970ce` and run
  `p28r7-src-istat-october-2026`.
- The browser verifies the manifest-declared byte lengths, SHA-256 digests,
  schema version, data scope and run/execution identity before rendering.
  `VERIFIED` in the snapshot banner refers to this archive-integrity check only.
- The Istat annual NIC inflation fact is `+5.4%` for October 2026 and remains
  `DIRECT_EVIDENCE_SELECTED_PENDING_INDEPENDENT_REVIEW`. The selected release
  is explicitly provisional/preliminary. It is not promoted to an independently
  reviewed or final financial-intelligence claim.
- The Workbench reads only the committed `proof-data/` exports. It makes no
  Core API calls, does not initiate runs, and does not write to Core.
- The historical API readback (list count, IO ID, trace links, ETag and 304)
  is displayed as R7 run evidence; it is not presented as current API health.

### Institutional modules

Executive Overview · Production Runs · Source Intelligence · Acquisition & Access ·
Document Intelligence · Representations & Retrievals · Fact Explorer ·
Evidence & Provenance · Event Registry · Intelligence Objects ·
Delivery & Distribution · Quality & Governance · Failures & Rejections ·
Lineage Explorer · API & System Readback · Production Accounting ·
Audit & Raw Records · Global Search.

The modules expose the data that is present in the R7 snapshot and label the
rest honestly. In particular, the package does not contain a complete
Representation or RetrievalEvent ledger, per-attempt failure/rejection ledger,
Core audit export, raw document blob, or a live health measurement. These are
shown as `UNAVAILABLE` or `NOT SUPPORTED`, never converted into zero counts.

### Core API contract boundary

The R7 `ProductionTransportHandler` exposes `GET /health`, `GET /metrics`,
`GET /v1/intelligence`, `GET /v1/intelligence/{io_id}`,
`GET /v1/intelligence/{io_id}/trace`, and owner-mode-only
`GET /v1/ops/registry*`. It does not expose the older Observatory
`/production/*` contract. The Workbench does not assume these contracts are
interchangeable. No Core endpoint or schema was modified by the R8 UI work.

### Deployment status

The repository's historical public-deployment documentation describes GitHub Pages
for the Institutional Terminal. It does not establish that this R8 Workbench is
hosted by Railway. Railway project/service/domain ownership must be identified
and verified before a Preview deployment is attempted. No service replacement,
production-domain change, merge or deployment is implied by this branch.

### QA

The R8 acceptance workflow captures all 18 modules at 1440/1280/1024/768/390px,
tests lineage and global search, verifies explicit unavailable states and snapshot
tamper fail-closed behavior, and records console, page, overflow, request-method
and accessibility checks. A passing build alone is not acceptance; the exact
GitHub Actions run and its screenshot/report artifact are the evidence of QA.
