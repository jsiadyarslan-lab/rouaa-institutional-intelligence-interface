'use strict';
/* R2 browser acceptance (Playwright). Synthetic /core responses exist ONLY in this file, to drive the UI;
   they are never product data and never claim to be Core output. R2D: every 2xx synthetic answer is an
   IMPERSONATING UPSTREAM — the UI must show the UPSTREAM ORIGIN UNVERIFIED banner and must NOT render
   the payload as Core data (no health/counts table, no feed table, no trace chain). Pagination and
   recovery behaviour are still exercised under the banner via the diagnostics payload. */
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
     "derived_at|event_id|event_version" tuple, URL-encoded by the client on the wire.
     Page 3 exists so the UI can be driven through page1 → page2 → page3(null) and, in 'feedfail'
     mode, through a page-3 transport failure for the recovery path. */
  feed: { objects: [{ io_id: 'io-test-1', headline: 'SYNTHETIC TEST ROW', event_type: 'test_event', status: 'active', created_at: '2026-01-01T00:00:00Z' }, { io_id: 'io-test-2', headline: 'SYNTHETIC ROW WITHOUT OTHER FIELDS' }], next_cursor: '2026-01-01T00:00:00Z|ev-test-2|1' },
  feedPage2: { objects: [{ io_id: 'io-test-3', headline: 'SYNTHETIC PAGE 2 ROW', event_type: 'test_event', status: 'active', created_at: '2026-01-01T01:00:00Z' }], next_cursor: '2026-01-01T01:00:00Z|ev-test-3|1' },
  feedLast: { objects: [{ io_id: 'io-test-4', headline: 'SYNTHETIC LAST PAGE ROW', event_type: 'test_event', status: 'active', created_at: '2026-01-01T02:00:00Z' }], next_cursor: null },
  obj: { io_id: 'io-test-1', event_id: 'ev-test-1', event_type: 'test_event', event_version: 1, status: 'active', created_at: '2026-01-01T00:00:00Z' },
  trace: { chain: [{ source: 'src-test', document: { canonical_url: 'https://example.test/doc' }, representation: { representation_id: 'rep-test', content_sha256: '0'.repeat(64) }, evidence: ['ev-1'], fact: 'fact-test' }] },
  errCore: { error: { code: 'IO_NOT_FOUND', message: 'unknown io_id' } } /* documented Core error envelope — reproducible by any proxy */
};
const report = { sha: SHA, started: new Date().toISOString(), viewports: VIEWPORTS.map((v) => v.w), checks: [], browser: null };
const note = (name, ok, detail) => report.checks.push({ name, ok, detail: detail || '' });
/* the exact R2D banner wording the UI must render on unverified-origin answers */
const BANNER = 'upstream source has not been verified. The payload is retained for diagnostics only and is not presented as trusted ROUAA Core intelligence';

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

const CURSOR_P2 = '2026-01-01T00:00:00Z|ev-test-2|1';
const CURSOR_P3 = '2026-01-01T01:00:00Z|ev-test-3|1';

async function open(vp, mode) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const rec = { pageerrors: [], consoleErrors: [], requests: [], badResponses: [] };
  if (mode !== 'nochannel') {
    /* The route below is a synthetic /core frontend. Every 200 it serves is exactly what an
       impersonating proxy could serve — contract-perfect success payloads. The UI must still
       render them under UPSTREAM ORIGIN UNVERIFIED (R2D §5). Its 404 answers deliberately include
       one byte-identical Core error envelope (io-gone) — the error-side impersonation of R2C §2. */
    await ctx.route('**/core/**', (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^\/core/, '');
      if (p === '/v1/intelligence') {
        if (mode === 'nocursor') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: FIX.feed.objects }) });
        if (mode === 'badcursor') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: FIX.feed.objects, next_cursor: 5 }) });
        const cur = u.searchParams.get('cursor');
        if (cur === CURSOR_P2) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIX.feedPage2) });
        if (cur === CURSOR_P3) {
          if (mode === 'feedfail') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(FIX.errCore) });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIX.feedLast) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIX.feed) });
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
/* innerText omits the hidden text inside a collapsed <details>: pass expandAll to read diagnostics content too */
const textAll = (page) => page.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); return document.querySelector('#app').textContent; });
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

