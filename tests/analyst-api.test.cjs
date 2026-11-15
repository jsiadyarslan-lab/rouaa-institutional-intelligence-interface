'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const original = JSON.parse(readFileSync(join(__dirname, '../proof-data/proof-intelligence-objects.json'))).entries[0];
const coreKey = 'test-upstream-key';
const analystKey = 'test-interface-key';

test('all cursor pages, archived contract shape, filtering, provenance and protected reads', async (t) => {
  const seen = [];
  const bad = JSON.parse(JSON.stringify(original));
  bad.io_id = 'io-with-unsafe-url';
  bad.chain[0].document.canonical_url = 'javascript:alert(1)';
  const rows = Array.from({ length: 41 }, (_, i) => ({ ...original, io_id: 'io-archive-' + i }));
  const stub = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/metrics') {
      assert.equal(req.headers.authorization, undefined);
      res.end(JSON.stringify({ io_count: 42, event_count: 42, fact_count: 41, document_count: 1,
        source_count: 1, captured_at: new Date().toISOString() }));
    } else {
      assert.equal(req.headers.authorization, 'Bearer ' + coreKey);
      const u = new URL(req.url, 'http://localhost');
      assert.equal(u.pathname, '/v1/intelligence');
      assert.equal(u.searchParams.get('limit'), '40');
      const c = u.searchParams.get('cursor');
      seen.push(c);
      res.end(JSON.stringify(c
        ? { objects: [rows[40], bad], next_cursor: null }
        : { objects: rows.slice(0, 40), next_cursor: '2026-10-30T00:00:00Z|event-id|1' }));
    }
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  t.after(() => stub.close());
  const temporary = createServer();
  await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve));
  const port = temporary.address().port;
  await new Promise(resolve => temporary.close(resolve));
  const app = spawn(process.execPath, [join(__dirname, '../analyst/server.cjs')], {
    env: { ...process.env, PORT: String(port), ROUAA_REQUIRE_CORE: '1',
      ROUAA_CORE_URL: 'http://127.0.0.1:' + stub.address().port,
      CORE_API_TOKEN: coreKey, ROUAA_ANALYST_TOKEN: analystKey,
      RAILWAY_ENVIRONMENT_ID: '' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => app.kill());
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.once('exit', code => reject(new Error('server exited ' + code)));
    app.stdout.once('data', resolve);
  });
  const get = (path, options) => fetch('http://127.0.0.1:' + port + path, options);
  let res = await get('/api/outputs');
  assert.equal(res.status, 401);
  assert.equal((await get('/api/sources')).status, 401);
  assert.equal((await get('/v1/intelligence')).status, 404);
  assert.equal((await get('/analyst/server.cjs')).status, 404);
  assert.equal((await get('/api/outputs', { method: 'PATCH' })).status, 405);
  assert.equal((await get('/ready')).status, 200);
  const status = await (await get('/api/status')).json();
  assert.equal(status.metrics.outputs, 42);
  assert.equal(status.signedIn, false);
  assert.equal(status.feed, null);
  const oldUrl = await (await get('/proof-workbench.html')).text();
  assert.match(oldUrl, /أحدث المخرجات/);
  assert.match(await (await get('/archive-r7.html')).text(), /Evidence Workbench/);
  res = await get('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: analystKey }) });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(!cookie.includes(coreKey) && !cookie.includes(analystKey));
  const signed = { headers: { Cookie: cookie.split(';')[0] } };
  const search = new URLSearchParams({ q: 'التضخم', page: '4', source: 'src-istat', from: '2026-10-01', to: '2026-10-31' });
  res = await get('/api/outputs?' + search, signed);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.equal(list.feed.state, 'CURRENT');
  assert.equal(list.total, 42);
  assert.equal(list.count, 42);
  assert.equal(list.pages, 4);
  assert.equal(list.rows.length, 6);
  assert.deepEqual(seen, [null, '2026-10-30T00:00:00Z|event-id|1']);
  assert.equal(list.rows[0].lead.raw, '+5.4%');
  const details = await (await get('/api/outputs/io-archive-40', signed)).json();
  assert.equal(details.output.facts[0].officialUrl, original.chain[0].document.canonical_url);
  assert.equal(details.output.facts[0].evidence[0].excerpt, original.chain[0].evidence[0].excerpt);
  const cleaned = await (await get('/api/outputs/io-with-unsafe-url', signed)).json();
  assert.equal(cleaned.output.facts[0].officialUrl, '');
  const source = await (await get('/api/sources', signed)).json();
  assert.equal(source.sources[0].outputs, 42);
  assert.equal(source.sources[0].documents, 1);
});
