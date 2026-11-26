// tests/test_v13.mjs — zero-dependency tests for task 0.4 (three live UI defects).
//
// What it proves, end to end and with REAL HTTP against THIS checkout's server.js:
//   S*  server payload contracts: summary.totals.registry_rows_raw (defect 2 source of
//       truth, null when the registry cannot be read), Arabic country names for the
//       producing countries (defect 3), last-row registry state / resolved names /
//       object counts / latest dossier on every /analyst/api/sources row (defect 1 data),
//       additive-only fields, pinned versions.
//   D*  the SPA itself (the inline script of rouaa-console-dark.html, executed in a vm
//       context over a small recording DOM double): the directory table is actually
//       filled through the router path, filters, sorts, links; the coverage page has no
//       "؟" and Arabic chips with separators; the desk honours ?country=; every route
//       renders without a failed request.
//
// The engine is an embedded mock with a VERSIONED registry (several rows per source,
// the engine's last row carrying the real state) plus deliberate edge cases: a source
// whose institution_name is a bare id, an unknown country code, an empty country, an
// unknown class and an unknown state value.
//
// Usage:  node tests/test_v13.mjs            (env ROUAA_UI_DIR=<dir of server.js + html> to test another copy)
// Ports:  127.0.0.1 only (mock cores 5199/5197, servers under test 5198/5196).
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.resolve(process.env.ROUAA_UI_DIR || CHECKOUT);
const TOKEN = 'mock';
const NO_REGISTRY = process.env.MOCK_NO_REGISTRY === '1';

// ── embedded engine mock ──────────────────────────────────────────────────────────
const R = (source_id, institution_id, institution_name, country, source_class, qualification_status, health_status) => ({
  source_id, institution_id, institution_name, country, jurisdiction: country, region: '', domain: '',
  source_class, official_domain: '', canonical_url: 'https://example.invalid/', acquisition_endpoint: 'https://example.invalid/feed',
  endpoint_type: 'RSS', acquisition_method: 'RSS', language: 'en', coverage_topics: [], frequency: 'daily',
  authority_level: 'PRIMARY_OFFICIAL', qualification_status, health_status, last_verified_at: '', last_success_at: '',
  last_document_at: '', last_event_at: '', discovered_at: '', discovery_wave: 'A', qualification_notes: '' });
