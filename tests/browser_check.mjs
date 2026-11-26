// tests/browser_check.mjs — v13 real-browser verification (task 0.4 follow-up).
//
// test_v13.mjs proves the SPA through a hand-rolled DOM double; this file proves the same
// SPA in a REAL headless Chromium (Playwright, already available in the sandbox — not an
// npm dependency of the project). It starts THIS checkout's server.js against the same
// embedded mock engine that test_v13.mjs embeds (duplicated here minimally on purpose:
// importing test_v13.mjs would execute its whole suite), then drives every route at two
// viewports and asserts:
//   - no page-level horizontal overflow at 1366x850 and 375x812 (scrollWidth <= innerWidth + 2)
//   - no console errors / page errors on any route × viewport
//   - #/directory at 375px: rows render, the text filter narrows and restores, one header
//     sort click re-orders rows (objects → largest first)
//   - #/coverage: no literal "؟" anywhere in the rendered text; country chips carry the
//     Arabic names the server resolves (كندا / ألمانيا)
//   - screenshots into .test-runs/shots/ for a human/agent visual check
//
// Usage:  node tests/browser_check.mjs     (ports 5211 mock core, 8791 server — 127.0.0.1 only)
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'mock';
const CORE_PORT = 5211, PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(CHECKOUT, '.test-runs', 'shots');
const SCRATCH = path.join(CHECKOUT, '.test-runs', 'browser');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SCRATCH, { recursive: true });

// ── embedded engine mock — minimal duplicate of tests/test_v13.mjs ────────────────
const R = (source_id, institution_id, institution_name, country, source_class, qualification_status, health_status) => ({
  source_id, institution_id, institution_name, country, jurisdiction: country, region: '', domain: '',
  source_class, official_domain: '', canonical_url: 'https://example.invalid/', acquisition_endpoint: 'https://example.invalid/feed',
  endpoint_type: 'RSS', acquisition_method: 'RSS', language: 'en', coverage_topics: [], frequency: 'daily',
  authority_level: 'PRIMARY_OFFICIAL', qualification_status, health_status, last_verified_at: '', last_success_at: '',
  last_document_at: '', last_event_at: '', discovered_at: '', discovery_wave: 'A', qualification_notes: '' });
const REGISTRY = [
  R('src-alpha', 'INST-alpha-001', 'Alpha Central Bank', 'DE', 'central_bank', 'DISCOVERED', 'UNSUPPORTED'),
  R('src-alpha', 'INST-alpha-001', 'Alpha Central Bank', 'DE', 'central_bank', 'DOMAIN_VERIFIED', 'UNSUPPORTED'),
  R('src-alpha', 'INST-alpha-001', 'Alpha Central Bank', 'DE', 'statistical_agency', 'PRODUCTION_READY', 'HEALTHY'),
  R('src-boc', 'INST-boc-001', 'src-boc', 'CA', 'central_bank', 'DISCOVERED', 'UNSUPPORTED'),
  R('src-boc', 'INST-boc-001', 'src-boc', 'CA', 'central_bank', 'PRODUCTION_READY', 'HEALTHY'),
  R('src-beta', 'INST-beta-001', 'Beta Regulator', 'FR', 'securities_regulator', 'DISCOVERED', 'UNSUPPORTED'),
  R('src-beta', 'INST-beta-001', 'Beta Regulator', 'FR', 'securities_regulator', 'REQUIRES_REMEDIATION', 'BLOCKED'),
  R('src-gamma', 'INST-gamma-001', 'Gamma Office', 'XX', 'unknown_class', 'DISCOVERED', 'UNSUPPORTED'),
  R('src-gamma', 'INST-gamma-001', 'Gamma Office', 'XX', 'unknown_class', 'WEIRD_NEW_STATE', 'STRANGE_HEALTH'),
  R('src-delta', 'INST-delta-001', 'Delta Ministry', '', 'labor_ministry', 'DISCOVERED', 'UNSUPPORTED'),
];
const obj = (io_id, sid, inst, when, value) => ({
  io_id, version: 1, event_id: 'evt-' + io_id, event_version: 1, status: 'ACTIVE', supersedes_io_id: null,
  superseded_by_io_id: null, headline: 'Headline ' + io_id, created_at: when, event_type: 'statistical_release',
  chain: [{ fact: { fact_id: 'f-' + io_id, fact_version: 1, metric: 'inflation_rate', value, unit: 'percent', reference_period: '2026-07' },
    evidence: [{ evidence_id: 'ev-' + io_id, excerpt: 'issued ' + value, representation_id: 'rep-' + io_id }],
    representation: { representation_id: 'rep-' + io_id, content_sha256: 'a'.repeat(64) },
    document: { document_id: 'doc-' + io_id, canonical_url: 'https://example.invalid/' + io_id },
    source: { source_id: sid, institution_id: inst } }],
  temporal_data: { publication_time: when, publication_time_raw: when, publication_timezone_status: 'EXPLICIT_ZONE',
    reference_period: '2026-07', reference_period_normalized_utc: '2026-07',
    temporal_tuples: [{ original_value: when, timezone_status: 'EXPLICIT_ZONE', normalized_utc: when,
      normalization_basis: 'EXPLICIT_SOURCE_TIMEZONE', timestamp_semantics: 'publication', provenance_source: 'rss_pubdate' }] } });
