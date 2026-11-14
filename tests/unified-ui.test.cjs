'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { coreGet, ROUAA_TIMEOUT_MS } = require('../unified/core-client.js');
const { ROUAA_MODULES, ROUAA_CLASSIFICATIONS } = require('../unified/capabilities.js');
const RUNTIME = ['index.html', 'unified/app.js', 'unified/core-client.js', 'unified/capabilities.js'];
const resp = (status, ct, body) => async () => ({ status, ok: status >= 200 && status < 300, headers: { get: () => ct }, json: async () => body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('runtime path has no snapshot, /production, token or non-GET usage', () => {
  for (const f of RUNTIME) {
    const s = read(f).replace(/const ROUAA_QUARANTINED = \[[\s\S]*?\n\];/, ''); /* labels of quarantined legacy items are documentation, not runtime references */
    assert.ok(!/data\/[a-z]+\.json|proof-data|proof-workbench|p29-consumer/.test(s.replace(/quarantine\/legacy-snapshot-ui\/[^'"\s]*/g, '')), f + ' references snapshot assets');
    assert.ok(!/['"`]\/production/.test(s), f + ' calls /production');
    assert.ok(!/CORE_TOKEN|CORE_API_TOKEN|Authorization|Bearer|localStorage|\?api=/i.test(s), f + ' touches credentials/override');
    assert.ok(!/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(s), f + ' non-GET');
  }
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
  assert.equal((await coreGet('/v1/intelligence?limit=50', resp(200, 'application/json', { objects: [], next_cursor: null }))).state, 'LIVE_RESPONSE');
  assert.equal((await coreGet('/v1/intelligence?limit=50&cursor=' + enc, resp(200, 'application/json', { objects: [], next_cursor: null }))).state, 'LIVE_RESPONSE');
  for (const p of ['/v1/intelligence?cursor=' + enc, '/v1/intelligence?limit=50&cursor=a|b|1', '/v1/intelligence?limit=50&cursor=' + enc + '&x=1', '/v1/intelligence?limit=50&cursor=a/b']) {
    assert.equal((await coreGet(p, resp(200, 'application/json', {}))).state, 'REJECTED_PATH', p);
  }
});
test('client distinguishes channel-not-provisioned, temporary failure, degraded, unauthorized, live', async () => {
  assert.equal((await coreGet('/health', resp(200, 'text/html', null))).state, 'CHANNEL_NOT_PROVISIONED');
  assert.equal((await coreGet('/health', resp(404, 'text/html', null))).state, 'CHANNEL_NOT_PROVISIONED');
  assert.equal((await coreGet('/health', async () => { throw new Error('x'); })).state, 'TEMPORARY_FAILURE');
  assert.equal((await coreGet('/health', resp(502, 'text/html', null))).state, 'TEMPORARY_FAILURE');
  assert.equal((await coreGet('/v1/intelligence/x', resp(503, 'application/json', { code: 'EVIDENCE_BLOB_UNAVAILABLE' }))).state, 'DEGRADED');
  assert.equal((await coreGet('/metrics', resp(401, 'application/json', {}))).state, 'UNAUTHORIZED');
  const ok = await coreGet('/metrics', resp(200, 'application/json', { io_count: 0 }));
  assert.equal(ok.state, 'LIVE_RESPONSE'); assert.deepEqual(ok.body, { io_count: 0 });
});
test('404 origin classification (R2B): envelope → Core-attributed; bare JSON 404 → UNDETERMINED; HTML → channel', async () => {
  const r404core = await coreGet('/v1/intelligence/io-x', resp(404, 'application/json', { error: { code: 'IO_NOT_FOUND', message: 'unknown io_id' } }));
  assert.equal(r404core.state, 'NOT_FOUND_BY_CORE');
  const r404bare = await coreGet('/v1/intelligence/io-x', resp(404, 'application/json', {}));
  assert.equal(r404bare.state, 'UNDETERMINED_404');
  assert.match(r404bare.detail, /not attributable to Core/);
  const r404shape = await coreGet('/v1/intelligence/io-x', resp(404, 'application/json', { error: 'plain string' }));
  assert.equal(r404shape.state, 'UNDETERMINED_404');
  assert.equal((await coreGet('/health', resp(404, 'text/html', null))).state, 'CHANNEL_NOT_PROVISIONED');
  assert.notEqual(r404bare.state, 'NOT_FOUND_BY_CORE');
});
test('timeout (R2B): response inside the budget is LIVE_RESPONSE and the abort timer is cleaned up', async () => {
  assert.ok(ROUAA_TIMEOUT_MS <= 10000, 'default timeout must not exceed 10s');
  let seenOpts;
  const r = await coreGet('/health', async (u, o) => { seenOpts = o; return resp(200, 'application/json', { status: 'ok' })(); }, 200);
  assert.equal(r.state, 'LIVE_RESPONSE');
  assert.equal(seenOpts.signal.aborted, false, 'signal must not be aborted on success');
  await sleep(280); /* longer than the budget — proves clearTimeout ran (else the signal would abort now) */
  assert.equal(seenOpts.signal.aborted, false, 'timer was not cleaned after success');
});
test('timeout (R2B): hung request aborts into TEMPORARY_FAILURE, never NOT_EXPOSED_BY_CORE, and returns promptly', async () => {
  let seenOpts;
  const hung = (u, o) => { seenOpts = o; return new Promise((res, rej) => { o.signal.addEventListener('abort', () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; rej(e); }); }); };
  const t0 = Date.now();
  const r = await coreGet('/health', hung, 40);
  assert.ok(Date.now() - t0 < 2000, 'coreGet must return at the deadline, not hang');
  assert.equal(r.state, 'TEMPORARY_FAILURE');
  assert.match(r.detail, /timeout/);
  assert.notEqual(r.state, 'NOT_EXPOSED_BY_CORE');
  assert.equal(seenOpts.signal.aborted, true, 'the request signal must be aborted at the deadline');
});
test('client sends GET to same-origin /core only, no auth headers', async () => {
  let seen; await coreGet('/health', async (u, o) => { seen = [u, o]; return resp(200, 'application/json', {})(); });
  assert.equal(seen[0], '/core/health'); assert.equal(seen[1].method, 'GET'); assert.deepEqual(Object.keys(seen[1].headers), ['Accept']);
});