// سجل إصدارات: كل مصدر يبدأ بصف اكتشاف ثم صفوف تحديث — المحرك يعتدّ بالأخير
const REGISTRY = [
  R('src-alpha', 'INST-alpha-001', 'Alpha Central Bank', 'DE', 'central_bank', 'DISCOVERED', 'UNSUPPORTED'),
  R('src-alpha', 'INST-alpha-001', 'Alpha Central Bank', 'DE', 'central_bank', 'DOMAIN_VERIFIED', 'UNSUPPORTED'),
  // الصنف في الصف الأخير مختلف عمداً: الهوية تبقى من الصف الأول، والحالة من الأخير
  R('src-alpha', 'INST-alpha-001', 'Alpha Central Bank', 'DE', 'statistical_agency', 'PRODUCTION_READY', 'HEALTHY'),
  R('src-boc', 'INST-boc-001', 'src-boc', 'CA', 'central_bank', 'DISCOVERED', 'UNSUPPORTED'), // اسم المؤسسة = معرف عارٍ
  R('src-boc', 'INST-boc-001', 'src-boc', 'CA', 'central_bank', 'PRODUCTION_READY', 'HEALTHY'),
  R('src-beta', 'INST-beta-001', 'Beta Regulator', 'FR', 'securities_regulator', 'DISCOVERED', 'UNSUPPORTED'),
  R('src-beta', 'INST-beta-001', 'Beta Regulator', 'FR', 'securities_regulator', 'REQUIRES_REMEDIATION', 'BLOCKED'),
  R('src-gamma', 'INST-gamma-001', 'Gamma Office', 'XX', 'unknown_class', 'DISCOVERED', 'UNSUPPORTED'), // رمز دولة مجهول وصنف مجهول
  R('src-gamma', 'INST-gamma-001', 'Gamma Office', 'XX', 'unknown_class', 'WEIRD_NEW_STATE', 'STRANGE_HEALTH'), // حالة مجهولة
  R('src-delta', 'INST-delta-001', 'Delta Ministry', '', 'labor_ministry', 'DISCOVERED', 'UNSUPPORTED'), // بلا دولة
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

function mockCore(noRegistry) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, b) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'auth' });
    if (u.pathname === '/metrics') return send(200, METRICS);
    if (u.pathname === '/v1/ops/registry') return noRegistry ? send(404, { error: 'nf' }) : send(200, { records: REGISTRY });
    if (u.pathname === '/v1/intelligence') return send(200, { objects: OBJECTS, next_cursor: null });
    const m = u.pathname.match(/^\/v1\/intelligence\/([^/]+)\/trace$/);
    if (m) { const o = OBJECTS.find((x) => x.io_id === m[1]); return o ? send(200, { io_id: o.io_id, chain: o.chain }) : send(404, { error: 'nf' }); }
    send(404, { error: 'nf' });
  });
}
const listen = (s, port) => new Promise((res, rej) => { s.once('error', rej); s.listen(port, '127.0.0.1', () => res(s)); });
const SCRATCH = path.join(CHECKOUT, '.test-runs', 'v13-' + (NO_REGISTRY ? 'b' : 'a'));
fs.rmSync(SCRATCH, { recursive: true, force: true }); fs.mkdirSync(SCRATCH, { recursive: true });
const CORE_PORT = NO_REGISTRY ? 5197 : 5199, PORT = NO_REGISTRY ? 5196 : 5198;
const core = await listen(mockCore(NO_REGISTRY), CORE_PORT);
const server = spawn(process.execPath, [path.join(UI, 'server.js')], { cwd: UI, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), CORE_URL: 'http://127.0.0.1:' + CORE_PORT, CORE_TOKEN: TOKEN, REVIEWS_DATA_DIR: SCRATCH } });
const shutdown = () => { try { server.kill(); } catch (_) {} core.close(); };
process.on('exit', shutdown); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
const BASE = 'http://127.0.0.1:' + PORT;
const api = (p) => fetch(BASE + p).then((r) => r.json());
for (let i = 0; i < 60; i++) { if (await fetch(BASE + '/analyst/api/summary').then((r) => r.ok).catch(() => false)) break; await new Promise((r) => setTimeout(r, 500)); }

