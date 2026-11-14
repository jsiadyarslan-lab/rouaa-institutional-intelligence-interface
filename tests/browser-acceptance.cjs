'use strict';
/* R2 browser acceptance (Playwright). Synthetic /core responses exist ONLY in this file, to drive the UI;
   they are never product data and never claim to be Core output. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.ACCEPTANCE_DIR || path.join(ROOT, 'artifacts', 'r2');
const SHA = process.env.GITHUB_SHA || 'local';
const VIEWPORTS = [1440, 1280, 1024, 768, 390].map((w) => ({ w, h: w >= 1024 ? 900 : 844 }));
const SERVED = /^\/(index\.html|brand-tokens\.css|style\.css|unified\/[A-Za-z0-9._-]+)$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const FIX = {
  health: { status: 'ok' },
  metrics: { source_count: 3, document_count: 9, fact_count: 42, event_count: 5, io_count: 5 },
  feed: { objects: [{ io_id: 'io-test-1', headline: 'SYNTHETIC TEST ROW', event_type: 'test_event', status: 'active', created_at: '2026-01-01T00:00:00Z' }] },
  obj: { io_id: 'io-test-1', event_id: 'ev-test-1', event_type: 'test_event', event_version: 1, status: 'active', created_at: '2026-01-01T00:00:00Z' },
  trace: { chain: [{ source: 'src-test', document: { canonical_url: 'https://example.test/doc' }, representation: { representation_id: 'rep-test', content_sha256: '0'.repeat(64) }, evidence: ['ev-1'], fact: 'fact-test' }] }
};
const report = { sha: SHA, started: new Date().toISOString(), viewports: VIEWPORTS.map((v) => v.w), checks: [], browser: null };
const note = (name, ok, detail) => report.checks.push({ name, ok, detail: detail || '' });

let server, base, browser; const serverLog = [];
test.before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  server = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    serverLog.push(req.method + ' ' + p);
    const f = p === '/' ? '/index.html' : p;
    if (req.method === 'GET' && SERVED.test(f) && fs.existsSync(path.join(ROOT, f))) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(path.join(ROOT, f)));
    }
    res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); // includes /core/*: no channel
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
  report.browser = browser.version();
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
  report.finished = new Date().toISOString();
  report.passed = report.checks.every((c) => c.ok);
  fs.writeFileSync(path.join(OUT, 'acceptance-report.json'), JSON.stringify(report, null, 2));
});

async function open(vp, mode) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const rec = { pageerrors: [], consoleErrors: [], requests: [], badResponses: [] };
  if (mode === 'synthetic') {
    await ctx.route('**/core/**', (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^\/core/, '');
      const map = { '/health': FIX.health, '/metrics': FIX.metrics, '/v1/intelligence': FIX.feed, '/v1/intelligence/io-test-1': FIX.obj, '/v1/intelligence/io-test-1/trace': FIX.trace };
      if (map[p]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(map[p]) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => rec.pageerrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/\/core\//.test(m.location().url || '')) rec.consoleErrors.push(m.text()); });
  page.on('request', (r) => rec.requests.push({ method: r.method(), url: r.url(), headers: r.headers() }));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/core\//.test(r.url())) rec.badResponses.push(r.status() + ' ' + r.url()); });
  return { ctx, page, rec };
}
async function go(page, hash, ready) {
  await page.goto(base + '/#/' + hash);
  await page.waitForFunction(ready || (() => document.querySelector('.u-wrap h1') && !document.querySelector('.u-load')), null, { timeout: 15000 });
}
const text = (page) => page.locator('#app').innerText();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (page, vp, name) => page.screenshot({ path: path.join(OUT, vp.w + '-' + name + '.png'), fullPage: true });
const NOT_AVAILABLE = ['documents', 'facts', 'events', 'search', 'runs', 'acquisition', 'representations', 'retrievals', 'accounting', 'audit'];
const BLOCKED = ['source-detail', 'registry'];

test('shell: assets load, three nav groups, no errors (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'overview');
  const groups = await page.locator('.nav-group-title').allInnerTexts();
  assert.deepEqual(groups, ['Executive Intelligence', 'Research & Evidence', 'Production & Governance']);
  assert.equal(await page.locator('#topnav a').count(), 16); // 15 routed modules + matrix link
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('shell', true); await ctx.close();
});

test('synthetic Core: overview, feed, detail, evidence, matrix (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'overview');
  let t = await text(page);
  assert.match(t, /CONTRACTED_NOT_LIVE_VERIFIED/); assert.match(t, /document_count/); assert.match(t, /\b42\b/);
  assert.doesNotMatch(t, /Live response received.*LIVE_VERIFIED/s);
  await go(page, 'intelligence', () => document.querySelector('.u-table'));
  t = await text(page); assert.match(t, /SYNTHETIC TEST ROW/); assert.match(t, /Not provided by Core/);
  await page.locator('a', { hasText: 'io-test-1' }).first().click();
  await page.waitForSelector('.u-chain');
  t = await text(page); assert.match(t, /example\.test\/doc/); assert.match(t, /rep-test/); assert.match(t, /Evidence chain/);
  await go(page, 'evidence');
  await page.fill('input[aria-label="io_id"]', 'io-test-1'); await page.click('button');
  await page.waitForSelector('.u-chain'); assert.match(await text(page), /fact-test/);
  await go(page, 'matrix', () => document.querySelector('.u-table'));
  const rows = await page.locator('.u-table tr').count(); assert.equal(rows, 1 + 16 + 4);
  const cells = await page.locator('.u-table td').allInnerTexts();
  assert.ok(!cells.includes('LIVE_VERIFIED')); assert.equal(cells.filter((c) => c === 'SNAPSHOT_QUARANTINED').length, 4);
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('synthetic-core-flows', true); await ctx.close();
});

test('unavailable and blocked modules state it plainly and show no data', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  for (const k of NOT_AVAILABLE) { await go(page, k); const t = await text(page); assert.match(t, /NOT AVAILABLE in the current Core contract/, k); assert.match(t, /NOT_EXPOSED_BY_CORE/, k); assert.doesNotMatch(t, /LIVE_RESPONSE|Live response/, k); assert.equal(await page.locator('.u-table').count(), 0, k); }
  for (const k of BLOCKED) { await go(page, k); const t = await text(page); assert.match(t, /BLOCKED — no secure verified path/, k); assert.match(t, /BLOCKED_NO_SECURE_PATH/, k); }
  assert.deepEqual(rec.pageerrors, []);
  note('unavailable-modules', true, NOT_AVAILABLE.length + ' not-exposed + ' + BLOCKED.length + ' blocked'); await ctx.close();
});

test('no /core channel: states it, UI keeps working', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'nochannel');
  for (const k of ['overview', 'intelligence', 'evidence']) { await go(page, k); }
  await go(page, 'overview'); let t = await text(page);
  assert.match(t, /CHANNEL_NOT_PROVISIONED/); assert.doesNotMatch(t, /Live response received/); assert.doesNotMatch(t, /\b0\b.*io_count/s);
  await go(page, 'intelligence'); t = await text(page); assert.match(t, /CHANNEL_NOT_PROVISIONED/); assert.equal(await page.locator('.u-table').count(), 0);
  await go(page, 'intelligence/io-test-1', () => document.querySelector('.u-state')); assert.match(await text(page), /CHANNEL_NOT_PROVISIONED/);
  await go(page, 'intelligence/%E0%A4%A', () => document.querySelector('.u-state')); assert.match(await text(page), /REJECTED_PATH/);
  assert.equal(await page.locator('.nav-group').count(), 3);
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('no-channel', true); await ctx.close();
});

test('footer and visible text make no absolute traceability claim', async () => {
  const { ctx, page } = await open(VIEWPORTS[0], 'nochannel');
  await go(page, 'overview');
  const all = await page.locator('body').innerText();
  assert.doesNotMatch(all, /every displayed object is traceable/i); assert.match(all, /only where Core successfully returns a trace/);
  assert.doesNotMatch(all, /production[- ]ready|EVIDENCE_TRACEABILITY_PASS|prototype/i);
  note('wording', true); await ctx.close();
});

test('network audit: GET only, same-origin, no snapshot/production/credential traffic', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  for (const k of ['overview', 'intelligence', 'evidence', 'documents', 'matrix']) await go(page, k, () => document.querySelector('.u-wrap h1'));
  await go(page, 'intelligence/io-test-1', () => document.querySelector('.u-chain'));
  assert.ok(rec.requests.length > 5);
  for (const r of rec.requests) {
    const u = new URL(r.url);
    assert.equal(r.method, 'GET', r.url); assert.equal(u.origin, base, r.url);
    assert.doesNotMatch(u.pathname, /production|proof-data|\/data\/|quarantine|p29/, r.url);
    assert.ok(!('authorization' in r.headers) && !('x-api-key' in r.headers), 'credential header on ' + r.url);
  }
  assert.ok(rec.requests.some((r) => /\/core\//.test(r.url)));
  assert.ok(serverLog.every((l) => l.startsWith('GET ')));
  const stored = await page.evaluate(() => JSON.stringify([localStorage.length, sessionStorage.length]));
  assert.equal(stored, '[0,0]');
  note('network-audit', true, rec.requests.length + ' requests'); await ctx.close();
});

for (const vp of VIEWPORTS) {
  test('layout @' + vp.w + 'px: no horizontal overflow, screenshots', async () => {
    const { ctx, page, rec } = await open(vp, 'synthetic');
    const views = [['overview'], ['intelligence', () => document.querySelector('.u-table')], ['intelligence/io-test-1', () => document.querySelector('.u-chain')], ['evidence'], ['documents'], ['matrix', () => document.querySelector('.u-table')]];
    for (const [h, ready] of views) {
      await go(page, h, ready); const o = await overflow(page);
      assert.ok(o <= 1, vp.w + 'px ' + h + ' overflow ' + o + 'px');
      await shot(page, vp, h.replace(/\//g, '_'));
    }
    await ctx.close(); const n = await open(vp, 'nochannel'); await go(n.page, 'overview');
    assert.ok((await overflow(n.page)) <= 1, vp.w + 'px nochannel overflow'); await shot(n.page, vp, 'overview-no-channel'); await n.ctx.close();
    assert.deepEqual(rec.pageerrors, []);
    note('layout-' + vp.w, true);
  });
}