rt('R2D §5: success impersonation on overview — banner shown, no Core health, no store counts', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'overview');
  const t = await text(page);
  assert.match(t, /UPSTREAM ORIGIN UNVERIFIED/);
  assert.match(t, new RegExp(BANNER)); /* the exact R2D wording */
  const headings = await page.locator('.u-body h2, .u-body h3').allTextContents();
  assert.deepEqual(headings, [], 'no heading may present the payload as Core health / Core store counts');
  assert.doesNotMatch(t, /LIVE_RESPONSE/); /* no live-response state anywhere */
  assert.doesNotMatch(t, /\b42\b/); /* metrics figure NOT rendered as data (only inside the collapsed diagnostics JSON) */
  assert.doesNotMatch(t, /status\s+ok/); /* /health payload not tabulated as fact */
  assert.equal(await page.locator('.u-table').count(), 0, 'no data table may render unverified payloads');
  assert.ok(await page.locator('details.u-raw summary').count() >= 2, 'both payloads retained in collapsed diagnostics sections');
  const collapsed = await text(page); /* capture BEFORE expanding — the default rendering */
  const openText = await textAll(page); /* expand the diagnostics sections, then read */
  assert.match(openText, /document_count/); /* the raw payload IS retained once expanded — diagnostics only */
  assert.match(openText, /diagnostics only — upstream origin unverified/i);
  assert.doesNotMatch(collapsed, /\b42\b/); /* but collapsed by default — figures are not visible data */
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('overview-unverified-banner', true); await ctx.close();
});

rt('R2D §5: success impersonation on feed — banner, no Intelligence Objects rendered, diagnostics kept', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'intelligence');
  const t = await text(page);
  assert.match(t, /UPSTREAM ORIGIN UNVERIFIED/); assert.match(t, new RegExp(BANNER));
  assert.match(t, /2 object\(s\) are present in the unverified payload/);
  assert.match(t, /NOT rendered as Intelligence Objects/);
  assert.match(t, /Order \(per the documented contract\): oldest first/); /* ordering still stated */
  assert.equal(await page.locator('.u-table').count(), 0, 'the feed payload must not become a data table');
  assert.match(t, /Next page →/); /* pagination preserved under the banner */
  assert.doesNotMatch(t, /LIVE_RESPONSE/);
  assert.match(await textAll(page), /SYNTHETIC TEST ROW/); /* payload visible ONLY inside the diagnostics section (expand to read) */
  assert.doesNotMatch(t, /SYNTHETIC TEST ROW/); /* and not in the visible page text while collapsed */
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('feed-unverified-banner', true); await ctx.close();
});

rt('R2D §5: success impersonation on object detail and trace — no verified evidence chain', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'intelligence/io-test-1');
  let t = await text(page);
  assert.match(t, /UPSTREAM ORIGIN UNVERIFIED/); assert.match(t, new RegExp(BANNER));
  assert.doesNotMatch(t, /Not provided by Core/); /* the object payload is NOT tabulated into field rows */
  assert.equal(await page.locator('.u-table').count(), 0, 'object payload must not be rendered as a field table');
  assert.equal(await page.locator('.u-chain').count(), 0, 'trace payload must not be rendered as an evidence chain');
  assert.match(t, /not rendered as institutional intelligence/);
  assert.match(t, /not rendered as a verified evidence chain/);
  t = await textAll(page); /* expand diagnostics to verify payload retention */
  assert.match(t, /ev-test-1/); /* object payload retained in diagnostics */
  await go(page, 'evidence');
  await page.fill('input[aria-label="io_id"]', 'io-test-1'); await page.click('button');
  await page.waitForFunction(() => document.body.innerText.includes('UPSTREAM ORIGIN UNVERIFIED'), null, { timeout: 15000 });
  t = await text(page);
  assert.match(t, /UPSTREAM ORIGIN UNVERIFIED/);
  assert.equal(await page.locator('.u-chain').count(), 0, 'no evidence chain from an unverified payload');
  assert.match(await textAll(page), /fact-test/); /* trace payload retained in diagnostics only */
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('detail-trace-unverified-banner', true); await ctx.close();
});

rt('unavailable and blocked modules state it plainly and show no data', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  for (const k of NOT_AVAILABLE) { await go(page, k); const t = await text(page); assert.match(t, /NOT AVAILABLE in the current Core contract/, k); assert.match(t, /NOT_EXPOSED_BY_CORE/, k); assert.doesNotMatch(t, /LIVE_RESPONSE|UNVERIFIED_UPSTREAM_RESPONSE/, k); assert.equal(await page.locator('.u-table').count(), 0, k); }
  for (const k of BLOCKED) { await go(page, k); const t = await text(page); assert.match(t, /BLOCKED — no secure verified path/, k); assert.match(t, /BLOCKED_NO_SECURE_PATH/, k); }
  assert.deepEqual(rec.pageerrors, []);
  note('unavailable-modules', true, NOT_AVAILABLE.length + ' not-exposed + ' + BLOCKED.length + ' blocked'); await ctx.close();
});

