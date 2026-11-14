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
const SHA = process.env.TESTED_SHA || process.env.GITHUB_SHA || 'local';
const VIEWPORTS = [1440, 1280, 1024, 768, 390].map((w) => ({ w, h: w >= 1024 ? 900 : 844 }));
const SERVED = /^\/(index\.html|brand-tokens\.css|style\.css|unified\/[A-Za-z0-9._-]+)$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const FIX = {
  health: { status: 'ok' },
  metrics: { source_count: 3, document_count: 9, fact_count: 42, event_count: 5, io_count: 5 },
  /* Intelligence contract V1 shape: {objects:[…], next_cursor:string|null}; cursor is the opaque
     "derived_at|event_id|event_version" tuple, URL-encoded by the client on the wire. */
  feed: { objects: [{ io_id: 'io-test-1', headline: 'SYNTHETIC TEST ROW', event_type: 'test_event', status: 'active', created_at: '2026-01-01T00:00:00Z' }, { io_id: 'io-test-2', headline: 'SYNTHETIC ROW WITHOUT OTHER FIELDS' }], next_cursor: '2026-01-01T00:00:00Z|ev-test-2|1' },
  feedPage2: { objects: [{ io_id: 'io-test-3', headline: 'SYNTHETIC PAGE 2 ROW', event_type: 'test_event', status: 'active', created_at: '2026-01-01T01:00:00Z' }], next_cursor: null },
  obj: { io_id: 'io-test-1', event_id: 'ev-test-1', event_type: 'test_event', event_version: 1, status: 'active', created_at: '2026-01-01T00:00:00Z' },
  trace: { chain: [{ source: 'src-test', document: { canonical_url: 'https://example.test/doc' }, representation: { representation_id: 'rep-test', content_sha256: '0'.repeat(64) }, evidence: ['ev-1'], fact: 'fact-test' }] },
  errCore: { error: { code: 'IO_NOT_FOUND', message: 'unknown io_id' } } /* documented Core error envelope */
};
const report = { sha: SHA, started: new Date().toISOString(), viewports: VIEWPORTS.map((v) => v.w), checks: [], browser: null };
const note = (name, ok, detail) => report.checks.push({ name, ok, detail: detail || '' });

function rt(name, fn) { return test(name, async (t) => { try { await fn(t); } catch (e) { note(name, false, String((e && e.message) || e).slice(0, 1200)); throw e; } }); }
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
  if (mode === 'synthetic' || mode === 'nocursor' || mode === 'hang') {
    await ctx.route('**/core/**', (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^\/core/, '');
      if (p === '/v1/intelligence') {
        if (mode === 'nocursor') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: FIX.feed.objects }) });
        const cur = u.searchParams.get('cursor');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cur ? FIX.feedPage2 : FIX.feed) });
      }
      if (p === '/health' && mode === 'hang') { /* hung connection — the client must abort at its own deadline */
        return new Promise((done) => setTimeout(() => { route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIX.health) }).then(done, done); }, 10500));
      }
      if (p === '/v1/intelligence/io-gone') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(FIX.errCore) });
      if (p === '/v1/intelligence/io-ambiguous') return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      const map = { '/health': FIX.health, '/metrics': FIX.metrics, '/v1/intelligence/io-test-1': FIX.obj, '/v1/intelligence/io-test-1/trace': FIX.trace };
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

rt('shell: assets load, three nav groups, no errors (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'overview');
  const groups = await page.locator('.nav-group-title').allTextContents();
  assert.deepEqual(groups, ['Executive Intelligence', 'Research & Evidence', 'Production & Governance']);
  assert.equal(await page.locator('#topnav a').count(), 16); // 15 routed modules + matrix link
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('shell', true); await ctx.close();
});

rt('synthetic Core: overview, feed, detail, evidence, matrix (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'overview');
  let t = await text(page);
  assert.match(t, /CONTRACTED_NOT_LIVE_VERIFIED/); assert.match(t, /document_count/); assert.match(t, /\b42\b/);
  assert.doesNotMatch(t, /Live response received.*LIVE_VERIFIED/s);
  await go(page, 'intelligence', () => document.querySelector('.u-table'));
  t = await text(page); assert.match(t, /SYNTHETIC TEST ROW/); assert.match(t, /Not provided by Core/);
  assert.match(t, /Showing 2 record\(s\) — page limit 50 per Core request\./); assert.match(t, /Next page →/);
  await page.locator('a', { hasText: 'io-test-1' }).first().click();
  await page.waitForSelector('.u-chain');
  t = await text(page); assert.match(t, /example\.test\/doc/); assert.match(t, /rep-test/); assert.match(t, /Evidence chain/);
  await go(page, 'evidence');
  await page.fill('input[aria-label="io_id"]', 'io-test-1'); await page.click('button');
  await page.waitForSelector('.u-chain'); assert.match(await text(page), /fact-test/);
  await go(page, 'matrix', () => document.querySelector('.u-table'));
  const rows = await page.locator('.u-table tr').count(); assert.equal(rows, 1 + 16 + 4);
  const cells = await page.locator('.u-table td').allTextContents();
  assert.ok(!cells.includes('LIVE_VERIFIED')); assert.equal(cells.filter((c) => c === 'SNAPSHOT_QUARANTINED').length, 4);
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('synthetic-core-flows', true); await ctx.close();
});

