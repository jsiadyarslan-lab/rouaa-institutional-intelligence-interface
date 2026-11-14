# R2B — Baseline Report (recorded before any modification)

**Order:** ROUAA-UNIFIED-UI-001-R2B — Core client reliability & Intelligence Feed completeness
**Recorded at:** 2026-11-14, before the first code edit of R2B
**Reference head given by the order:** `4384735e6a6f9011526d1c8bcd700960f1e8855f`

## 1. Verified baseline state (all checked live, before edits)

| Item | Verified value |
|---|---|
| PR #3 | open, **Draft**, base `p2.9-interface-verified-intelligence-consumer`, head `4384735e6a6f9011526d1c8bcd700960f1e8855f` |
| Branch head == order reference | yes (`git rev-parse HEAD` == `4384735e…`) |
| `main` | `0c5842202e6b…` — unchanged |
| `p2.9` | `56327b3ce10e…` — unchanged |
| CI on the reference head | run `43599731568` (push) **success**; run `43599734292` (pull_request) **success** |
| Worktree | clean (`git status --porcelain` → 0 entries after `core.fileMode=false`; the initial 58 entries were clone file-mode noise only, zero content diffs) |
| R1/R2/R2A history | untouched; R2B adds on top of `4384735` |

**No unexplained divergence — execution proceeds.**

## 2. The three findings being remediated (from the independent review of PR #3)

1. **No request timeout** — `coreGet()` used bare `fetch`; a hung connection could leave the view in `Reading Core…` indefinitely. `TEMPORARY_FAILURE` exists but can only be produced if the request actually ends.
2. **Feed truncated at 50 without telling the analyst** — `feed()` requested `/v1/intelligence?limit=50` with no pagination, while the Core contract documents `cursor` continuation.
3. **404 origin inferred from Content-Type only** — a JSON 404 from an unprovisioned channel was classified `NOT_FOUND_BY_CORE` without evidence Core answered.

Plus (non-blocking, in scope §5): the `core-client.js` header comment still said "no credentials in the browser" while the code uses `credentials: 'same-origin'`.

## 3. Actual Core pagination contract — extracted BEFORE implementation (no invention)

**Sources (both read before writing any code):**

- Contract document: `docs/contracts/ROUAA_CORE_INTELLIGENCE_CONTRACT_V1.md` (Core bundle `rouaa-clean-release-r3/restore_from_bundle`):
  - `GET /v1/intelligence` — "cursor pagination"; response `` {objects: [item…], next_cursor: string|null} ``; errors `{error:{code, message}}` (401/404/405/429/5xx).
- Implementation: `intelligence_core/production_transport.py`:
  - `cursor = params.get("cursor", [None])[0]` — the `cursor` query parameter **is implemented**.
  - Pagination: cursor + limit (default 50, capped at 200).
  - Cursor format: `"derived_at|event_id|event_version"` (URL-encoded); `_parse_cursor` URL-decodes then splits on `|`; a single-part legacy form (derived_at only) is accepted.
  - `next_cursor` = tuple cursor of the **last item of the page**, set **only** when `len(events) > limit`; otherwise `null`. So `next_cursor: null` ⇔ no further pages.
- Canonical error envelope (`_send_error`): body is always `{"error": {"code": …, "message": …}}` — this is the documented marker that a JSON error came from Core's contract surface.

**Consequences for the UI implementation (R2B):**

- `next_cursor` **is available in the actual implementation** → real pagination is implemented (not a bounded-display-only fallback). The client treats the cursor as **opaque**, URL-encodes it with `encodeURIComponent` before sending, and only ever sends cursors received from Core's own `next_cursor` (or its own previous-page stack) — never user input.
- The allow-list accepts `?limit=<1-3 digits>(&cursor=<URL-encoded charset [A-Za-z0-9._~%-]{1,512}>)?` — raw `|` or extra query parameters are rejected (`REJECTED_PATH`).
- 404 origin classification uses the documented envelope: JSON 404 **with** `{error:{code,…}}` → `NOT_FOUND_BY_CORE`; JSON 404 **without** the envelope → new explicit `UNDETERMINED_404` (never attributed to Core); non-JSON 404 (e.g. host HTML) → `CHANNEL_NOT_PROVISIONED`.

## 4. Scope guard for R2B

- Files to change: `unified/core-client.js`, `unified/app.js`, `tests/unified-ui.test.cjs`, `tests/browser-acceptance.cjs`, plus new docs (`R2B-BASELINE-REPORT.md`, `R2B-CLIENT-RELIABILITY-REPORT.md`) and a PR #3 description update.
- No change to Core, `main`, `p2.9`, Railway, secrets, volumes; no merge; no deploy; no new proxy or `/core` channel; no module becomes `LIVE_VERIFIED`; no R3 work.
- All 11 R2 browser checks and 5 R2 node tests must remain green (updated only where the 404-classification contract improves).
