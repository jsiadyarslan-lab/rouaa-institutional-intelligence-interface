'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { coreGet, ROUAA_TIMEOUT_MS } = require('../unified/core-client.js');
const { classifyNextCursor, createFeedPager } = require('../unified/feed-pagination.js');
const { ROUAA_MODULES, ROUAA_CLASSIFICATIONS } = require('../unified/capabilities.js');
const RUNTIME = ['index.html', 'unified/app.js', 'unified/core-client.js', 'unified/feed-pagination.js', 'unified/capabilities.js'];
const resp = (status, ct, body) => async () => ({ status, ok: status >= 200 && status < 300, headers: { get: () => ct }, json: async () => body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENVELOPE = { error: { code: 'IO_NOT_FOUND', message: 'unknown io_id' } }; /* the documented Core error shape */
/* R2D §5 fixtures — contract-perfect SUCCESS payloads an impersonating proxy can emit. These are
   synthetic shapes confined to this test file; they are never product data. */
const FAKE_OBJ = { io_id: 'io-fake-1', event_id: 'ev-fake-1', event_type: 'synthetic_event', event_version: 1, status: 'active', created_at: '2026-01-01T00:00:00Z', supersedes_io_id: null };
const FAKE_METRICS = { source_count: 7, document_count: 1337, fact_count: 424242, event_count: 99, io_count: 99 };
const FAKE_FEED = { objects: [FAKE_OBJ, { io_id: 'io-fake-2', headline: 'FAKE PROXY HEADLINE' }], next_cursor: '2026-01-01T00:00:00Z|ev-fake-2|1' };
const FAKE_TRACE = { chain: [{ source: 'src-fake', document: { canonical_url: 'https://proxy.test/doc' }, representation: { representation_id: 'rep-fake', content_sha256: '0'.repeat(64) }, evidence: ['ev-fake'], fact: 'fact-fake' }] };

test('runtime path has no snapshot, /production, token or non-GET usage, and no test-mode trust bypass', () => {
  for (const f of RUNTIME) {
    const s = read(f).replace(/const ROUAA_QUARANTINED = \[[\s\S]*?\n\];/, ''); /* labels of quarantined legacy items are documentation, not runtime references */
    assert.ok(!/data\/[a-z]+\.json|proof-data|proof-workbench|p29-consumer/.test(s.replace(/quarantine\/legacy-snapshot-ui\/[^'"\s]*/g, '')), f + ' references snapshot assets');
    assert.ok(!/['"`]\/production/.test(s), f + ' calls /production');
    assert.ok(!/CORE_TOKEN|CORE_API_TOKEN|Authorization|Bearer|localStorage|\?api=/i.test(s), f + ' touches credentials/override');
    assert.ok(!/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(s), f + ' non-GET');
    /* R2D §6: no test mode, header or query parameter may bypass the trust boundary at runtime */
    assert.ok(!/test[-_]?mode|TEST_MODE|bypass|X-Test|__test/i.test(s), f + ' contains a runtime test-mode/bypass hook');
  }
});
test('static trust gate (R2D §3): LIVE_RESPONSE is unreachable in the client — no code path returns it, no view consumes it', () => {
  const client = read('unified/core-client.js');
  const app = read('unified/app.js');
  assert.ok(!/state:\s*['"]LIVE_RESPONSE['"]/.test(client), 'core-client must never return LIVE_RESPONSE');
  assert.ok(!/===\s*['"]LIVE_RESPONSE['"]|!==\s*['"]LIVE_RESPONSE['"]/.test(app), 'app.js must not branch on LIVE_RESPONSE');
  assert.ok(/LIVE_RESPONSE:/.test(app) && /reserved/.test(app), 'LIVE_RESPONSE stays documented as reserved vocabulary');
});
test('registry: valid classifications, none LIVE_VERIFIED, 16 modules in 3 groups', () => {
  assert.equal(ROUAA_MODULES.length, 16);
  for (const m of ROUAA_MODULES) { assert.ok(ROUAA_CLASSIFICATIONS[m.cls], m.key); assert.notEqual(m.cls, 'LIVE_VERIFIED'); assert.ok('ABC'.includes(m.group)); }
});
test('client rejects paths outside the allow-list (incl. /production, ops, traversal)', async () => {
  for (const p of ['/production/status', '/v1/ops/registry', '/v1/intelligence/../x', '//evil.test/x', '/metrics?x=1']) assert.equal((await coreGet(p, resp(200, 'application/json', {}))).state, 'REJECTED_PATH', p);
});
test('allow-list: documented cursor continuation accepted, malformed cursors rejected', async () => {
  /* contract V1: cursor is "derived_at|event_id|event_version", URL-encoded by the client */
  const enc = encodeURIComponent('2026-01-01T00:00:00Z|ev-test-2|1');
  assert.equal((await coreGet('/v1/intelligence?limit=50', resp(200, 'application/json', { objects: [], next_cursor: null }))).state, 'UNVERIFIED_UPSTREAM_RESPONSE');
  assert.equal((await coreGet('/v1/intelligence?limit=50&cursor=' + enc, resp(200, 'application/json', { objects: [], next_cursor: null }))).state, 'UNVERIFIED_UPSTREAM_RESPONSE');
  for (const p of ['/v1/intelligence?cursor=' + enc, '/v1/intelligence?limit=50&cursor=a|b|1', '/v1/intelligence?limit=50&cursor=' + enc + '&x=1', '/v1/intelligence?limit=50&cursor=a/b']) {
    assert.equal((await coreGet(p, resp(200, 'application/json', {}))).state, 'REJECTED_PATH', p);
  }
});
test('R2D §5 MANDATORY — success-response impersonation: contract-perfect 200 payloads are UNVERIFIED_UPSTREAM_RESPONSE, never LIVE_RESPONSE', async () => {
  /* 1. HTTP 200 JSON matching the Intelligence Object contract */
  const obj = await coreGet('/v1/intelligence/io-fake-1', resp(200, 'application/json', FAKE_OBJ));
  assert.equal(obj.state, 'UNVERIFIED_UPSTREAM_RESPONSE'); assert.notEqual(obj.state, 'LIVE_RESPONSE');
  assert.deepEqual(obj.body, FAKE_OBJ); /* payload retained for diagnostics */
  assert.match(obj.detail, /not presented as trusted ROUAA Core intelligence/);
  /* 2. HTTP 200 /metrics with plausible-looking figures */
  const met = await coreGet('/metrics', resp(200, 'application/json', FAKE_METRICS));
  assert.equal(met.state, 'UNVERIFIED_UPSTREAM_RESPONSE'); assert.deepEqual(met.body, FAKE_METRICS);
  /* 3. HTTP 200 full Intelligence Feed with next_cursor */
  const feed = await coreGet('/v1/intelligence?limit=50', resp(200, 'application/json', FAKE_FEED));
  assert.equal(feed.state, 'UNVERIFIED_UPSTREAM_RESPONSE'); assert.equal(feed.body.objects.length, 2);
  /* 4. HTTP 200 trace with source/document/representation/evidence/fact */
  const tr = await coreGet('/v1/intelligence/io-fake-1/trace', resp(200, 'application/json', FAKE_TRACE));
  assert.equal(tr.state, 'UNVERIFIED_UPSTREAM_RESPONSE'); assert.ok(tr.body.chain[0].source);
  /* /health too */
  assert.equal((await coreGet('/health', resp(200, 'application/json', { status: 'ok' }))).state, 'UNVERIFIED_UPSTREAM_RESPONSE');
  /* non-JSON 200 likewise (nothing to interpret) */
  assert.equal((await coreGet('/health', resp(200, 'text/html', null))).state, 'UNVERIFIED_UPSTREAM_RESPONSE');
  /* a 200 must never upgrade any module classification */
  for (const m of ROUAA_MODULES) assert.notEqual(m.cls, 'LIVE_VERIFIED');
});
test('R2C regressions: no response shape alone attributes an error to Core (404 JSON/HTML, 503, 401/403, non-JSON, 4xx)', async () => {
  const env404 = await coreGet('/v1/intelligence/io-x', resp(404, 'application/json', ENVELOPE));
  assert.equal(env404.state, 'UNDETERMINED_404'); assert.match(env404.detail, /shape evidence only/); /* impersonating proxy, error side */
  assert.equal((await coreGet('/v1/intelligence/io-x', resp(404, 'application/json', {}))).state, 'UNDETERMINED_404');
  assert.equal((await coreGet('/health', resp(404, 'text/html', null))).state, 'UNDETERMINED_404');
  const r503 = await coreGet('/v1/intelligence/x', resp(503, 'application/json', { code: 'EVIDENCE_BLOB_UNAVAILABLE' }));
  assert.equal(r503.state, 'TEMPORARY_FAILURE'); assert.match(r503.detail, /not attributable to Core/);
  assert.equal((await coreGet('/v1/intelligence/x', resp(503, 'application/json', ENVELOPE))).state, 'TEMPORARY_FAILURE');
  assert.equal((await coreGet('/health', resp(502, 'text/html', null))).state, 'TEMPORARY_FAILURE');
  assert.equal((await coreGet('/health', async () => { throw new Error('x'); })).state, 'TEMPORARY_FAILURE');
  assert.equal((await coreGet('/metrics', resp(401, 'application/json', {}))).state, 'UNAUTHORIZED');
  assert.equal((await coreGet('/metrics', resp(403, 'application/json', {}))).state, 'UNAUTHORIZED');
  const r405 = await coreGet('/v1/intelligence/x', resp(405, 'application/json', ENVELOPE));
  assert.equal(r405.state, 'UNDETERMINED_RESPONSE'); assert.match(r405.detail, /shape evidence only/);
});
test('R2C regression: without AbortController no request is sent at all (fail-closed)', async () => {
  const AC = global.AbortController;
  global.AbortController = undefined;
  try {
    let called = false;
    const fake = async () => { called = true; return resp(200, 'application/json', { status: 'ok' })(); };
    const r = await coreGet('/health', fake, 50);
    assert.equal(called, false, 'no un-cancellable request may ever be issued');
    assert.equal(r.state, 'TEMPORARY_FAILURE');
    assert.match(r.detail, /not sent/);
    assert.match(r.detail, /AbortController/);
  } finally { global.AbortController = AC; }
});
test('timeout (R2B, kept): response inside the budget returns promptly and the abort timer is cleaned up', async () => {
  assert.ok(ROUAA_TIMEOUT_MS <= 10000, 'default timeout must not exceed 10s');
  let seenOpts;
  const r = await coreGet('/health', async (u, o) => { seenOpts = o; return resp(200, 'application/json', { status: 'ok' })(); }, 200);
  assert.equal(r.state, 'UNVERIFIED_UPSTREAM_RESPONSE'); /* a timely answer is still unverified — only its arrival is proven */
  assert.equal(seenOpts.signal.aborted, false, 'signal must not be aborted on success');
  await sleep(280); /* longer than the budget — proves clearTimeout ran (else the signal would abort now) */
  assert.equal(seenOpts.signal.aborted, false, 'timer was not cleaned after success');
});
test('timeout (R2B, kept): hung request aborts into TEMPORARY_FAILURE and returns promptly', async () => {
  let seenOpts;
  const hung = (u, o) => { seenOpts = o; return new Promise((res, rej) => { o.signal.addEventListener('abort', () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; rej(e); }); }); };
  const t0 = Date.now();
  const r = await coreGet('/health', hung, 40);
  assert.ok(Date.now() - t0 < 2000, 'coreGet must return at the deadline, not hang');
  assert.equal(r.state, 'TEMPORARY_FAILURE');
  assert.match(r.detail, /timeout/);
  assert.equal(seenOpts.signal.aborted, true, 'the request signal must be aborted at the deadline');
});
test('client sends GET to same-origin /core only, no auth headers', async () => {
  let seen; await coreGet('/health', async (u, o) => { seen = [u, o]; return resp(200, 'application/json', {})(); });
  assert.equal(seen[0], '/core/health'); assert.equal(seen[1].method, 'GET'); assert.deepEqual(Object.keys(seen[1].headers), ['Accept']);
});
test('R2D §6 — pure pagination logic: the four next_cursor cases (synthetic data confined to this test)', () => {
  assert.deepEqual(classifyNextCursor({ objects: [], next_cursor: 'c1' }), { case: 'next', next: 'c1' });
  assert.deepEqual(classifyNextCursor({ objects: [], next_cursor: null }), { case: 'last', next: null });
  assert.deepEqual(classifyNextCursor({ objects: [] }), { case: 'missing', next: null });
  assert.deepEqual(classifyNextCursor({ objects: [], next_cursor: 5 }), { case: 'invalid', next: null });
  assert.deepEqual(classifyNextCursor({ objects: [], next_cursor: '' }), { case: 'invalid', next: null });
  assert.deepEqual(classifyNextCursor({ objects: [], next_cursor: { a: 1 } }), { case: 'invalid', next: null });
  assert.deepEqual(classifyNextCursor(null), { case: 'missing', next: null });
});
test('R2D §6 — pure pagination logic: cursor transitions, previous, retry, no stack cap', () => {
  const p = createFeedPager();
  assert.equal(p.current, null); assert.equal(p.canPrevious, false);
  assert.equal(p.goNext(''), false); assert.equal(p.goNext(5), false); /* only a valid cursor advances */
  assert.equal(p.goNext('c1'), true); assert.equal(p.current, 'c1'); assert.equal(p.canPrevious, true);
  assert.equal(p.goNext('c2'), true);
  assert.equal(p.goPrevious(), 'c1'); /* back to the previous page's cursor exactly */
  assert.equal(p.goNext('c2'), true);
  const before = p.current;
  assert.equal(p.retry(), before); assert.equal(p.current, before); assert.equal(p.stackLength, 2); /* retry never mutates: stack is [null, 'c1'] */
  for (let i = 0; i < 500; i++) p.goNext('c' + i); /* deep navigation — history is never silently dropped */
  assert.equal(p.stackLength, 502);
  let back = p.goPrevious(); let steps = 0;
  while (back !== false) { back = p.goPrevious(); steps++; if (steps > 600) break; }
  assert.equal(p.current, null); /* walked all the way back to the first page */
});