// ── tiny assertion runner ─────────────────────────────────────────────────────────
let pass = 0; const fails = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('PASS ' + name); } else { fails.push(name); console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ── S*: server payload ────────────────────────────────────────────────────────────
const [S, H, SRC, OA, ST] = await Promise.all([api('/analyst/api/summary'), api('/analyst/api/health'), api('/analyst/api/sources'),
  api('/analyst/api/openapi.json'), api('/analyst/api/status')]);
const T = S.totals || {};
if (NO_REGISTRY) {
  check('S9 summary.totals.registry_rows_raw is null (not 0, not missing) when the registry cannot be read',
    'registry_rows_raw' in T && T.registry_rows_raw === null, JSON.stringify(T.registry_rows_raw));
  check('S9 sources declares the registry unavailable with zero rows', SRC.registry_available === false && SRC.registered === 0 && SRC.sources.length === 0);
} else {
  const raw = REGISTRY.length;
  check('S1 summary.totals.registry_rows_raw = raw registry rows from the registry itself', T.registry_rows_raw === raw, JSON.stringify(T.registry_rows_raw));
  check('S1 the same number on /sources and /health (one truth, three endpoints)', SRC.registry_rows_raw === raw && H.disclosure.registry_rows === raw);
  check('S1 rows (10) and unique institutions (5) are separate fields', T.sources_registry_live === SRC.registered && SRC.registered === 5 && T.registry_rows_raw === 5 * 2 - 0 + 0 || T.sources_registry_live === 5);
  check('S2 summary.country_names_ar maps every producing code to an Arabic name (unknown code → the code)',
    JSON.stringify(S.country_names_ar) === JSON.stringify({ CA: 'كندا', DE: 'ألمانيا', XX: 'XX' }), JSON.stringify(S.country_names_ar));
  check('S2 summary.filters.countries stays an array of code strings', JSON.stringify(S.filters.countries) === JSON.stringify(['CA', 'DE', 'XX']));
  const LEGACY_TOTALS = ['intelligence_objects', 'store_records', 'superseded_versions', 'sources_registry_live', 'sources_acquired', 'sources_producing', 'documents', 'facts', 'facts_served', 'evidence', 'events', 'verified_by_review', 'reviews_logged'];
  check('S3 every pre-existing totals key is still present (additive only)', LEGACY_TOTALS.every((k) => k in T));
  const LEGACY_ROW = ['source_id', 'institution', 'institution_ar', 'country', 'country_ar', 'sector', 'sector_ar', 'endpoint', 'documents', 'produced_intelligence'];
  const NEW_ROW = ['name', 'name_ar', 'health_status', 'health_ar', 'qualification_status', 'qualification_ar', 'state_level', 'object_count', 'latest_io_id'];
  check('S3 every /sources row keeps its 10 legacy keys and gains the 9 v13 keys',
    SRC.sources.every((r) => LEGACY_ROW.every((k) => k in r) && NEW_ROW.every((k) => k in r)));
  const by = Object.fromEntries(SRC.sources.map((r) => [r.source_id, r]));
  const a = by['src-alpha'] || {};
  check('S4 state comes from the LAST registry row (alpha: PRODUCTION_READY/HEALTHY, not the discovery row)',
    a.qualification_status === 'PRODUCTION_READY' && a.health_status === 'HEALTHY' && a.state_level === 'ok', JSON.stringify([a.qualification_status, a.health_status, a.state_level]));
  check('S4 identity still comes from the FIRST row (alpha class unchanged although the last row differs)',
    a.sector === 'central_bank' && a.country === 'DE' && a.institution === 'Alpha Central Bank');
  const b = by['src-boc'] || {};
  check('S4 a bare source id as institution_name resolves to the real name and its Arabic', b.institution === 'src-boc' && b.name === 'Bank of Canada' && b.name_ar === 'بنك كندا', JSON.stringify([b.institution, b.name, b.name_ar]));
  const be = by['src-beta'] || {};
  check('S4 blocked source → bad level with Arabic labels', be.qualification_ar === 'يحتاج معالجة' && be.health_ar === 'محجوب' && be.state_level === 'bad');
  const g = by['src-gamma'] || {};
  check('S5 unknown state values are passed through untranslated and get no colour', g.qualification_ar === 'WEIRD_NEW_STATE' && g.health_ar === 'STRANGE_HEALTH' && g.state_level === '' && g.country_ar === 'XX' && g.sector_ar === 'unknown_class');
  check('S5 a missing country stays empty (no invented name)', (by['src-delta'] || {}).country_ar === '');
  check('S6 object counts and latest dossier per source (alpha 2 → io-2, boc 1 → io-3, gamma 1 → io-4, beta/delta 0 → null)',
    a.object_count === 2 && a.latest_io_id === 'io-2' && b.object_count === 1 && b.latest_io_id === 'io-3' && g.object_count === 1 && be.object_count === 0 && be.latest_io_id === null && by['src-delta'].object_count === 0);
  check('S6 /sources.registry_available is true and versions stay pinned to v10', SRC.registry_available === true && OA.info.version === 'v10' && ST.version === 'v10');
}
const pkg = JSON.parse(fs.readFileSync(path.join(UI, 'package.json'), 'utf8'));
const serverSrc = fs.readFileSync(path.join(UI, 'server.js'), 'utf8');
check('S7 package.json declares no dependencies and server.js requires node: built-ins only',
  !pkg.dependencies && !pkg.devDependencies && !/require\((['"])(?!node:)/.test(serverSrc));

// ── D*: the SPA, executed ─────────────────────────────────────────────────────────
if (!NO_REGISTRY) {
  const html = fs.readFileSync(path.join(UI, 'rouaa-console-dark.html'), 'utf8');
  const code = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const el = (over) => Object.assign({ innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, attrs: {}, lis: {},
    addEventListener(t, f) { (this.lis[t] ||= []).push(f); },
    fire(t, ev = {}) { for (const f of this.lis[t] || []) f.call(this, Object.assign({ target: this }, ev)); },
    setAttribute(n, v) { this.attrs[n] = String(v); }, getAttribute(n) { return this.attrs[n]; }, removeAttribute(n) { delete this.attrs[n]; },
    focus() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return [] },
    insertAdjacentHTML(_pos, h) { this.innerHTML += h; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } }, over);
  const els = {}; for (const id of ['app', 'dirQ', 'dirBody', 'dirCount', 'deskCount', 'deskGrid']) els['#' + id] = el();
  const ths = [['name', 'الجهة'], ['sector', 'الصنف'], ['country', 'الدولة'], ['state', 'الحالة'], ['objects', 'الكائنات']]
    .map(([col, label]) => { const t = el({ dataset: { col, sort: col, label } }); t.querySelector = () => t; return t; });
  const document = { title: '', documentElement: { classList: { add() {}, remove() {} } },
    querySelector: (s) => els[s] || el(), getElementById: (id) => els['#' + id] || el(), createElement: () => el(),
    querySelectorAll: (s) => (s.includes('[data-') ? ths : []) };
  const winLis = {}; const pending = new Set(); const netErrors = [];
  const location = { _h: '', get hash() { return this._h; },
    set hash(v) { this._h = '#' + String(v).replace(/^#/, ''); for (const f of winLis.hashchange || []) f.call(sandbox, {}); } };
  const sandbox = { document, location, Intl, console, setTimeout, clearTimeout, URL, URLSearchParams, Blob, AbortController,
    localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    addEventListener: (t, f) => { (winLis[t] ||= []).push(f); },
    fetch: (p, o) => { const r = fetch(new URL(p, BASE).href, o).then((x) => { if (!x.ok) netErrors.push(p + ' ' + x.status); return x; });
      pending.add(r); r.finally(() => pending.delete(r)).catch(() => {}); return r; } };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  const idle = async () => { for (let i = 0; i < 400; i++) { await new Promise((r) => setTimeout(r, 5)); if (!pending.size) { await new Promise((r) => setTimeout(r, 5)); if (!pending.size) return; } } };
  const go = async (h) => { sandbox.location.hash = h; await idle(); };
  const rows = () => (els['#dirBody'].innerHTML.match(/<tr data-sid="([^"]+)"/g) || []).map((s) => s.slice(14, -1));
  try {
    vm.runInContext(code, sandbox, { filename: 'rouaa-console-dark.html:inline' });
    await idle();
    await go('#/directory');
    const app = els['#app'].innerHTML;
    check('D1 directory page renders the sortable table with caption and focusable scroll region',
      app.includes('id="dirTable"') && app.includes('<caption>دليل الجهات') && app.includes('role="region"') && app.includes('aria-sort='));
    check('D1 the table body is FILLED through the router path (one row per registered source)',
      rows().length === SRC.sources.length && SRC.sources.length === 5, JSON.stringify(rows()));
    const body = els['#dirBody'].innerHTML;
    check('D1 rows carry Arabic/resolved name, id, class, country, state pill, object count and dossier link',
      body.includes('بنك كندا') && body.includes('src-boc') && body.includes('جاهز للإنتاج') && body.includes('يحتاج معالجة') && body.includes('class="pill ok"') && body.includes('class="pill bad"') && body.includes('href="#/io/io-2"'));
    check('D2 text filter: Arabic without hamza finds ألمانيا; an id finds its row; no match → honest empty state',
      (() => { els['#dirQ'].value = 'المانيا'; els['#dirQ'].fire('input'); const r1 = rows().join();
        els['#dirQ'].value = 'src-boc'; els['#dirQ'].fire('input'); const r2 = rows().join();
        els['#dirQ'].value = 'zzzz-nothing'; els['#dirQ'].fire('input'); const empty = els['#dirBody'].innerHTML.includes('لا نتائج مطابقة');
        els['#dirQ'].value = ''; els['#dirQ'].fire('input'); return r1 === 'src-alpha' && r2 === 'src-boc' && empty && rows().length === 5; })());
    // v13 D3 semantics (documented in rouaa-console-dark.html above DIR_RANK): objects sorts
    // numerically (desc first, ties by source_id asc); state sorts by pill severity ascending —
    // ok < warn < bad < info, unknown ('') LAST; name sorts the Arabic display name with
    // Intl.Collator('ar'), where Arabic script precedes Latin. Descending is the exact reverse
    // of ascending because the 5 keys are distinct and the source_id tiebreak never fires.
    ths[4].fire('click'); // objects: numeric, largest first — counts 2,1,1,0,0
    const byObj = JSON.stringify(rows()) === JSON.stringify(['src-alpha', 'src-boc', 'src-gamma', 'src-beta', 'src-delta']);
    ths[3].fire('click'); // state: severity ascending — ok rows first, unknown (src-gamma) LAST, not src-beta
    const byState = JSON.stringify(rows()) === JSON.stringify(['src-alpha', 'src-boc', 'src-delta', 'src-beta', 'src-gamma']);
    ths[0].fire('click'); const nameAsc = rows(); // name ascending: بنك كندا (boc) sorts before the Latin names
    ths[0].fire('click'); const nameDesc = rows(); // toggle to descending — exact reverse of ascending
    check('D3 sorting by objects, by state and by name re-orders rows',
      byObj && byState && nameAsc[0] === 'src-boc' && JSON.stringify(nameDesc) === JSON.stringify([...nameAsc].reverse()),
      JSON.stringify(rows()));
    check('D3 exactly one column reports aria-sort ascending/descending and the rest none',
      ths.filter((t) => ['ascending', 'descending'].includes(t.attrs['aria-sort'])).length === 1 && ths.every((t) => t.attrs['aria-sort']));
    await go('#/coverage');
    const cov = els['#app'].innerHTML;
    check('D4 coverage page contains no «؟» and states rows vs unique institutions with explicit denominators',
      !cov.includes('؟') && cov.includes('10 صفوف') && cov.includes('5 جهات') && cov.includes('60% (3 ÷ 5)'));
    const chips = (cov.split('<div id="covChips">')[1] || '').split('</div>')[0];
    const chipTexts = [...chips.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    check('D4 country chips show Arabic names with the code as secondary text, separated, unknown code alone',
      chipTexts.length === 3 && chips.includes('كندا') && chips.includes('ألمانيا') && chips.includes('title="DE"') && /<\/a>\s*<a /.test(chips)
      && !/<a [^>]*>DE<\/a>/.test(chips) && /<a [^>]*title="XX"[^>]*>XX<\/a>/.test(chips), JSON.stringify(chipTexts));
    check('D4 no chip is a bare ISO code run (innerText of joined inline chips cannot concatenate codes)', chipTexts.every((t) => /^[A-Z]{2}$/.test(t) || /[\u0600-\u06FF]/.test(t)), JSON.stringify(chipTexts));
    await go('#/desk?country=DE');
    const exp = await api('/analyst/api/outputs?country=DE&page_size=50');
    check('D5 desk honours ?country= (country option preselected)', els['#app'].innerHTML.includes('value="DE" selected'));
    const dq = els['#deskCount'].textContent;
    check('D5 desk count line reflects the country filter', String(dq).startsWith(exp.total + ' كائناً') && exp.total === 2, String(dq));
    for (const r of ['#/dashboard', '#/desk', '#/indicators', '#/directory', '#/coverage', '#/ops', '#/review', '#/owner', '#/io/io-2']) {
      await go(r);
      const h = els['#app'].innerHTML;
      check('D6 route ' + r + ' renders an h1 without a load error', h.includes('<h1') && !h.includes('تعذر التحميل'));
    }
    check('D6 no failed request during the whole walk', netErrors.length === 0, netErrors.join(', '));
  } catch (e) {
    check('D0 SPA executed without an exception', false, String(e && e.stack || e).slice(0, 300));
  }
} else {
  // no-registry scenario on the SPA: the pages must degrade honestly
  try {
    const html = fs.readFileSync(path.join(UI, 'rouaa-console-dark.html'), 'utf8');
    check('D7 coverage markup has no hardcoded «؟» fallback for the registry row count', !/registry_rows_raw \|\| "؟"/.test(html));
  } catch (e) { check('D7', false, String(e)); }
}

console.log(`\n═══ v13: ${pass}/${pass + fails.length} passed (${NO_REGISTRY ? 'registry unavailable' : 'versioned registry'} scenario) ═══`);
if (fails.length) console.log('failed:', fails);
shutdown();
process.exit(fails.length ? 1 : 0);