rt('no /core channel: host HTML 404 proves neither Core origin nor provisioning state, UI keeps working', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'nochannel');
  for (const k of ['overview', 'intelligence', 'evidence']) { await go(page, k); }
  await go(page, 'overview'); let t = await text(page);
  assert.match(t, /UNDETERMINED_404/); assert.match(t, /not attributable to Core/);
  assert.doesNotMatch(t, /CHANNEL_NOT_PROVISIONED/); /* an HTML 404 alone is not evidence about provisioning */
  assert.doesNotMatch(t, /UPSTREAM ORIGIN UNVERIFIED/); /* nothing arrived — no unverified-payload banner either */
  await go(page, 'intelligence'); t = await text(page); assert.match(t, /UNDETERMINED_404/); assert.equal(await page.locator('.u-table').count(), 0);
  await go(page, 'intelligence/io-test-1', () => document.querySelector('.u-state')); assert.match(await text(page), /UNDETERMINED_404/);
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

rt('feed pagination follows the documented cursor contract under the unverified-origin banner (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'intelligence');
  let t = await text(page);
  assert.match(t, /UPSTREAM ORIGIN UNVERIFIED/); /* R2D: pagination works under the banner, without trust */
  assert.match(t, /2 object\(s\) are present in the unverified payload/);
  assert.match(t, /Next page →/); assert.doesNotMatch(t, /Previous page/);
  await page.getByRole('button', { name: /Next page/ }).click();
  await page.waitForFunction(() => document.body.textContent.split('SYNTHETIC PAGE 2 ROW').length >= 2, null, { timeout: 15000 }); /* page 2 payload in diagnostics */
  t = await text(page);
  assert.match(t, /1 object\(s\) are present in the unverified payload/);
  assert.match(t, /Previous page/); assert.match(t, /Next page →/);
  const curReq = rec.requests.find((r) => /cursor=/.test(r.url));
  assert.ok(curReq, 'a cursor continuation request was issued');
  assert.match(curReq.url, /limit=50&cursor=2026-01-01T00%3A00%3A00Z%7Cev-test-2%7C1/, 'cursor sent URL-encoded, allow-list accepted');
  await page.getByRole('button', { name: /Next page/ }).click();
  await page.waitForFunction(() => document.body.textContent.split('SYNTHETIC LAST PAGE ROW').length >= 2, null, { timeout: 15000 }); /* page 3 payload in diagnostics */
  const p3reqs = rec.requests.filter((r) => /cursor=2026-01-01T01%3A00%3A00Z%7Cev-test-3%7C1/.test(r.url));
  assert.ok(p3reqs.length >= 1, 'page-3 cursor was requested');
  t = await text(page);
  assert.match(t, /next_cursor is null/); /* the last-page claim is made ONLY for a literal null */
  assert.doesNotMatch(t, /Next page →/); assert.match(t, /Previous page/);
  assert.equal(await page.locator('.u-table').count(), 0, 'no page of the feed ever renders as a data table');
  await page.getByRole('button', { name: /Previous page/ }).click();
  await page.waitForFunction(() => document.body.textContent.split('SYNTHETIC PAGE 2 ROW').length >= 2, null, { timeout: 15000 });
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('feed-pagination', true); await ctx.close();
});

rt('invalid next_cursor value: continuation state unknown, no completeness claim, raw kept (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'badcursor');
  await go(page, 'intelligence');
  const t = await text(page);
  assert.match(t, /2 object\(s\) are present in the unverified payload/);
  assert.match(t, /invalid value/); assert.match(t, /continuation state is unknown/i);
  assert.doesNotMatch(t, /Next page →/); /* no link is built from an invalid value */
  assert.doesNotMatch(t, /next_cursor is null/); /* no false completeness claim */
  assert.doesNotMatch(t, /may be showing only the first 50/); /* that wording belongs to the missing-field case only */
  assert.match(t, /diagnostics only — upstream origin unverified/i); /* the raw record is kept, labelled unverified */
  assert.deepEqual(rec.pageerrors, []);
  note('feed-invalid-cursor-value', true); await ctx.close();
});

