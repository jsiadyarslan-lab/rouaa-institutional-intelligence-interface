# ROUAA analyst interface on Railway

Deploy this branch to the existing `rouaa-intelligence-ops-console` **interface** service, not to `rouaa-intelligence-core-api`. Keep the existing interface domain. The old bookmark `/proof-workbench.html#overview` and the root open the analyst view. The existing Git-tracked R7 bundle remains available at `/archive-r7.html#overview`, separate from production data.

## Production configuration

Use the Dockerfile and `railway.toml` in this branch. The service must run `node analyst/server.cjs` (remove any incompatible platform start-command override). Configure these variables only on the interface service:

- `CORE_API_TOKEN` — secure server-side Railway reference to the existing Core credential in the same production environment, where reference variables support it. Never send its value to the client or store it in Git.
- `ROUAA_ANALYST_TOKEN` — separate high-entropy analyst credential, at least 16 characters. Store and distribute through the owner's approved secret channels. The Core credential never doubles as analyst sign-in.
- `ROUAA_CORE_URL` — verified Core origin. This defaults to the existing Core HTTPS endpoint. Use the private Railway origin and correct port if independently verified.
- `ROUAA_REQUIRE_CORE=1` — readiness fails until a complete authenticated Core index has loaded. Set for production so a broken connection does not replace the old deployment.

Before deployment identify the previous successful interface deployment for rollback. After rollout check the old bookmark, sign in as an authorized analyst, compare the payload with the canonical Core route and follow an official document link. Confirm the next independently produced Core output appears automatically. If the service fails those checks, roll back to the previous interface deployment. Do not change Core, its volume, scheduler, or access policy for this interface rollout.

## Data boundaries

- Core totals come from its public `/metrics`. The visible execution timestamp is separate from the data read timestamp. Counters do not prove a new collection run or continuous ingestion.
- The output index consumes all cursor pages within explicit memory and refresh budgets. Search, date/source/type filters, pagination, and selected fields are same-origin and require authenticated analyst access. A refresh failure shows the last complete successful read as stale, never as new intelligence and never substitutes the archive. The last read is kept in memory only.
- The sources view lists sources referenced by actual outputs, not the entire registry. The index does not archive every source document or operate the scheduler. It is bounded and does not claim million-document scale or historical coverage.
- No public route relays authenticated Core requests. No new Core write route, new backing database, or acquisition schedule is introduced.

Run `node --test tests/analyst-api.test.cjs tests/proof-workbench-integrity.test.cjs` for the contract and archive checks.