const OBJECTS = [
  obj('io-1', 'src-alpha', 'INST-alpha-001', '2026-07-31T00:00:00Z', '2.1'),
  obj('io-2', 'src-alpha', 'INST-alpha-001', '2026-08-12T08:00:00Z', '2.2'),
  obj('io-3', 'src-boc', 'INST-boc-001', '2026-08-13T08:00:00Z', '1.9'),
  obj('io-4', 'src-gamma', 'INST-gamma-001', '2026-08-14T08:00:00Z', '3.0'),
];
const METRICS = { captured_at: '2026-11-26T00:00:00Z', io_count: OBJECTS.length, fact_count: 8, document_count: 4,
  source_count: 4, event_count: OBJECTS.length,
  runs: { latest_run: { run_id: 'run-v13', finished_at: new Date(Date.now() - 3600e3).toISOString().replace(/\.\d+Z$/, 'Z') } } };

function mockCore() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, b) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'auth' });
    if (u.pathname === '/metrics') return send(200, METRICS);
    if (u.pathname === '/v1/ops/registry') return send(200, { records: REGISTRY });
    if (u.pathname === '/v1/intelligence') return send(200, { objects: OBJECTS, next_cursor: null });
    const m = u.pathname.match(/^\/v1\/intelligence\/([^/]+)\/trace$/);
    if (m) { const o = OBJECTS.find((x) => x.io_id === m[1]); return o ? send(200, { io_id: o.io_id, chain: o.chain }) : send(404, { error: 'nf' }); }
    send(404, { error: 'nf' });
  });
}
const listen = (s, port) => new Promise((res, rej) => { s.once('error', rej); s.listen(port, '127.0.0.1', () => res(s)); });
const core = await listen(mockCore(), CORE_PORT);
const server = spawn(process.execPath, [path.join(CHECKOUT, 'server.js')], { cwd: CHECKOUT, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), CORE_URL: 'http://127.0.0.1:' + CORE_PORT, CORE_TOKEN: TOKEN, REVIEWS_DATA_DIR: SCRATCH } });
const shutdown = () => { try { server.kill(); } catch (_) {} try { core.close(); } catch (_) {} };
process.on('exit', shutdown); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
for (let i = 0; i < 60; i++) { if (await fetch(BASE + '/analyst/api/summary').then((r) => r.ok).catch(() => false)) break; await new Promise((r) => setTimeout(r, 500)); }

// ── tiny assertion runner ─────────────────────────────────────────────────────────
let pass = 0; const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('PASS ' + name); } else { fails.push(name); console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

// ── real browser drive ────────────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ROUTES = ['dashboard', 'directory', 'coverage', 'desk', 'indicators', 'review', 'ops'];
const VIEWPORTS = [[1366, 850, 'desktop'], [375, 812, '375']];

for (const [width, height, label] of VIEWPORTS) {
  for (const route of ROUTES) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e));
    await page.goto(`${BASE}/rouaa-console-dark.html#/${route}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => ((document.querySelector('#app') || {}).innerHTML || '').length > 300, null, { timeout: 15000 });
    await page.waitForTimeout(400); // let late fetches settle
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`#/${route} @${label}: no page-level horizontal overflow`, over <= 2, `scrollWidth - innerWidth = ${over}`);
    check(`#/${route} @${label}: no console errors`, errors.length === 0, errors.join(' | ').slice(0, 300));

    if (route === 'coverage') {
      const text = await page.evaluate(() => document.body.innerText);
      check(`#/coverage @${label}: no literal «؟» in the rendered text`, !text.includes('؟'));
      const chips = await page.evaluate(() => ((document.querySelector('#covChips') || {}).innerText || ''));
      check(`#/coverage @${label}: chips carry Arabic country names`, chips.includes('كندا') && chips.includes('ألمانيا'), JSON.stringify(chips.slice(0, 120)));
    }
    if (route === 'directory' && label === '375') {
      const nRows = () => page.evaluate(() => document.querySelectorAll('#dirBody tr[data-sid]').length);
      const firstSid = () => page.evaluate(() => { const t = document.querySelector('#dirBody tr[data-sid]'); return t ? t.getAttribute('data-sid') : null; });
      const n0 = await nRows();
      check('#/directory @375: table populated with rows', n0 === 5, 'rows=' + n0);
      await page.fill('#dirQ', 'كندا');
      await page.waitForTimeout(150);
      const n1 = await nRows();
      check('#/directory @375: text filter narrows the rows', n1 > 0 && n1 < n0, `5 -> ${n1}`);
      await page.fill('#dirQ', '');
      await page.waitForTimeout(150);
      check('#/directory @375: clearing the filter restores all rows', (await nRows()) === n0);
      const before = await firstSid();
      await page.click('#dirTable th[data-col="objects"] button');
      await page.waitForTimeout(150);
      const after = await firstSid();
      check('#/directory @375: one header sort click re-orders rows (objects: largest first)',
        before !== after && after === 'src-alpha', `${before} -> ${after}`);
      await page.screenshot({ path: path.join(SHOTS, 'dir-375.png'), fullPage: true });
    }
    if (route === 'directory' && label === 'desktop') {
      await page.screenshot({ path: path.join(SHOTS, 'dir-desktop.png'), fullPage: true });
    }
    if (route === 'coverage' && label === '375') {
      await page.screenshot({ path: path.join(SHOTS, 'coverage-375.png'), fullPage: true });
    }
    if (route === 'dashboard' && label === '375') {
      await page.screenshot({ path: path.join(SHOTS, 'dashboard-375.png'), fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();

console.log(`\n═══ browser_check: ${pass}/${pass + fails.length} passed (shots in .test-runs/shots) ═══`);
if (fails.length) { process.exitCode = 1; for (const f of fails) console.log('FAILED: ' + f); }