rt('unavailable and blocked modules state it plainly and show no data', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  for (const k of NOT_AVAILABLE) { await go(page, k); const t = await text(page); assert.match(t, /NOT AVAILABLE in the current Core contract/, k); assert.match(t, /NOT_EXPOSED_BY_CORE/, k); assert.doesNotMatch(t, /LIVE_RESPONSE|Live response/, k); assert.equal(await page.locator('.u-table').count(), 0, k); }
  for (const k of BLOCKED) { await go(page, k); const t = await text(page); assert.match(t, /BLOCKED — no secure verified path/, k); assert.match(t, /BLOCKED_NO_SECURE_PATH/, k); }
  assert.deepEqual(rec.pageerrors, []);
  note('unavailable-modules', true, NOT_AVAILABLE.length + ' not-exposed + ' + BLOCKED.length + ' blocked'); await ctx.close();
});

rt('no /core channel: states it, UI keeps working', async () => {
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

rt('footer and visible text make no absolute traceability claim', async () => {
  const { ctx, page } = await open(VIEWPORTS[0], 'nochannel');
  await go(page, 'overview');
  const all = await page.locator('body').innerText();
  assert.doesNotMatch(all, /every displayed object is traceable/i); assert.match(all, /only where Core successfully returns a trace/);
  assert.doesNotMatch(all, /production[- ]ready|EVIDENCE_TRACEABILITY_PASS|prototype/i);
  note('wording', true); await ctx.close();
});

rt('feed pagination follows the documented cursor contract (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'intelligence', () => document.querySelector('.u-table'));
  let t = await text(page);
  assert.match(t, /Showing 2 record\(s\) — page limit 50 per Core request\./);
  assert.match(t, /Next page →/); assert.doesNotMatch(t, /Previous page/);
  await page.getByRole('button', { name: /Next page/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('SYNTHETIC PAGE 2 ROW'), null, { timeout: 15000 });
  t = await text(page);
  assert.match(t, /Showing 1 record\(s\)/); assert.match(t, /Previous page/); assert.doesNotMatch(t, /Next page →/);
  assert.match(t, /next_cursor is null/); /* page 2 is stated as the last page — no silent drop */
  const curReq = rec.requests.find((r) => /cursor=/.test(r.url));
  assert.ok(curReq, 'a cursor continuation request was issued');
  assert.match(curReq.url, /limit=50&cursor=2026-01-01T00%3A00%3A00Z%7Cev-test-2%7C1/, 'cursor sent URL-encoded, allow-list accepted');
  await page.getByRole('button', { name: /Previous page/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('SYNTHETIC TEST ROW'), null, { timeout: 15000 });
  assert.doesNotMatch(await text(page), /SYNTHETIC PAGE 2 ROW/);
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('feed-pagination', true); await ctx.close();
});

rt('feed without a continuation field states the 50-record bound explicitly', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'nocursor');
  await go(page, 'intelligence', () => document.querySelector('.u-table'));
  const t = await text(page);
  assert.match(t, /Showing 2 record\(s\)/);
  assert.match(t, /may be showing only the first 50 records/);
  assert.doesNotMatch(t, /Next page →/); assert.doesNotMatch(t, /Previous page/);
  assert.doesNotMatch(t, /next_cursor is null/);
  assert.deepEqual(rec.pageerrors, []);
  note('feed-bounded-no-contract', true); await ctx.close();
});

rt('404 origin classification rendered: Core-attributed vs undetermined (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'intelligence/io-gone', () => document.querySelector('.u-state'));
  let t = await text(page);
  assert.match(t, /NOT_FOUND_BY_CORE/); assert.match(t, /Core answered 404 for this resource/);
  await go(page, 'intelligence/io-ambiguous', () => document.querySelector('.u-state'));
  t = await text(page);
  assert.match(t, /UNDETERMINED_404/); assert.match(t, /not attributable to Core/);
  assert.doesNotMatch(t, /Core answered 404 for this resource/);
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('404-origin-classification', true); await ctx.close();
});

rt('timeout: a hung /core request cannot leave the UI in Reading Core… (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'hang');
  await go(page, 'overview'); /* health hangs; the client must abort at 10s and render the failure */
  const t = await text(page);
  assert.match(t, /TEMPORARY_FAILURE/); assert.match(t, /timeout after 10000ms/);
  assert.equal(await page.locator('.u-load').count(), 0);
  assert.match(t, /document_count/); /* metrics answered; only the hung call degraded */
  assert.deepEqual(rec.pageerrors, []);
  note('request-timeout', true); await ctx.close();
});

rt('network audit: GET only, same-origin, no snapshot/production/credential traffic', async () => {
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
  rt('layout @' + vp.w + 'px: no horizontal overflow, screenshots', async () => {
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