rt('pagination recovery: a failed page keeps Previous and Retry, cursor preserved (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'feedfail');
  await go(page, 'intelligence'); /* page 1 */
  await page.getByRole('button', { name: /Next page/ }).click();
  await page.waitForFunction(() => document.body.textContent.split('SYNTHETIC PAGE 2 ROW').length >= 2, null, { timeout: 15000 }); /* page 2 (diagnostics) */
  await page.getByRole('button', { name: /Next page/ }).click();
  await page.waitForSelector('.u-state', { timeout: 15000 }); /* page 3 → 503 */
  let t = await text(page);
  assert.match(t, /TEMPORARY_FAILURE/); assert.match(t, /HTTP 503/); assert.match(t, /not attributable to Core/);
  assert.match(t, /Previous page/); /* R2C §5: Previous survives a failed page load */
  assert.match(t, /Retry this page/);
  assert.doesNotMatch(t, /object\(s\) are present/); /* failed page shows no payload-count note */
  const p3url = /cursor=2026-01-01T01%3A00%3A00Z%7Cev-test-3%7C1/;
  assert.ok(rec.requests.some((r) => p3url.test(r.url)), 'page-3 cursor was requested');
  await page.getByRole('button', { name: /Retry this page/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.u-state').length > 0, null, { timeout: 15000 }); /* fails again, same cursor */
  assert.ok(rec.requests.filter((r) => p3url.test(r.url)).length >= 2, 'Retry re-requested the SAME cursor without mutating the stack');
  await page.getByRole('button', { name: /Previous page/ }).click();
  await page.waitForFunction(() => document.body.textContent.split('SYNTHETIC PAGE 2 ROW').length >= 2, null, { timeout: 15000 });
  t = await text(page);
  assert.match(t, /1 object\(s\) are present in the unverified payload/); assert.match(t, /Next page →/); assert.doesNotMatch(t, /TEMPORARY_FAILURE/);
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('pagination-recovery', true); await ctx.close();
});

rt('feed without a continuation field states the bound explicitly, without completeness', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'nocursor');
  await go(page, 'intelligence');
  const t = await text(page);
  assert.match(t, /2 object\(s\) are present in the unverified payload/);
  assert.match(t, /next_cursor is absent from this payload/);
  assert.doesNotMatch(t, /Next page →/); assert.doesNotMatch(t, /Previous page/);
  assert.doesNotMatch(t, /next_cursor is null/);
  assert.deepEqual(rec.pageerrors, []);
  note('feed-bounded-no-contract', true); await ctx.close();
});

rt('origin attribution in the browser: impersonating-proxy 404 (exact Core envelope) stays UNDETERMINED (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  await go(page, 'intelligence/io-gone', () => document.querySelector('.u-state')); /* route answers with the byte-identical Core envelope */
  let t = await text(page);
  assert.match(t, /UNDETERMINED_404/); assert.match(t, /shape evidence only/);
  assert.doesNotMatch(t, /NOT_FOUND_BY_CORE/); assert.doesNotMatch(t, /Core answered 404 for this resource/);
  await go(page, 'intelligence/io-ambiguous', () => document.querySelector('.u-state'));
  t = await text(page);
  assert.match(t, /UNDETERMINED_404/); assert.match(t, /not provable/);
  assert.deepEqual(rec.pageerrors, []); assert.deepEqual(rec.consoleErrors, []); assert.deepEqual(rec.badResponses, []);
  note('404-origin-attribution', true); await ctx.close();
});

rt('timeout: a hung /core request cannot leave the UI in Reading… (functional, 1440)', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'hang');
  await go(page, 'overview'); /* health hangs; the client must abort at 10s and render the failure */
  const t = await text(page);
  assert.match(t, /TEMPORARY_FAILURE/); assert.match(t, /timeout after 10000ms/);
  assert.equal(await page.locator('.u-load').count(), 0);
  assert.match(t, /UPSTREAM ORIGIN UNVERIFIED/); /* metrics answered — but only as an unverified payload, banner shown */
  const h2s = await page.locator('.u-body h2, .u-body h3').allTextContents();
  assert.deepEqual(h2s, [], 'never presented as Core counts even when the other call hung');
  assert.deepEqual(rec.pageerrors, []);
  note('request-timeout', true); await ctx.close();
});

rt('network audit: GET only, same-origin, no snapshot/production/credential traffic', async () => {
  const { ctx, page, rec } = await open(VIEWPORTS[0], 'synthetic');
  for (const k of ['overview', 'intelligence', 'evidence', 'documents', 'matrix']) await go(page, k, () => document.querySelector('.u-wrap h1'));
  await go(page, 'intelligence/io-test-1', () => document.querySelectorAll('.u-state, details.u-raw').length > 0);
  assert.ok(rec.requests.length > 5);
  for (const r of rec.requests) {
    const u = new URL(r.url);
    assert.equal(r.method, 'GET', r.url); assert.equal(u.origin, base, r.url);
    assert.doesNotMatch(u.pathname, /production|proof-data|\/data\/|quarantine|p29/, r.url);
    assert.ok(!('authorization' in r.headers) && !('x-api-key' in r.headers), 'credential header on ' + r.url);
    assert.ok(!/[?&](test|mock|fixture|bypass)=/i.test(u.search), 'test-mode parameter on ' + r.url); /* R2D §6: no runtime trust bypass */
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
    const views = [['overview'], ['intelligence'], ['intelligence/io-test-1', () => document.querySelectorAll('.u-state, details.u-raw').length > 0], ['evidence'], ['documents'], ['matrix', () => document.querySelector('.u-table')]];
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
