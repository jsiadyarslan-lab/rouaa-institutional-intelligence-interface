'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { coreGet } = require('../unified/core-client.js');
const { ROUAA_MODULES, ROUAA_CLASSIFICATIONS } = require('../unified/capabilities.js');
const RUNTIME = ['index.html', 'unified/app.js', 'unified/core-client.js', 'unified/capabilities.js'];
const resp = (status, ct, body) => async () => ({ status, ok: status >= 200 && status < 300, headers: { get: () => ct }, json: async () => body });

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
test('client distinguishes channel-not-provisioned, temporary failure, degraded, 404, unauthorized, live', async () => {
  assert.equal((await coreGet('/health', resp(200, 'text/html', null))).state, 'CHANNEL_NOT_PROVISIONED');
  assert.equal((await coreGet('/health', resp(404, 'text/html', null))).state, 'CHANNEL_NOT_PROVISIONED');
  assert.equal((await coreGet('/health', async () => { throw new Error('x'); })).state, 'TEMPORARY_FAILURE');
  assert.equal((await coreGet('/health', resp(502, 'text/html', null))).state, 'TEMPORARY_FAILURE');
  assert.equal((await coreGet('/v1/intelligence/x', resp(503, 'application/json', { code: 'EVIDENCE_BLOB_UNAVAILABLE' }))).state, 'DEGRADED');
  assert.equal((await coreGet('/v1/intelligence/x', resp(404, 'application/json', {}))).state, 'NOT_FOUND_BY_CORE');
  assert.equal((await coreGet('/metrics', resp(401, 'application/json', {}))).state, 'UNAUTHORIZED');
  const ok = await coreGet('/metrics', resp(200, 'application/json', { io_count: 0 }));
  assert.equal(ok.state, 'LIVE_RESPONSE'); assert.deepEqual(ok.body, { io_count: 0 });
});
test('client sends GET to same-origin /core only, no auth headers', async () => {
  let seen; await coreGet('/health', async (u, o) => { seen = [u, o]; return resp(200, 'application/json', {})(); });
  assert.equal(seen[0], '/core/health'); assert.equal(seen[1].method, 'GET'); assert.deepEqual(Object.keys(seen[1].headers), ['Accept']);
});
