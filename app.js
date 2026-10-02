/* ==========================================================================
   ROUAA INSTITUTIONAL INTELLIGENCE — INTERFACE V3.1 (presentation layer only)
   Black Institutional Terminal · Repository Production Snapshot · NOT LIVE
   ---------------------------------------------------------------------------
   V2 MANDATE: better consumption of existing truth — not creation of new truth.
   - Data is loaded verbatim from ./data/*.json (read-only Core outputs).
   - No invented data: missing fields render as "Not available".
   - Semantic titles do not exist in Core -> identity = INSTITUTION + TYPE metadata.
   - No interpretation layer exists in Core -> CONTEXT states so explicitly.
   - Fact UNIT / PERIOD are not produced by Core -> columns reserved, marked "—".
   V3.1 (design-authority round): reader as intelligence brief, one provenance
   spine language (reader PROVENANCE / EVIDENCE view / TRACE view), serif
   quotation voice for verbatim evidence + reader title, honest empty states,
   document-grade reader ending. Data expressions unchanged and verbatim.
   ========================================================================== */

'use strict';

/* ============================================================ constants */

const PER_PAGE_OPTS = [25, 50, 100];
const FRESH_DEF  = 'Publication date attributed by Core inside the frozen fresh window';
const HIST_DEF   = 'Publication date attributed by Core, outside the fresh window';
const UNDAT_DEF  = 'No publication date attributed by Core (undated)';

const D = { meta: null, intelligence: [], documents: [], sources: [], production: null };
const IX = { docs: {}, srcs: {}, ios: {} };   // id -> record
const FACTS = [];                              // flat fact index built from IO chains
const SRC_STATS = {};                          // source_id -> derived presentation stats

/* list-view state (filters / sort / pagination) */
const LS = {
  intel:   { q: '', mode: 'feed', fresh: null, jur: null, sector: null, type: null, lang: null, inst: '',
             sort: 'rank', dir: 'asc', page: 1, per: 50 },
  docs:    { q: '', fresh: null, jur: null, layer: null, prod: null,
             sort: 'date', dir: 'desc', page: 1, per: 25 },
  facts:   { q: '', metric: null, tstat: null, sector: null, inst: '', src: null,
             sort: 'doc', dir: 'asc', page: 1, per: 25 },
  sources: { q: '', jur: null, auth: null, sector: null, prod: null,
             sort: 'ios', dir: 'desc', page: 1, per: 25 },
};

/* ============================================================ utilities */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
function na(v) { return (v == null || v === '') ? '<span class="na">Not available</span>' : esc(v); }
function nDash() { return '<span class="na" title="Field not yet produced by ROUAA Core — column reserved for future schema">—</span>'; }
function num(n) { return (n == null) ? '<span class="na">—</span>' : String(n); }
function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

function cleanUrl(u) {
  if (!u) return '';
  try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname); }
  catch (e) { return String(u); }
}
function ioDateKey(io) {
  return io.publication_time || io.best_document_date || null;
}
function statusRank(s) { return s === 'FRESH' ? 0 : (s === 'HISTORICAL' ? 1 : 2); }

/* status — quiet institutional indicator: colored dot + label, no pill,
   no glow, no border (V2.2 order §8) ------------------------------------ */
function bStatus(st) {
  const map = {
    FRESH: ['si-fresh', 'FRESH', FRESH_DEF],
    HISTORICAL: ['si-historical', 'HISTORICAL', HIST_DEF],
    POST_WINDOW: ['si-postwindow', 'POST-WINDOW', 'Document dated after the frozen fresh window'],
    DATE_UNKNOWN: ['si-dateunknown', 'DATE UNKNOWN', 'No date attributed by Core'],
    UNDATED: ['si-undated', 'UNDATED', UNDAT_DEF]
  };
  const m = map[st] || map.UNDATED;
  return '<span class="si ' + m[0] + '" title="' + esc(m[2]) + '">' + m[1] + '</span>';
}
function bOfficial(src) {
  if (!src) return '';
  return '<span class="badge b-trust" title="Registered official source — authority: ' +
    esc(src.authority_type) + ' (' + esc(src.authority_level) + '), domain ' + esc(src.official_domain) +
    '">OFFICIAL SOURCE</span>';
}
function bEvidence(n) {
  if (!n) return '<span class="badge b-undated">NO EVIDENCE</span>';
  return '<span class="badge b-trust" title="' + n + ' fact(s) carry verbatim evidence excerpts bound to a stored document">EVIDENCE LINKED</span>';
}
function bTraceable(ok) {
  if (!ok) return '<span class="badge b-undated">TRACE INCOMPLETE</span>';
  return '<span class="badge b-trust" title="Fact, evidence, document and official source all resolve inside this snapshot">TRACEABLE</span>';
}

/* io helpers ---------------------------------------------------------- */
function ioTraceable(io) {
  if (!io.chain || !io.chain.length) return false;
  return io.chain.every(c => c.document_id && c.source_id && c.canonical_url && IX.docs[c.document_id] && IX.srcs[c.source_id]);
}
function ioDateLine(io) {
  if (io.date_status === 'FRESH' || io.date_status === 'HISTORICAL') {
    const d = io.publication_time ? fmtDateTime(io.publication_time) : fmtDate(io.best_document_date);
    const basis = io.publication_provenance || io.publication_basis || 'attributed';
    return d + ' <span class="dim">· basis: ' + esc(basis) + '</span>';
  }
  return '<span class="dim">No publication date attributed by Core</span>';
}
function ioSortDate(io) {
  const k = ioDateKey(io);
  if (!k) return '0000-00-00';
  return String(k).slice(0, 10);
}

/* ============================================================ PRODUCTION OBSERVATION API client
   FRONTEND LIVE OBSERVATORY INTEGRATION V1 (executive order §4).
   The ONLY layer permitted to read /production/* — every other component
   consumes this client. Contract source of truth (frozen):
   ROUAA Core download/POCA1/observation_api_contract.json —
   HTTP/1.1 GET only, JSON UTF-8, read-only, polling-oriented V1.
   No component may call a /production/* endpoint directly. */

const OBS_DEFAULT_BASE = 'http://127.0.0.1:8765';

function obsResolveBase() {
  /* resolution order: ?api= query param > persisted operator setting > default */
  const qp = new URLSearchParams(location.search).get('api');
  if (qp !== null) return qp.trim().replace(/\/+$/, '');
  try {
    const saved = localStorage.getItem('rouaa.obs.api');
    if (saved !== null && saved.trim() !== '') return saved.trim().replace(/\/+$/, '');
  } catch (e) { /* storage unavailable — fall through to default */ }
  return OBS_DEFAULT_BASE;
}

function obsQ(q) {
  if (!q) return '';
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
}

const OBS = {
  base: obsResolveBase(),
  /* live connection state — rendered verbatim, never fabricated */
  state: { phase: 'IDLE', http: null, status_code: null, detail: null, fetched_at: null },
  timer: null,
  pollMs: 30000,

  /* READ-ONLY INVARIANT (order §9): the only HTTP verb this client can
     issue is GET. Starting, stopping or mutating a run is impossible here. */
  async get(path) {
    let r;
    try {
      r = await fetch(this.base + path, { method: 'GET', headers: { 'Accept': 'application/json' } });
    } catch (e) {
      this.state = { phase: 'UNREACHABLE', http: null, status_code: null, detail: 'network: ' + e.message, fetched_at: new Date() };
      const err = new Error('OBSERVATION API UNREACHABLE');
      err.obs = this.state; throw err;
    }
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    this.state = {
      phase: body ? 'LIVE' : 'ERROR',
      http: r.status,
      status_code: (body && body.status_code) ? body.status_code : null,
      detail: (body && body.status_code) ? body.status_code : ('HTTP ' + r.status),
      fetched_at: new Date(),
    };
    /* contract-expressed errors (error_contract: e.g. 404 RUN_NOT_FOUND with a
       status_code body) are RETURNED, not thrown — views render the served
       status_code honestly. Non-JSON failures throw. */
    if (!r.ok || !body) {
      if (body && body.status_code) return body;
      const err = new Error('OBSERVATION API HTTP ' + r.status);
      err.obs = this.state; err.body = body; throw err;
    }
    return body;
  },

  /* one method per contract endpoint — exactly the ten frozen surfaces */
  status()  { return this.get('/production/status'); },
  metrics() { return this.get('/production/metrics'); },
  runs()    { return this.get('/production/runs'); },
  run(id)   { return this.get('/production/runs/' + encodeURIComponent(id)); },
  sources(id, q)    { return this.get('/production/runs/' + encodeURIComponent(id) + '/sources' + obsQ(q)); },
  documents(id, q)  { return this.get('/production/runs/' + encodeURIComponent(id) + '/documents' + obsQ(q)); },
  facts(id, q)      { return this.get('/production/runs/' + encodeURIComponent(id) + '/facts' + obsQ(q)); },
  events(id, q)     { return this.get('/production/runs/' + encodeURIComponent(id) + '/events' + obsQ(q)); },
  intelligence(id, bySource) { return this.get('/production/runs/' + encodeURIComponent(id) + '/intelligence' + (bySource ? '?by_source=true' : '')); },
  failures(id, q)   { return this.get('/production/runs/' + encodeURIComponent(id) + '/failures' + obsQ(q)); },

  /* one poll timer for the whole observatory surface (contract: polling V1) */
  armPoll(fn) { this.disarmPoll(); this.timer = setInterval(fn, this.pollMs); },
  disarmPoll() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
};

/* ============================================================ boot */

async function boot() {
  const el = document.getElementById('app');
  el.innerHTML = '<div class="loading">Loading repository production snapshot…</div>';
  try {
    const [meta, intelligence, documents, sources, production] = await Promise.all([
      fetch('data/meta.json').then(r => r.json()),
      fetch('data/intelligence.json').then(r => r.json()),
      fetch('data/documents.json').then(r => r.json()),
      fetch('data/sources.json').then(r => r.json()),
      fetch('data/production.json').then(r => r.json()),
    ]);
    D.meta = meta; D.intelligence = intelligence; D.documents = documents;
    D.sources = sources; D.production = production;

    documents.forEach(d => { IX.docs[d.document_id] = d; });
    sources.forEach(s => { IX.srcs[s.source_id] = s; });
    intelligence.forEach(io => { IX.ios[io.io_id] = io; });

    buildFactIndex();
    buildSourceStats();
    renderSysline();
    initGlobalSearch();
    window.addEventListener('hashchange', route);
    route();
  } catch (e) {
    el.innerHTML = '<div class="note"><b>Failed to load snapshot data.</b> ' + esc(e.message) + '</div>';
  }
}

/* flat fact index from IO chains (verbatim; 1:1 with Core chain bindings) */
function buildFactIndex() {
  D.intelligence.forEach(io => {
    (io.chain || []).forEach(c => {
      FACTS.push({
        fact_id: c.fact_id, metric: c.metric, value: c.value, raw_value: c.raw_value,
        excerpt: c.excerpt, evidence_id: c.evidence_id, evidence_location: c.evidence_location,
        document_id: c.document_id, canonical_url: c.canonical_url, source_id: c.source_id,
        io_id: io.io_id, institution: io.institution_name, jurisdiction: io.jurisdiction,
        sector_label: io.sector_label, date_status: io.date_status,
        doc_date: (IX.docs[c.document_id] || {}).best_iso || null,
        doc_fresh: (IX.docs[c.document_id] || {}).fresh_status || null,
        _lc: lower([c.metric, c.value, c.raw_value, io.institution_name, c.document_id, c.source_id, io.sector_label, io.jurisdiction].join(' ')),
      });
    });
  });
}

/* derived presentation stats per source (arithmetic on real committed data) */
function buildSourceStats() {
  D.sources.forEach(s => { SRC_STATS[s.source_id] = { chain_facts: 0, evidence_facts: 0, docs_listed: 0, undated_vio: 0 }; });
  FACTS.forEach(f => {
    const st = SRC_STATS[f.source_id]; if (!st) return;
    st.chain_facts += 1;
    if (f.excerpt && f.evidence_id) st.evidence_facts += 1;
  });
  D.documents.forEach(d => { const st = SRC_STATS[d.source_id]; if (st) st.docs_listed += 1; });
  D.intelligence.forEach(io => {
    const st = SRC_STATS[io.source_id]; if (!st) return;
    if (io.date_status === 'UNDATED') st.undated_vio += 1;
  });
}

/* ============================================================ chrome */

function renderSysline() {
  const m = D.meta;
  document.getElementById('sysline').innerHTML =
    '<span class="dot">&#9632;</span> <b>' + esc(m.snapshot_kind) + '</b>' +
    ' &nbsp;·&nbsp; NOT A LIVE FEED' +
    ' &nbsp;·&nbsp; Core commit <b>' + esc(m.production_commit.slice(0, 10)) + '</b> on ' + esc(m.production_branch) +
    ' &nbsp;·&nbsp; fresh window ' + esc(m.fresh_window.start) + ' &rarr; ' + esc(m.fresh_window.end) +
    ' &nbsp;·&nbsp; snapshot ' + esc(fmtDate(m.snapshot_date)) +
    ' &nbsp;·&nbsp; interface V3.1 · presentation layer only';
  document.getElementById('snapshot-chip').innerHTML = 'SNAPSHOT · ' + esc(m.wave) + ' · ' + esc(m.snapshot_date);
}

function setNav(key) {
  document.querySelectorAll('#topnav a').forEach(a => a.classList.toggle('on', a.dataset.key === key));
}

/* ============================================================ global search */

const GS = { timer: null, items: [], active: -1 };

function initGlobalSearch() {
  const input = document.getElementById('gsearch-input');
  const drop = document.getElementById('gsearch-drop');
  input.addEventListener('input', () => {
    clearTimeout(GS.timer);
    GS.timer = setTimeout(() => runGlobalSearch(input.value), 130);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) runGlobalSearch(input.value); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!GS.items.length) return;
      GS.active += (e.key === 'ArrowDown' ? 1 : -1);
      if (GS.active < 0) GS.active = GS.items.length - 1;
      if (GS.active >= GS.items.length) GS.active = 0;
      renderGsDrop(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (GS.active >= 0 && GS.items[GS.active]) { location.hash = GS.items[GS.active].href; closeGs(); input.blur(); }
      else if (input.value.trim()) { location.hash = '#/search?q=' + encodeURIComponent(input.value.trim()); closeGs(); input.blur(); }
    } else if (e.key === 'Escape') { closeGs(); }
  });
  document.addEventListener('click', e => {
    if (!document.getElementById('gsearch').contains(e.target)) closeGs();
  });
}
function closeGs() {
  document.getElementById('gsearch-drop').hidden = true;
  GS.active = -1;
}
function gsMatch(q) {
  const t = lower(q).trim();
  if (!t) return { intel: [], docs: [], facts: [], srcs: [] };
  const has = s => lower(s).indexOf(t) !== -1;
  const intel = D.intelligence.filter(io => has(io.institution_name + ' ' + io.event_type_label + ' ' + io.jurisdiction + ' ' + io.sector_label + ' ' + io.headline + ' ' + io.io_id)).slice(0, 4);
  const docs = D.documents.filter(d => has(d.canonical_url + ' ' + d.document_id + ' ' + ((IX.srcs[d.source_id] || {}).institution_name || '') + ' ' + d.source_id)).slice(0, 4);
  const facts = FACTS.filter(f => f._lc.indexOf(t) !== -1).slice(0, 4);
  const srcs = D.sources.filter(s => has(s.institution_name + ' ' + s.official_domain + ' ' + s.jurisdiction + ' ' + s.source_id + ' ' + s.sector_label)).slice(0, 4);
  return { intel, docs, facts, srcs };
}
function runGlobalSearch(q) {
  const r = gsMatch(q);
  GS.items = [];
  const drop = document.getElementById('gsearch-drop');
  if (!q.trim()) { drop.hidden = true; return; }
  const total = r.intel.length + r.docs.length + r.facts.length + r.srcs.length;
  if (!total) {
    drop.innerHTML = '<div class="gs-empty">No objects in this snapshot match &ldquo;' + esc(q) + '&rdquo;.</div>';
    drop.hidden = false; return;
  }
  let html = '';
  const cat = (label, arr, render) => {
    if (!arr.length) return;
    html += '<div class="gs-cat">' + label + ' <b>' + arr.length + ' shown</b></div>';
    arr.forEach(it => { const o = render(it); GS.items.push({ href: o.href }); html += o.html; });
  };
  cat('INTELLIGENCE', r.intel, io => ({
    href: '#/intelligence/' + io.io_id,
    html: '<a class="gs-row" href="#/intelligence/' + io.io_id + '"><span class="gs-t ellip">' + esc(io.institution_name) + '</span><span class="gs-m">' + esc(io.event_type_label) + ' · ' + io.n_facts + ' facts</span></a>',
  }));
  cat('DOCUMENTS', r.docs, d => ({
    href: '#/documents/' + d.document_id,
    html: '<a class="gs-row" href="#/documents/' + d.document_id + '"><span class="gs-t ellip">' + esc(cleanUrl(d.canonical_url)) + '</span><span class="gs-m">' + esc((IX.srcs[d.source_id] || {}).institution_name || d.source_id) + '</span></a>',
  }));
  cat('FACTS', r.facts, f => ({
    href: '#/evidence/' + f.io_id + '/' + f.fact_id,
    html: '<a class="gs-row" href="#/evidence/' + f.io_id + '/' + f.fact_id + '"><span class="gs-t ellip">' + esc(f.value) + ' — ' + esc(String(f.raw_value).slice(0, 70)) + '</span><span class="gs-m">' + esc(f.metric) + '</span></a>',
  }));
  cat('SOURCES', r.srcs, s => ({
    href: '#/sources/' + s.source_id,
    html: '<a class="gs-row" href="#/sources/' + s.source_id + '"><span class="gs-t ellip">' + esc(s.institution_name) + '</span><span class="gs-m">' + esc(s.jurisdiction) + '</span></a>',
  }));
  html += '<a class="gs-more" href="#/search?q=' + encodeURIComponent(q.trim()) + '">View all results for &ldquo;' + esc(q) + '&rdquo; &rarr;</a>';
  drop.innerHTML = html;
  drop.hidden = false;
}
function renderGsDrop(keepOpen) {
  const drop = document.getElementById('gsearch-drop');
  drop.querySelectorAll('.gs-row').forEach((el, i) => el.classList.toggle('active', i === GS.active));
  if (keepOpen) drop.hidden = false;
}

/* ============================================================ router */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const qi = h.indexOf('?');
  const path = qi === -1 ? h : h.slice(0, qi);
  const query = {};
  if (qi !== -1) h.slice(qi + 1).split('&').forEach(p => {
    const kv = p.split('='); if (kv[0]) query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  });
  const seg = path.split('/').filter(Boolean);
  return { seg, query };
}

function route() {
  const { seg, query } = parseHash();
  const app = document.getElementById('app');
  document.title = 'ROUAA Institutional Intelligence — Repository Production Snapshot (LSE-V4)';
  window.scrollTo(0, 0);
  closeGs();
  OBS.disarmPoll();   /* observatory polling never outlives its route */

  if (!seg.length) { setNav('overview'); return viewOverview(app); }
  switch (seg[0]) {
    case 'intelligence':
      if (seg[1]) { setNav('intelligence'); return viewIoDetail(app, seg[1]); }
      setNav('intelligence'); return viewIntelligence(app, query);
    case 'evidence':
      setNav('intelligence'); return viewEvidence(app, seg[1], seg[2]);
    case 'trace':
      setNav('intelligence'); return viewTrace(app, seg[1]);
    case 'documents':
      if (seg[1]) { setNav('documents'); return viewDocDetail(app, seg[1]); }
      setNav('documents'); return viewDocuments(app);
    case 'facts':
      setNav('facts'); return viewFacts(app, query);
    case 'sources':
      if (seg[1]) { setNav('sources'); return viewSourceDetail(app, seg[1]); }
      setNav('sources'); return viewSources(app);
    case 'production':
      setNav('production'); return viewProduction(app);
    case 'observatory':
      document.title = 'ROUAA Observatory — Live Production Observation (ROUAA Core)';
      setNav('observatory');
      if (seg[1] === 'runs' && seg[2]) {
        const drill = seg[3];
        if (drill && ['sources', 'documents', 'facts', 'events', 'intelligence', 'failures'].indexOf(drill) !== -1) {
          return viewObsLedger(app, decodeURIComponent(seg[2]), drill, query);
        }
        return viewObsRun(app, decodeURIComponent(seg[2]));
      }
      return viewObservatory(app);
    case 'search':
      setNav(''); return viewSearch(app, query.q || '');
    default:
      setNav('overview'); return viewOverview(app);
  }
}

/* ============================================================ OVERVIEW */

function viewOverview(app) {
  const ios = D.intelligence;
  const fresh = ios.filter(x => x.date_status === 'FRESH');
  const hist = ios.filter(x => x.date_status === 'HISTORICAL');
  const undat = ios.filter(x => x.date_status === 'UNDATED');
  const chainFacts = FACTS.length;
  const productive = D.sources.filter(s => (s.unique_vio || 0) > 0).length;
  const sectors = {};
  ios.forEach(x => { sectors[x.sector_label] = (sectors[x.sector_label] || 0) + 1; });
  const topSector = Object.keys(sectors).sort((a, b) => sectors[b] - sectors[a])[0];
  const latest = fresh.slice().sort((a, b) => ioSortDate(b).localeCompare(ioSortDate(a)))[0];

  /* V3.0-A.1: the overview opens as an institutional arrival — a single
     statement of what the environment holds (same committed counts as
     always), then the standing brief, then the Intelligence Stream.
     Data expressions are byte-identical to the previous template. */
  let html = '' +
    '<div class="arrive">' +
      '<h1 class="arrive-title">' + D.meta.counts.intelligence_objects + ' intelligence objects' +
      ' <span class="arrive-sub">&middot; ' + D.meta.counts.documents + ' documents &middot; ' +
        D.meta.counts.facts.toLocaleString('en-GB') + ' facts &middot; ' + D.meta.counts.sources + ' registered sources</span></h1>' +
    '</div>' +

    '<div class="ov-answers">' +
      '<div class="ov-answer"><div class="ov-q">WHAT HAPPENED</div><div class="ov-a">' +
        '<b>' + fresh.length + ' intelligence objects</b> carry a publication date inside the fresh window (' +
        esc(D.meta.fresh_window.start) + ' &rarr; ' + esc(D.meta.fresh_window.end) + ').' +
        (latest ? ' Most recent: <span class="lnk" data-go="#/intelligence/' + latest.io_id + '">' + esc(latest.institution_name) +
        '</span> · ' + fmtDate(ioDateKey(latest)) + '.' : '') +
      '</div></div>' +
      '<div class="ov-answer"><div class="ov-q">WHAT IS IMPORTANT</div><div class="ov-a">' +
        'Production concentrates in <b>' + esc(topSector) + '</b> (' + sectors[topSector] + ' objects). ' +
        '<b>' + productive + ' of ' + D.sources.length + '</b> registered sources produced verified intelligence this wave; ' +
        'the remainder are registered but not yet productive.' +
      '</div></div>' +
      '<div class="ov-answer"><div class="ov-q">WHAT CAN I VERIFY</div><div class="ov-a">' +
        'Every one of the <b>' + ios.length + '</b> intelligence objects resolves to an official source through ' +
        '<b>' + chainFacts.toLocaleString('en-GB') + ' evidence-linked facts</b> and ' + D.meta.counts.documents + ' acquired documents. ' +
        '<span class="lnk" data-go="#/intelligence">Open intelligence &rarr;</span>' +
      '</div></div>' +
    '</div>' +

    '<div class="view-head"><div class="view-title">INTELLIGENCE FEED</div>' +
      '<div class="view-count">ordered FRESH &rarr; HISTORICAL &rarr; UNDATED — nothing hidden</div>' +
      '<div class="view-actions"><a class="feed-link" href="#/intelligence">TABLE VIEW &rarr;</a></div>' +
    '</div>';

  const group = (name, cls, def, arr) => {
    if (!arr.length) return;
    html += '<div class="feed-group"><div class="feed-ghead"><span class="gname ' + cls + '">' + name + '</span>' +
      '<span class="gcount">' + arr.length + '</span><span class="gunit">object' + (arr.length > 1 ? 's' : '') + '</span>' +
      '<span class="gdef">' + esc(def) + '</span></div>';
    arr.forEach(io => { html += feedRow(io); });
    html += '</div>';
  };
  const byDateDesc = (a, b) => ioSortDate(b).localeCompare(ioSortDate(a));
  group('FRESH', 'c-fresh', FRESH_DEF, fresh.slice().sort(byDateDesc));
  group('HISTORICAL', 'c-historical', HIST_DEF, hist.slice().sort(byDateDesc));
  group('UNDATED', 'c-undated', UNDAT_DEF, undat.slice().sort((a, b) => a.institution_name.localeCompare(b.institution_name)));

  app.innerHTML = html;
  bindGo(app);
}

function feedRow(io) {
  const d = io.date_status === 'UNDATED' ? '' : ioDateKey(io);
  return '<div class="feed-row" data-go="#/intelligence/' + io.io_id + '">' +
    '<div class="f-left">' + bStatus(io.date_status) +
      '<span class="f-inst ellip">' + esc(io.institution_name) + '</span></div>' +
    '<div class="f-right">' +
      '<span class="f-meta">' + esc(io.jurisdiction) + ' · ' + esc(io.sector_label) + '</span>' +
      (d ? '<span class="f-date">' + fmtDate(d) + '</span>' : '<span class="f-date dim">no date</span>') +
      '<span class="f-facts"><span class="num">' + io.n_facts + '</span> fact' + (io.n_facts === 1 ? '' : 's') + '</span>' +
      '<span class="f-open">OPEN &rarr;</span></div>' +
    '</div>';
}

/* generic delegated navigation for data-go elements */
function bindGo(root) {
  root.querySelectorAll('[data-go]').forEach(el => {
    el.addEventListener('click', () => { location.hash = el.dataset.go; });
  });
}

/* ============================================================ INTELLIGENCE (list) */

function intelFiltered() {
  const f = LS.intel;
  const q = lower(f.q.trim());
  return D.intelligence.filter(io => {
    if (f.fresh && io.date_status !== f.fresh) return false;
    if (f.jur && io.jurisdiction !== f.jur) return false;
    if (f.sector && io.sector_label !== f.sector) return false;
    if (f.type && io.event_type_label !== f.type) return false;
    if (f.lang && io.language !== f.lang) return false;
    if (f.inst.trim() && lower(io.institution_name).indexOf(lower(f.inst.trim())) === -1) return false;
    if (q && lower(io.institution_name + ' ' + io.event_type_label + ' ' + io.jurisdiction + ' ' + io.sector_label + ' ' + io.headline + ' ' + io.io_id).indexOf(q) === -1) return false;
    return true;
  });
}
function intelSort(arr) {
  const f = LS.intel;
  const dir = f.dir === 'asc' ? 1 : -1;
  const by = {
    rank: (a, b) => (statusRank(a.date_status) - statusRank(b.date_status)) || ioSortDate(b).localeCompare(ioSortDate(a)),
    inst: (a, b) => a.institution_name.localeCompare(b.institution_name) * dir,
    type: (a, b) => a.event_type_label.localeCompare(b.event_type_label) * dir,
    date: (a, b) => ioSortDate(a).localeCompare(ioSortDate(b)) * dir,
    facts: (a, b) => ((a.n_facts || 0) - (b.n_facts || 0)) * dir,
    evi: (a, b) => ((a.chain || []).length - (b.chain || []).length) * dir,
    doc: (a, b) => String((a.chain[0] || {}).document_id || '').localeCompare(String((b.chain[0] || {}).document_id || '')) * dir,
  }[f.sort] || null;
  return by ? arr.slice().sort(by) : arr.slice();
}

function viewIntelligence(app, query) {
  /* deep links are deterministic: reset list filters, then apply the query param */
  if (query.inst || query.src) {
    Object.assign(LS.intel, { q: '', fresh: null, jur: null, sector: null, type: null, lang: null, inst: '', page: 1 });
    if (query.inst) LS.intel.inst = query.inst;
    if (query.src) { const s = IX.srcs[query.src]; if (s) LS.intel.inst = s.institution_name; }
  }
  LS.intel.page = 1;
  renderIntelligence(app);
}

function renderIntelligence(app) {
  const f = LS.intel;
  const all = intelFiltered();
  const sorted = intelSort(all);

  const jurisdictions = uniq(D.intelligence.map(x => x.jurisdiction));
  const sectors = uniq(D.intelligence.map(x => x.sector_label));
  const types = uniq(D.intelligence.map(x => x.event_type_label));
  const langs = uniq(D.intelligence.map(x => x.language));

  let html = '' +
    '<div class="view-head">' +
      '<div class="view-title">INTELLIGENCE</div>' +
      '<div class="view-count">' + all.length + ' of ' + D.intelligence.length + ' intelligence objects</div>' +
      '<div class="view-actions">' +
        '<button class="btn' + (f.mode === 'feed' ? ' on' : '') + '" id="m-feed">FEED</button>' +
        '<button class="btn' + (f.mode === 'table' ? ' on' : '') + '" id="m-table">TABLE</button>' +
      '</div>' +
    '</div>' +
    '<div class="cols"><div class="col-main" id="intel-main"></div>' +
    '<div class="col-side"><div class="panel filter-panel"><div class="panel-head"><span class="panel-label">FILTERS</span>' +
    '<span class="panel-meta">' + D.intelligence.length + ' total</span></div><div class="panel-body" id="intel-filters"></div></div></div></div>';

  app.innerHTML = html;
  renderIntelFilters();
  renderIntelMain(sorted);
  document.getElementById('m-feed').onclick = () => { f.mode = 'feed'; renderIntelligence(app); };
  document.getElementById('m-table').onclick = () => { f.mode = 'table'; renderIntelligence(app); };
}

function renderIntelFilters() {
  const f = LS.intel;
  const el = document.getElementById('intel-filters');
  const jurisdictions = uniq(D.intelligence.map(x => x.jurisdiction));
  const sectors = uniq(D.intelligence.map(x => x.sector_label));
  const types = uniq(D.intelligence.map(x => x.event_type_label));
  const langs = uniq(D.intelligence.map(x => x.language));

  /* V3.1 fix: chips are wrapped in .opts (flex-wrap) — the CSS expected it;
     bare inline chips formed one unbreakable line that overflowed the rail */
  const opts = (items, cur, set) => '<div class="opts">' + items.map(v =>
    '<span class="fopt' + (cur === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>';

  el.innerHTML =
    fg('Search', '<input type="text" id="fi-q" placeholder="institution, type, id..." value="' + esc(f.q) + '">') +
    fg('Institution', '<input type="text" id="fi-inst" placeholder="contains..." value="' + esc(f.inst) + '">') +
    fg('Freshness', opts(['FRESH', 'HISTORICAL', 'UNDATED'], f.fresh, 'fresh')) +
    fg('Jurisdiction', opts(jurisdictions, f.jur, 'jur')) +
    fg('Sector', opts(sectors, f.sector, 'sector')) +
    fg('Type', opts(types, f.type, 'type')) +
    fg('Language', opts(langs, f.lang, 'lang')) +
    '<div class="fgroup"><button class="btn sm" id="fi-clear">CLEAR ALL FILTERS</button></div>';

  const qEl = document.getElementById('fi-q');
  qEl.oninput = () => { f.q = qEl.value; f.page = 1; refreshIntel(); };
  const iEl = document.getElementById('fi-inst');
  iEl.oninput = () => { f.inst = iEl.value; f.page = 1; refreshIntel(); };
  el.querySelectorAll('.fopt').forEach(o => o.onclick = () => {
    const v = o.dataset.f;
    f.page = 1;
    if (['FRESH', 'HISTORICAL', 'UNDATED'].includes(v)) f.fresh = (f.fresh === v ? null : v);
    else if (jurisdictions.includes(v)) f.jur = (f.jur === v ? null : v);
    else if (sectors.includes(v)) f.sector = (f.sector === v ? null : v);
    else if (types.includes(v)) f.type = (f.type === v ? null : v);
    else if (langs.includes(v)) f.lang = (f.lang === v ? null : v);
    renderIntelFilters(); refreshIntel();
  });
  document.getElementById('fi-clear').onclick = () => {
    Object.assign(LS.intel, { q: '', fresh: null, jur: null, sector: null, type: null, lang: null, inst: '', page: 1 });
    renderIntelligence(document.getElementById('app'));
  };
}
function fg(k, body) { return '<div class="fgroup"><div class="fgroup-k">' + k + '</div>' + body + '</div>'; }
function uniq(arr) { return Array.from(new Set(arr.filter(v => v != null && v !== ''))).sort(); }

function refreshIntel() {
  const all = intelFiltered();
  const sorted = intelSort(all);
  renderIntelMain(sorted);
  const c = document.querySelector('.view-count');
  if (c) c.textContent = all.length + ' of ' + D.intelligence.length + ' intelligence objects';
}

function renderIntelMain(sorted) {
  const f = LS.intel;
  const main = document.getElementById('intel-main');
  const per = f.mode === 'table' ? f.per : 50;
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  if (f.page > pages) f.page = pages;
  const slice = sorted.slice((f.page - 1) * per, f.page * per);

  let html = '';
  if (f.mode === 'feed') {
    html += '<div class="note" style="margin-bottom:12px"><b>Identity note.</b> Core does not yet produce semantic titles. ' +
      'Each object below is identified by its real committed metadata: institution and event type. ' +
      'FRESH &rarr; HISTORICAL &rarr; UNDATED; no temporal class is hidden.</div>';
    const groups = [['FRESH', 'c-fresh', FRESH_DEF], ['HISTORICAL', 'c-historical', HIST_DEF], ['UNDATED', 'c-undated', UNDAT_DEF]];
    groups.forEach(([name, cls, def]) => {
      const arr = slice.filter(x => x.date_status === name);
      if (!arr.length) return;
      html += '<div class="feed-group"><div class="feed-ghead"><span class="gname ' + cls + '">' + name + '</span>' +
        '<span class="gcount">' + arr.length + '</span><span class="gunit">shown</span><span class="gdef">' + esc(def) + '</span></div>';
      arr.forEach(io => { html += feedRow(io); });
      html += '</div>';
    });
    if (!slice.length) html += emptyRegistry('intelligence object');
    html += pager(sorted.length, f.page, per, pages, 'intel');
  } else {
    const th = (key, label, cls) =>
      '<th class="sortable ' + (cls || '') + '" data-sk="' + key + '">' + label +
      (f.sort === key ? '<span class="arr">' + (f.dir === 'asc' ? '&#9650;' : '&#9660;') + '</span>' : '') + '</th>';
    html += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      th('rank', 'STATUS') + th('inst', 'INSTITUTION') + th('type', 'TYPE') + th('date', 'DATE') +
      th('facts', 'FACTS', 'num-col') + th('evi', 'EVIDENCE', 'num-col') + th('doc', 'DOCUMENT') +
      '</tr></thead><tbody>';
    slice.forEach(io => {
      const doc = (io.chain[0] || {}).document_id;
      html += '<tr class="rowlink" data-go="#/intelligence/' + io.io_id + '">' +
        '<td>' + bStatus(io.date_status) + '</td>' +
        '<td class="t-strong ellip" title="' + esc(io.institution_name) + '">' + esc(io.institution_name) + '</td>' +
        '<td>' + esc(io.event_type_label) + '</td>' +
        '<td class="mono">' + (io.date_status === 'UNDATED' ? '<span class="dim">—</span>' : esc(ioSortDate(io))) + '</td>' +
        '<td class="num-col"><span class="num' + (io.n_facts >= 20 ? ' hot' : '') + '">' + io.n_facts + '</span></td>' +
        '<td class="num-col"><span class="num">' + (io.chain || []).length + '</span></td>' +
        '<td class="mono dim">' + (doc ? esc(doc.slice(0, 14)) + '…' : '<span class="dim">—</span>') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    if (!slice.length) html += emptyRegistry('intelligence object');
    html += '<div class="note" style="margin-top:10px"><b>Sorting.</b> Click a column header to sort. Default order: temporal class, then most recent date. ' +
      'Undated objects sort last under DATE.</div>';
    html += pager(sorted.length, f.page, per, pages, 'intel');
  }
  main.innerHTML = html;
  bindGo(main);
  wirePager('intel', () => refreshIntel());
  main.querySelectorAll('th.sortable').forEach(t => t.onclick = () => {
    const k = t.dataset.sk;
    if (LS.intel.sort === k) LS.intel.dir = (LS.intel.dir === 'asc' ? 'desc' : 'asc');
    else { LS.intel.sort = k; LS.intel.dir = (k === 'rank' || k === 'inst' || k === 'type' || k === 'doc') ? 'asc' : 'desc'; }
    refreshIntel();
  });
}

function pager(total, page, per, pages, key) {
  let btns = '';
  const win = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) win.push(p);
    else if (win[win.length - 1] !== '…') win.push('…');
  }
  win.forEach(p => {
    if (p === '…') btns += '<button disabled>…</button>';
    else btns += '<button class="' + (p === page ? 'cur' : '') + '" data-pg="' + p + '">' + p + '</button>';
  });
  return '<div class="pager" data-pager="' + key + '">' +
    '<span>' + total.toLocaleString('en-GB') + ' rows</span>' +
    '<select data-persel>' + PER_PAGE_OPTS.map(o => '<option value="' + o + '"' + (o === per ? ' selected' : '') + '>' + o + ' / page</option>').join('') + '</select>' +
    '<div class="pg-btns"><button data-pg="prev" ' + (page <= 1 ? 'disabled' : '') + '>&#9664; PREV</button>' + btns +
    '<button data-pg="next" ' + (page >= pages ? 'disabled' : '') + '>NEXT &#9654;</button></div>' +
    '<span class="pg-info">page ' + page + ' / ' + pages + '</span></div>';
}
function wirePager(key, refresh) {
  document.querySelectorAll('[data-pager="' + key + '"]').forEach(p => {
    p.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => {
      const v = b.dataset.pg;
      const st = LS[key];
      if (v === 'prev') st.page = Math.max(1, st.page - 1);
      else if (v === 'next') st.page = st.page + 1;
      else st.page = parseInt(v, 10);
      refresh();
    });
    const sel = p.querySelector('[data-persel]');
    if (sel) sel.onchange = () => { LS[key].per = parseInt(sel.value, 10); LS[key].page = 1; refresh(); };
  });
}

/* ============================================================ INTELLIGENCE DETAIL
   V2.2 · IO READER — Institutional Intelligence Reading Environment
   Presentation layer only: every rendered value is a committed Core field,
   verbatim. Narrative sentences are assembled from committed fields only —
   no interpretation is generated. Reading measure 940px.
   Hierarchy: WHAT HAPPENED → WHY IT MATTERS → KEY FACTS → EVIDENCE →
              SOURCE DOCUMENT → PROVENANCE → RELATED */

function metricLabel(m) {
  return String(m == null ? '' : m).replace(/_/g, ' ');
}

/* human display value = raw_value when it differs from the normalized value */
function factDisplay(c) {
  const v = String(c.value == null ? '' : c.value);
  const r = String(c.raw_value == null ? '' : c.raw_value);
  if (r && r !== v) return { disp: r, norm: v };
  return { disp: v, norm: null };
}

/* verbatim excerpt with the committed fact value visually anchored (first whole-word
   occurrence only; if the value does not appear verbatim, the excerpt is untouched) */
function findWhole(hay, needle) {
  let from = 0;
  for (;;) {
    const p = hay.indexOf(needle, from);
    if (p === -1 || !needle.length) return -1;
    const before = p > 0 ? hay[p - 1] : '';
    const after = p + needle.length < hay.length ? hay[p + needle.length] : '';
    if (!/[0-9A-Za-z]/.test(before) && !/[0-9A-Za-z]/.test(after)) return p;
    from = p + 1;
  }
}
function hlExcerpt(c) {
  const escd = esc(c.excerpt);
  const cand = [];
  if (c.raw_value != null && String(c.raw_value).length) cand.push(String(c.raw_value));
  if (c.value != null && String(c.value).length) cand.push(String(c.value));
  for (const n of cand) {
    const en = esc(n);
    const p = findWhole(escd, en);
    if (p !== -1) {
      return escd.slice(0, p) + '<b>' + escd.slice(p, p + en.length) + '</b>' + escd.slice(p + en.length);
    }
  }
  return escd;
}

/* feed order: FRESH → HISTORICAL → UNDATED, then most recent date */
function feedOrderIo() {
  return D.intelligence.slice().sort((a, b) =>
    (statusRank(a.date_status) - statusRank(b.date_status)) ||
    ioSortDate(b).localeCompare(ioSortDate(a)) ||
    a.institution_name.localeCompare(b.institution_name));
}

function rdH(title, sub) {
  return '<div class="rd-h"><span class="rh-t">' + title + '</span>' +
    '<span class="rh-rule"></span>' + (sub ? '<span class="rh-sub">' + sub + '</span>' : '') + '</div>';
}

function viewIoDetail(app, ioId) {
  const io = IX.ios[ioId];
  if (!io) { app.innerHTML = notFound('Intelligence object', ioId, '#/intelligence'); return; }
  const src = IX.srcs[io.source_id] || null;
  const chain = io.chain || [];
  const doc = chain.length ? IX.docs[chain[0].document_id] : null;
  const traceOk = ioTraceable(io);
  const domain = src ? src.official_domain : (chain[0] ? cleanUrl(chain[0].canonical_url).split('/')[0] : '');
  const dated = io.date_status === 'FRESH' || io.date_status === 'HISTORICAL';
  const dateStr = dated ? (io.publication_time ? fmtDateTime(io.publication_time) : fmtDate(io.best_document_date)) : null;
  const metrics = uniq(chain.map(c => c.metric));

  document.title = io.institution_name + ' — ' + io.event_type_label + ' · ROUAA';

  /* ---------- HERO (V2.2 order §7: SOURCE/TYPE/JURISDICTION → institution
     → date + status → actions; institution is the first real visual element) ---------- */
  let html = '' +
    '<div class="reader">' +
    '<div class="crumb"><a href="#/">OVERVIEW</a><span class="sep">/</span>' +
      '<a href="#/intelligence">INTELLIGENCE</a><span class="sep">/</span><span>' + esc(io.institution_name) + '</span></div>' +

    '<div class="rd-kicker">' +
      '<span class="rk-seg">SOURCE — ' +
        (src ? '<a href="#/sources/' + esc(src.source_id) + '" title="Open source profile">' + esc(domain || src.institution_name) + '</a>'
             : esc(io.institution_name)) + '</span>' +
      '<span class="rk-div">·</span>' +
      '<span class="rk-seg">TYPE — ' + esc(io.event_type_label) + '</span>' +
      '<span class="rk-div">·</span>' +
      '<span class="rk-seg">JURISDICTION — ' + esc(io.jurisdiction) + '</span>' +
    '</div>' +
    '<h1 class="rd-title">' + esc(io.institution_name) + '</h1>' +

    '<div class="rd-when">' +
      (dated ? '<span class="rw-date">' + esc(dateStr) + '</span>'
             : '<span class="rw-nodate">No publication date attributed by Core</span>') +
      '<span class="rw-sep">·</span>' + bStatus(io.date_status) +
    '</div>' +

    '<p class="rd-summary">' +
      'Binds <b>' + num(io.n_facts) + '</b> structured fact' + (io.n_facts === 1 ? '' : 's') +
      ', each carrying a verbatim evidence excerpt from <b>' + num(io.n_documents) + '</b> official document' +
      (io.n_documents === 1 ? '' : 's') + (domain ? ' on <b>' + esc(domain) + '</b>' : '') + '. ' +
      (dated ? 'Publication date attributed by ROUAA Core (' + esc(io.publication_provenance || 'attributed') + ').'
             : 'The snapshot carries no date attribution for this object.') +
    '</p>' +

    '<div class="rd-actions">' +
      (chain[0] && chain[0].canonical_url
        ? '<a class="btn ghost" href="' + esc(chain[0].canonical_url) + '" target="_blank" rel="noopener">OPEN ORIGINAL DOCUMENT &#8599;</a>' : '') +
      '<a class="btn" href="#/trace/' + io.io_id + '">EVIDENCE CHAIN &rarr;</a>' +
    '</div>';

  /* ---------- WHAT HAPPENED (narrative from committed fields only) ---------- */
  html += '<div class="rd-section">' +
    rdH('WHAT HAPPENED', 'assembled verbatim from committed fields') +
    '<div class="rd-body hero-body"><p>' +
      esc(io.event_type_label) + ' recorded from ' + esc(io.institution_name) + '.' +
      ' ' + (io.is_new ? 'The object first entered the production record in this wave.'
                      : 'The object was re-discovered from an earlier production wave.') +
    '</p>' +
    (chain.length ? '<p>The object binds <span class="num-hl">' + chain.length + '</span> structured fact' +
      (chain.length === 1 ? '' : 's') + ' — ' +
      (metrics.length ? 'covering ' + metrics.map(m => esc(metricLabel(m))).join(', ') + ' — ' : '') +
      'and every fact carries a verbatim excerpt from the official document stored in this snapshot. ' +
      'Open any fact below to read its evidence in full.</p>'
      : '<p>No facts are bound to this object in the snapshot.</p>') +
    '</div></div>';

  /* ---------- WHY IT MATTERS (V2.2 order §10: clean relevance fields,
     disclaimer as secondary disclosure — honest: no Core interpretation layer) ---------- */
  html += '<div class="rd-section">' +
    rdH('WHY IT MATTERS', 'relevance context from committed metadata') +
    '<div class="rd-why">' +
      '<div class="wc"><div class="wk">Sector</div><div class="wv">' + esc(io.sector_label) + '</div></div>' +
      '<div class="wc"><div class="wk">Jurisdiction</div><div class="wv">' + esc(io.jurisdiction) +
        ' <span class="wsub">· ' + esc(io.region) + '</span></div></div>' +
      (src ? '<div class="wc"><div class="wk">Authority</div><div class="wv">' + esc(src.authority_type) +
        '<span class="wsub"> · ' + esc(src.authority_level) + '</span></div></div>' : '') +
      (src ? '<div class="wc"><div class="wk">Source production</div><div class="wv">' +
        num(src.unique_vio) + ' object' + (src.unique_vio === 1 ? '' : 's') + ' this wave' +
        '<span class="wsub"> · ' + num(src.fresh_vio) + ' dated</span></div></div>' : '') +
      '<div class="wc"><div class="wk">Language</div><div class="wv">' + esc(String(io.language).toUpperCase()) + '</div></div>' +
    '</div>' +
    '<div class="rd-note"><b>No interpretation layer is produced by ROUAA Core</b> for this object — ' +
      'and this interface does not generate analytical narratives. ' +
      'Relevance must be assessed from the committed facts, evidence and source below.</div>' +
    '</div>';

  /* ---------- KEY FACTS (scannable) ---------- */
  html += '<div class="rd-section">' +
    rdH('KEY FACTS', chain.length + ' fact record' + (chain.length === 1 ? '' : 's') + ' · displayed verbatim') +
    '<div class="kf2">';
  const kfShow = 10;
  let prevMetric = null;
  chain.forEach((c, i) => {
    const fd = factDisplay(c);
    const sameMetric = c.metric === prevMetric;
    prevMetric = c.metric;
    const vlong = String(fd.disp).length > 36; /* long sentence values read better slightly smaller */
    html += '<div class="kf2-row' + (i >= kfShow ? ' kf2-extra' : '') + '">' +
      '<div class="kf2-line">' +
        '<span class="kf2-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="kf2-metric">' + (sameMetric
          ? '<span class="dim" title="' + esc(metricLabel(c.metric)) + ' (continued)">\u2033</span>'
          : esc(metricLabel(c.metric))) + '</span>' +
        '<span class="kf2-value' + (vlong ? ' vlong' : '') + '">' + esc(fd.disp) +
          (fd.norm ? ' <span class="kf2-norm">= ' + esc(fd.norm) + '</span>' : '') + '</span>' +
        '<span class="kf2-evid">EVIDENCE &#9662;</span>' +
      '</div>' +
      '<div class="kf2-body">' +
        '<div class="rd-quote" style="margin-bottom:0">' +
          '<div class="rq-meta">EVIDENCE EXCERPT — VERBATIM FROM THE STORED DOCUMENT</div>' +
          '<blockquote>' + hlExcerpt(c) + '</blockquote>' +
          (c.evidence_location || c.evidence_id ? '<div class="rq-loc">TECHNICAL LOCATION — <b>' + esc(c.evidence_location || '—') +
            '</b>' + (c.evidence_id ? ' · EVIDENCE OBJECT <b>' + esc(c.evidence_id) + '</b>' : '') + '</div>' : '') +
          '<div class="rq-actions">' +
            '<a class="btn sm" href="#/evidence/' + io.io_id + '/' + esc(c.fact_id) + '">VIEW EVIDENCE</a>' +
            (c.canonical_url ? '<a class="btn sm" href="' + esc(c.canonical_url) + '" target="_blank" rel="noopener">OPEN ORIGINAL &#8599;</a>' : '') +
          '</div>' +
        '</div>' +
      '</div></div>';
  });
  html += '</div>';
  if (chain.length > kfShow) {
    html += '<div class="kf2-more"><button class="btn" id="kf2-toggle">SHOW ALL ' + chain.length + ' FACTS</button></div>';
  }
  html += '</div>';

  /* ---------- EVIDENCE (prominent, readable quotes) ---------- */
  if (chain.length) {
    const qn = Math.min(3, chain.length);
    html += '<div class="rd-section">' +
      rdH('EVIDENCE', 'verbatim excerpts from the stored document') ;
    for (let i = 0; i < qn; i++) {
      const c = chain[i];
      const fd = factDisplay(c);
      html += '<div class="rd-quote">' +
        '<div class="rq-meta">FACT ' + String(i + 1).padStart(2, '0') + ' · <b>' + esc(metricLabel(c.metric)) +
          ' = ' + esc(fd.disp) + '</b></div>' +
        '<blockquote>' + hlExcerpt(c) + '</blockquote>' +
        (c.evidence_location || c.evidence_id ? '<div class="rq-loc">TECHNICAL LOCATION — <b>' + esc(c.evidence_location || '—') +
          '</b>' + (c.evidence_id ? ' · EVIDENCE OBJECT <b>' + esc(c.evidence_id) + '</b>' : '') + '</div>' : '') +
        '<div class="rq-actions">' +
          '<a class="btn sm" href="#/evidence/' + io.io_id + '/' + esc(c.fact_id) + '">VIEW EVIDENCE</a>' +
          (c.canonical_url ? '<a class="btn sm" href="' + esc(c.canonical_url) + '" target="_blank" rel="noopener">OPEN ORIGINAL &#8599;</a>' : '') +
        '</div></div>';
    }
    if (chain.length > qn) {
      html += '<div><a class="btn" href="#/trace/' + io.io_id + '">VIEW ALL ' + chain.length + ' EVIDENCE RECORDS &rarr;</a></div>';
    }
    html += '</div>';
  }

  /* ---------- SOURCE DOCUMENT ---------- */
  html += '<div class="rd-section">' + rdH('SOURCE DOCUMENT');
  if (doc) {
    html += '<div class="def">' +
      '<div class="def-row"><div class="dk">Document</div><div class="dv"><span class="def-doc-title">' +
        (doc.canonical_url ? '<a href="' + esc(doc.canonical_url) + '" target="_blank" rel="noopener">' + esc(domain) + '</a>' : na(null)) +
        '</span><span class="sub">' + esc(doc.canonical_url) + '</span>' +
        '<span class="sub">Documents in this snapshot are identified by canonical URL — Core does not yet produce document titles</span></div></div>' +
      '<div class="def-row"><div class="dk">Issuing authority</div><div class="dv">' + esc(src ? src.institution_name : io.institution_name) +
        (src ? '<span class="sub">' + esc(src.authority_type) + ' · ' + esc(src.authority_level) + '</span>' : '') + '</div></div>' +
      '<div class="def-row"><div class="dk">Publication date</div><div class="dv">' +
        (doc.best_iso ? esc(fmtDate(doc.best_iso)) + ' <span class="sub">best date attributed by Core to this document</span>' :
          '<span class="na">Not available — no date attributed by Core</span>') + '</div></div>' +
      '<div class="def-row"><div class="dk">Document type</div><div class="dv">' + esc(doc.text_layer) + ' · ' +
        (doc.text_chars ? Number(doc.text_chars).toLocaleString('en-GB') + ' characters' : '—') + '</div></div>' +
      '<div class="def-row"><div class="dk">Acquisition</div><div class="dv">' +
        (doc.new_document === 'True' ? 'First claim — acquired for the first time this wave' : 'Known document — acquired in an earlier wave') +
        ' · ' + (doc.usable === 'True' ? 'usable text layer stored' : 'not usable') + '</div></div>' +
      '<div class="def-row"><div class="dk">Extraction</div><div class="dv">' + num(doc.n_facts) + ' fact' + (doc.n_facts === 1 ? '' : 's') +
        ' extracted · ' + num(doc.n_intelligence) + ' intelligence object' + (doc.n_intelligence === 1 ? '' : 's') + ' bound</div></div>' +
    '</div>' +
    '<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">' +
      (doc.canonical_url ? '<a class="btn primary" href="' + esc(doc.canonical_url) + '" target="_blank" rel="noopener">OPEN ORIGINAL DOCUMENT &#8599;</a>' : '') +
      '<a class="btn" href="#/documents/' + esc(doc.document_id) + '">DOCUMENT RECORD &rarr;</a></div>';
  } else {
    html += '<div class="rd-note">No document record is available for this object in the snapshot.</div>';
  }
  html += '</div>';

  /* ---------- PROVENANCE (V3.1 spine: one chain language with the
     evidence/trace views — authority -> document -> fact -> evidence ->
     intelligence; the EVIDENCE stage alone carries the gold marker) ---------- */
  html += '<div class="rd-section">' +
    rdH('PROVENANCE', traceOk ? 'every level resolves in this snapshot' : 'trace incomplete in this snapshot') +
    '<div class="chain">' +
      chainNode('01', 'Official authority',
        esc(src ? src.institution_name : io.institution_name),
        (src ? 'authority type <b>' + esc(src.authority_type) + '</b> · jurisdiction <b>' + esc(src.jurisdiction) + '</b>'
             : 'source id <b>' + esc(io.source_id) + '</b>'),
        src ? '#/sources/' + esc(src.source_id) : null) +
      chainNode('02', 'Official document',
        esc(doc ? cleanUrl(doc.canonical_url) : 'not resolved'),
        (doc ? 'document <b>' + esc(doc.document_id) + '</b>' + (doc.best_iso ? ' · dated <b>' + esc(fmtDate(doc.best_iso)) + '</b>' : ' · no date attributed')
             : 'no document record resolves in this snapshot'),
        doc ? '#/documents/' + esc(doc.document_id) : null) +
      chainNode('03', 'Extracted fact',
        chain.length + ' fact record' + (chain.length === 1 ? '' : 's') + ' bound to this object',
        (metrics.length ? 'metrics <b>' + esc(metrics.map(metricLabel).join(', ')) + '</b>' : '—'),
        doc ? '#/facts?doc=' + esc(doc.document_id) : '#/intelligence/' + io.io_id) +
      chainNode('04', 'Evidence',
        chain.length + ' verbatim excerpt' + (chain.length === 1 ? '' : 's') + ' stored in this snapshot',
        'content-verified by Core · full per-fact chain in <b>TRACE EVIDENCE</b>',
        '#/trace/' + io.io_id, { evidence: true }) +
      chainNode('05', 'Intelligence',
        'This object — ' + esc(io.institution_name),
        'object <b>' + esc(io.io_id) + '</b> · ' + esc(io.event_type_label) + ' · you are reading it',
        null) +
    '</div>' +
    (traceOk ? '' : '<div class="rd-note" style="margin-top:16px"><b>Trace incomplete.</b> One or more chain levels do not resolve inside this snapshot — see technical provenance below.</div>');

  /* technical provenance — available, not dominant */
  const hashes = uniq(chain.map(c => c.content_sha256));
  html += '<details class="rd-tech"><summary>VIEW TECHNICAL PROVENANCE</summary><div class="rd-tech-body">' +
    '<div class="meta-grid">' +
      mcell('Object ID', '<span class="mono">' + esc(io.io_id) + '</span>') +
      mcell('Event ID', '<span class="mono">' + esc(io.event_id) + '</span>') +
      mcell('Version', 'object v' + num(io.version) + ' · event v' + num(io.event_version)) +
      mcell('Core template headline', esc(io.headline) + ' <span class="dim">(generated from institution + event type — not a semantic title)</span>') +
      mcell('Publication basis', esc(io.publication_basis || '—')) +
      mcell('Publication provenance', esc(io.publication_provenance || '—')) +
      mcell('Raw date field', esc(io.publication_time_raw || '—')) +
      mcell('Event type (raw)', '<span class="mono">' + esc(io.event_type) + '</span>') +
      (hashes.length ? mcell('Document content SHA-256', hashes.map(h => '<span class="mono">' + esc(h) + '</span>').join('<br>')) : '') +
      mcell('Source ID', '<span class="mono">' + esc(io.source_id) + '</span>') +
    '</div></div></details></div>';

  /* ---------- RELATED INTELLIGENCE (data-proven links only) ---------- */
  const sameSrc = D.intelligence.filter(x => x.source_id === io.source_id && x.io_id !== io.io_id);
  const sameInst = D.intelligence.filter(x => x.institution_name === io.institution_name &&
    x.source_id !== io.source_id && x.io_id !== io.io_id);
  if (sameSrc.length || sameInst.length) {
    html += '<div class="rd-section">' +
      rdH('RELATED INTELLIGENCE', 'proven links only — same source or same institution');
    const relRow = x => '<div class="rel-row" data-go="#/intelligence/' + x.io_id + '">' +
      bStatus(x.date_status) +
      '<span class="rr-inst">' + esc(x.institution_name) + '</span>' +
      '<span class="rr-type">' + esc(x.event_type_label) + '</span>' +
      '<span class="rr-meta">' + (x.date_status === 'UNDATED' ? 'no date' : esc(fmtDate(ioDateKey(x)))) +
        ' · ' + x.n_facts + ' fact' + (x.n_facts === 1 ? '' : 's') + '</span>' +
      '<span class="rr-open">OPEN &rarr;</span></div>';
    if (sameSrc.length) {
      html += '<div class="rel-group"><div class="rel-group-k">From the same official source · ' + sameSrc.length + ' other' +
        (sameSrc.length === 1 ? '' : 's') + '</div>' + sameSrc.slice(0, 6).map(relRow).join('') + '</div>';
    }
    if (sameInst.length) {
      html += '<div class="rel-group"><div class="rel-group-k">From the same institution · ' + sameInst.length + ' other' +
        (sameInst.length === 1 ? '' : 's') + '</div>' + sameInst.slice(0, 6).map(relRow).join('') + '</div>';
    }
    html += '</div>';
  }

  /* ---------- footer navigation (V3.1: the document ends like a document —
     registry back-link, real previous/next identities, end-of-record line) --- */
  const order = feedOrderIo();
  const idx = order.findIndex(x => x.io_id === io.io_id);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const neighborWhen = x => x.date_status === 'UNDATED' ? 'no date attributed' : esc(fmtDate(ioDateKey(x)));
  html += '<div class="rd-footer">' +
    '<a class="rf-back" href="#/intelligence">&larr; ALL INTELLIGENCE</a>' +
    '<div class="rd-nav">' +
      (prev ? '<a href="#/intelligence/' + prev.io_id + '"><span class="rn-k">&larr; PREVIOUS OBJECT</span>' +
        '<span class="rn-v">' + esc(prev.institution_name) + '</span>' +
        '<span class="rn-s">' + bStatus(prev.date_status) + ' · ' + neighborWhen(prev) + '</span></a>'
        : '<span></span>') +
      (next ? '<a class="next" href="#/intelligence/' + next.io_id + '"><span class="rn-k">NEXT OBJECT &rarr;</span>' +
        '<span class="rn-v">' + esc(next.institution_name) + '</span>' +
        '<span class="rn-s">' + bStatus(next.date_status) + ' · ' + neighborWhen(next) + '</span></a>'
        : '<span></span>') +
    '</div></div>' +
    '<div class="rd-end">END OF RECORD · <b>' + esc(io.io_id) + '</b> · ' + esc(D.meta.wave) +
      ' SNAPSHOT ' + esc(D.meta.snapshot_date) + ' · NOT A LIVE FEED</div>';

  html += '</div>'; /* .reader */
  app.innerHTML = html;

  /* interactions */
  app.querySelectorAll('.kf2-line').forEach(l => l.onclick = () => {
    l.parentElement.classList.toggle('open');
  });
  const tog = document.getElementById('kf2-toggle');
  if (tog) tog.onclick = () => {
    const extra = app.querySelectorAll('.kf2-extra');
    const hidden = extra.length && extra[0].style.display !== 'block';
    extra.forEach(r => { r.style.display = hidden ? 'block' : 'none'; });
    tog.textContent = hidden ? 'SHOW FIRST 10 FACTS' : ('SHOW ALL ' + chain.length + ' FACTS');
  };
  if (chain.length > kfShow) {
    app.querySelectorAll('.kf2-extra').forEach(r => { r.style.display = 'none'; });
  }
  bindGo(app);
}

function mcell(k, v) { return '<div class="meta-cell"><div class="meta-k">' + k + '</div><div class="meta-v">' + v + '</div></div>'; }

/* V3.1 honest empty state — used by every registry surface when filters or
   search match nothing; states plainly that nothing is synthesized */
function emptyRegistry(what) {
  return '<div class="empty">NO ' + String(what).toUpperCase() + ' IN THIS SNAPSHOT MATCHES THE CURRENT FILTERS OR SEARCH.<br>' +
    'Nothing is hidden and nothing is synthesized — clear a filter or search term to return to the full registry.</div>';
}

function notFound(what, id, back) {
  return '<div class="note"><b>' + esc(what) + ' not found in this snapshot.</b> ' +
    '<span class="mono">' + esc(id || '') + '</span> <a href="' + back + '">Go back &rarr;</a></div>';
}

/* ============================================================ EVIDENCE VIEW (per fact) */

function viewEvidence(app, ioId, factId) {
  const io = IX.ios[ioId];
  if (!io) { app.innerHTML = notFound('Intelligence object', ioId, '#/intelligence'); return; }
  const c = (io.chain || []).find(x => x.fact_id === factId);
  if (!c) { app.innerHTML = notFound('Fact', factId, '#/intelligence/' + ioId); return; }
  const doc = IX.docs[c.document_id] || null;
  const src = IX.srcs[c.source_id] || null;

  let html = '' +
    '<div class="crumb"><a href="#/intelligence">INTELLIGENCE</a><span class="sep">/</span>' +
    '<a href="#/intelligence/' + io.io_id + '">' + esc(io.institution_name) + '</a><span class="sep">/</span><span class="mono">EVIDENCE</span></div>' +

    '<div class="view-head"><div class="view-title">EVIDENCE VIEW</div>' +
    '<div class="view-count">FACT &rarr; EVIDENCE &rarr; DOCUMENT &rarr; SOURCE — every level resolves</div></div>' +

    '<div class="chain">' +
      chainNode('01', 'Fact',
        esc(metricLabel(c.metric)) + ' = <span class="hl">' + esc(c.value) + '</span>',
        'fact <b>' + esc(c.fact_id) + '</b> · description <b>' + esc(c.raw_value || '—') + '</b>',
        '#/intelligence/' + io.io_id) +
      chainNode('02', 'Evidence excerpt — verbatim',
        '<div class="cn-quote">' + hlExcerpt(c) + '</div>',
        'technical location <b>' + esc(c.evidence_location) + '</b> · evidence object <b>' + esc(c.evidence_id) + '</b> · content-verified by Core',
        null, { evidence: true }) +
      chainNode('03', 'Document',
        esc(cleanUrl(c.canonical_url)),
        'document <b>' + esc(c.document_id) + '</b>' +
          (doc && doc.best_iso ? ' · dated <b>' + esc(fmtDate(doc.best_iso)) + '</b>' : ' · no date attributed') +
          (doc ? ' · text layer <b>' + esc(doc.text_layer) + '</b>' : ''),
        '#/documents/' + c.document_id) +
      chainNode('04', 'Official source',
        esc(src ? src.institution_name : c.source_id),
        (src ? 'authority type <b>' + esc(src.authority_type) + '</b> · jurisdiction <b>' + esc(src.jurisdiction) +
          '</b> · domain <b>' + esc(src.official_domain) + '</b>' : 'source <b>' + esc(c.source_id) + '</b>'),
        src ? '#/sources/' + c.source_id : null) +
    '</div>' +

    '<div class="section"><div class="section-title">FULL FACT RECORD</div>' +
    '<div class="meta-grid">' +
      mcell('Metric', '<span class="mono">' + esc(c.metric) + '</span>') +
      mcell('Value', '<span class="mono">' + esc(c.value) + '</span>') +
      mcell('Unit', nDash()) +
      mcell('Period', nDash()) +
      mcell('Description (raw value)', esc(c.raw_value || '—')) +
      mcell('Bound intelligence object', '<a href="#/intelligence/' + io.io_id + '">' + esc(io.institution_name) + ' · ' + esc(io.event_type_label) + '</a>') +
      mcell('Evidence object', '<span class="mono">' + esc(c.evidence_id) + '</span>') +
      mcell('Technical location', '<span class="mono">' + esc(c.evidence_location) + '</span>') +
    '</div>' +
    '<div class="note" style="margin-top:10px"><b>Unit / Period.</b> Not yet produced by ROUAA Core for this fact. ' +
    'The interface reserves the fields rather than inventing values.</div></div>' +

    '<div class="section"><div class="section-title">ACTIONS</div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<a class="btn primary" href="#/trace/' + io.io_id + '">TRACE EVIDENCE (full chain)</a>' +
      '<a class="btn" href="#/intelligence/' + io.io_id + '">BACK TO INTELLIGENCE OBJECT</a>' +
      '<a class="btn" href="' + esc(c.canonical_url) + '" target="_blank" rel="noopener">OPEN ORIGINAL DOCUMENT</a>' +
    '</div></div>';

  app.innerHTML = html;
  bindGo(app);
}

/* V3.1 provenance spine node — the one chain language shared by the reader
   PROVENANCE strip, the EVIDENCE view and the TRACE view (see style.css).
   no = stage number, k = stage label, v = exhibit value (HTML), sub =
   provenance sub-line (HTML, technical ids in <b>), href = drill-down link
   (null = static stage), opts.evidence = gold stage marker (evidence only). */
function chainNode(no, k, v, sub, href, opts) {
  const ev = opts && opts.evidence;
  const cls = 'chain-node' + (href ? ' link' : '') + (ev ? ' stg-evidence' : '');
  const inner = '<div class="cn-k"><span class="cn-no">' + no + '</span>' + k + '</div>' +
    '<div class="cn-v">' + v + '</div>' +
    (sub ? '<div class="cn-s">' + sub + '</div>' : '');
  if (href) {
    return '<a class="' + cls + '" href="' + href + '">' + inner + '<span class="cn-open">OPEN &rarr;</span></a>';
  }
  return '<div class="' + cls + '">' + inner + '</div>';
}

/* ============================================================ TRACE (per IO) */

function viewTrace(app, ioId) {
  const io = IX.ios[ioId];
  if (!io) { app.innerHTML = notFound('Intelligence object', ioId, '#/intelligence'); return; }
  const chain = io.chain || [];
  const doc = chain.length ? IX.docs[chain[0].document_id] : null;
  const src = IX.srcs[io.source_id] || null;
  const traceOk = ioTraceable(io);

  let html = '' +
    '<div class="crumb"><a href="#/intelligence">INTELLIGENCE</a><span class="sep">/</span>' +
    '<a href="#/intelligence/' + io.io_id + '">' + esc(io.institution_name) + '</a><span class="sep">/</span><span class="mono">TRACE</span></div>' +

    '<div class="view-head"><div class="view-title">TRACE EVIDENCE</div>' +
    '<div class="view-count">SOURCE &rarr; DOCUMENT &rarr; EVIDENCE &rarr; FACT &rarr; INTELLIGENCE OBJECT</div></div>';

  if (!traceOk) {
    html += '<div class="note" style="margin-bottom:14px"><b>Trace incomplete.</b> One or more chain levels do not resolve inside this snapshot.</div>';
  }

  html += '<div class="chain">' +
    chainNode('01', 'Official source',
      esc(src ? src.institution_name : io.source_id),
      (src ? 'authority type <b>' + esc(src.authority_type) + '</b> · level <b>' + esc(src.authority_level) +
        '</b> · jurisdiction <b>' + esc(src.jurisdiction) + '</b> · domain <b>' + esc(src.official_domain) + '</b>'
        : 'source <b>' + esc(io.source_id) + '</b>'),
      src ? '#/sources/' + src.source_id : null) +
    chainNode('02', 'Official document',
      esc(doc ? cleanUrl(doc.canonical_url) : 'not resolved'),
      (doc ? 'document <b>' + esc(doc.document_id) + '</b>' +
        (doc.best_iso ? ' · dated <b>' + esc(fmtDate(doc.best_iso)) + '</b>' : ' · no date attributed') +
        ' · text layer <b>' + esc(doc.text_layer) + '</b>' : 'no document record resolves in this snapshot'),
      doc ? '#/documents/' + doc.document_id : null) +
    chainNode('03', 'Evidence',
      chain.length + ' evidence object' + (chain.length === 1 ? '' : 's') + ' — verbatim excerpts bound to facts',
      'representation + content hash verified by Core · per-fact excerpts below',
      null, { evidence: true }) +
    chainNode('04', 'Fact',
      chain.length + ' fact record' + (chain.length === 1 ? '' : 's'),
      'metrics <b>' + esc(uniq(chain.map(c => c.metric)).join(', ')) + '</b>',
      '#/intelligence/' + io.io_id) +
    chainNode('05', 'Intelligence object',
      esc(io.institution_name) + ' — ' + esc(io.event_type_label),
      'object <b>' + esc(io.io_id) + '</b> · ' + bStatus(io.date_status),
      '#/intelligence/' + io.io_id) +
    '</div>' +

    '<div class="section"><div class="section-title">PER-FACT EVIDENCE CHAIN <span class="sub">every fact, its excerpt and its technical location</span></div>' +
    '<div class="kf-list">';

  chain.forEach((c, i) => {
    html += '<div class="kf-row"><div class="kf-head">' +
      '<span class="kf-no">FACT ' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="kf-metric">' + esc(metricLabel(c.metric)) + '</span>' +
      '<span class="kf-value">' + esc(c.value) + '</span>' +
      '<span class="kf-raw ellip">' + esc(String(c.raw_value || '')) + '</span>' +
      '<span class="kf-aff">EXCERPT &#9662;</span>' +
      '<span class="kf-actions"><a class="btn sm" href="#/evidence/' + io.io_id + '/' + esc(c.fact_id) + '">EVIDENCE VIEW</a></span>' +
      '</div><div class="kf-body"><div class="ev-block">' +
      '<div class="ev-loc">EXCERPT — VERBATIM FROM <b>' + esc(c.document_id) + '</b></div>' +
      '<div class="ev-excerpt">' + hlExcerpt(c) + '</div>' +
      '<div class="ev-loc">TECHNICAL LOCATION — <b>' + esc(c.evidence_location) + '</b> · EVIDENCE OBJECT <b>' + esc(c.evidence_id) + '</b></div>' +
      '</div></div></div>';
  });
  html += '</div></div>';

  html += '<div class="section"><div class="section-title">ACTIONS</div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<a class="btn primary" href="#/intelligence/' + io.io_id + '">BACK TO INTELLIGENCE OBJECT</a>' +
    (src ? '<a class="btn" href="#/sources/' + esc(src.source_id) + '">SOURCE PROFILE</a>' : '') +
    (doc ? '<a class="btn" href="#/documents/' + esc(doc.document_id) + '">DOCUMENT RECORD</a>' : '') +
    '</div></div>';

  app.innerHTML = html;
  app.querySelectorAll('.kf-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('open'));
  bindGo(app);
}

/* ============================================================ DOCUMENTS (list) */

function docFiltered() {
  const f = LS.docs;
  const q = lower(f.q.trim());
  return D.documents.filter(d => {
    const src = IX.srcs[d.source_id] || {};
    if (f.fresh && d.fresh_status !== f.fresh) return false;
    if (f.jur && src.jurisdiction !== f.jur) return false;
    if (f.layer && d.text_layer !== f.layer) return false;
    if (f.prod === 'yes' && !(d.n_intelligence > 0)) return false;
    if (f.prod === 'no' && (d.n_intelligence > 0)) return false;
    if (q) {
      const hay = lower([d.canonical_url, d.document_id, src.institution_name, d.source_id,
        src.jurisdiction, d.text_layer, d.best_iso].join(' '));
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}
function docSort(arr) {
  const f = LS.docs;
  const dir = f.dir === 'asc' ? 1 : -1;
  const dateKey = d => d.best_iso || '0000-00-00';
  const by = {
    date: (a, b) => dateKey(a).localeCompare(dateKey(b)) * dir,
    inst: (a, b) => ((IX.srcs[a.source_id] || {}).institution_name || '').localeCompare((IX.srcs[b.source_id] || {}).institution_name || '') * dir,
    facts: (a, b) => ((a.n_facts || 0) - (b.n_facts || 0)) * dir,
    ios: (a, b) => ((a.n_intelligence || 0) - (b.n_intelligence || 0)) * dir,
    src: (a, b) => String(a.source_id).localeCompare(String(b.source_id)) * dir,
    fresh: (a, b) => String(a.fresh_status).localeCompare(String(b.fresh_status)) * dir,
    layer: (a, b) => String(a.text_layer).localeCompare(String(b.text_layer)) * dir,
  }[f.sort] || null;
  return by ? arr.slice().sort(by) : arr.slice();
}

function viewDocuments(app) {
  LS.docs.page = 1;
  renderDocuments(app);
}
function renderDocuments(app) {
  const f = LS.docs;
  const all = docFiltered();
  const sorted = docSort(all);

  let html = '' +
    '<div class="view-head">' +
      '<div class="view-title">DOCUMENTS</div>' +
      '<div class="view-count">' + all.length.toLocaleString('en-GB') + ' of ' + D.documents.length + ' documents</div>' +
    '</div>' +
    '<div class="cols"><div class="col-main" id="docs-main"></div>' +
    '<div class="col-side"><div class="panel filter-panel"><div class="panel-head"><span class="panel-label">FILTERS</span>' +
    '<span class="panel-meta">' + D.documents.length + ' total</span></div><div class="panel-body" id="docs-filters"></div></div></div></div>';

  app.innerHTML = html;
  renderDocFilters();
  renderDocMain(sorted);
}

function renderDocFilters() {
  const f = LS.docs;
  const el = document.getElementById('docs-filters');
  const jur = uniq(D.sources.map(s => s.jurisdiction));
  const layers = uniq(D.documents.map(d => d.text_layer));

  el.innerHTML =
    fg('Search', '<input type="text" id="fd-q" placeholder="url, institution, source, date..." value="' + esc(f.q) + '">') +
    fg('Freshness', '<div class="opts">' + ['FRESH', 'HISTORICAL', 'DATE_UNKNOWN', 'POST_WINDOW'].map(v =>
      '<span class="fopt' + (f.fresh === v ? ' on' : '') + '" data-f="' + v + '">' + (v === 'DATE_UNKNOWN' ? 'DATE UNKNOWN' : v) + '</span>').join('') + '</div>') +
    fg('Jurisdiction', '<div class="opts">' + jur.map(v => '<span class="fopt' + (f.jur === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>') +
    fg('Text layer', '<div class="opts">' + layers.map(v => '<span class="fopt' + (f.layer === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>') +
    fg('Intelligence production', '<div class="opts">' + ['yes', 'no'].map(v =>
      '<span class="fopt' + (f.prod === v ? ' on' : '') + '" data-f="p_' + v + '">' + (v === 'yes' ? 'Producing IOs (147)' : 'Not producing') + '</span>').join('') + '</div>') +
    '<div class="fgroup"><button class="btn sm" id="fd-clear">CLEAR ALL FILTERS</button></div>';

  const qEl = document.getElementById('fd-q');
  qEl.oninput = () => { f.q = qEl.value; f.page = 1; refreshDocs(); };
  el.querySelectorAll('.fopt').forEach(o => o.onclick = () => {
    const v = o.dataset.f; f.page = 1;
    if (v.startsWith('p_')) f.prod = (f.prod === v.slice(2) ? null : v.slice(2));
    else if (['FRESH', 'HISTORICAL', 'DATE_UNKNOWN', 'POST_WINDOW'].includes(v)) f.fresh = (f.fresh === v ? null : v);
    else if (jur.includes(v)) f.jur = (f.jur === v ? null : v);
    else if (layers.includes(v)) f.layer = (f.layer === v ? null : v);
    renderDocFilters(); refreshDocs();
  });
  document.getElementById('fd-clear').onclick = () => {
    Object.assign(LS.docs, { q: '', fresh: null, jur: null, layer: null, prod: null, page: 1, sort: 'date', dir: 'desc' });
    renderDocuments(document.getElementById('app'));
  };
}

function refreshDocs() {
  const all = docFiltered();
  const sorted = docSort(all);
  renderDocMain(sorted);
  const c = document.querySelector('.view-count');
  if (c) c.textContent = all.length.toLocaleString('en-GB') + ' of ' + D.documents.length + ' documents';
}

function renderDocMain(sorted) {
  const f = LS.docs;
  const main = document.getElementById('docs-main');
  const per = f.per;
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  if (f.page > pages) f.page = pages;
  const slice = sorted.slice((f.page - 1) * per, f.page * per);

  let html = '<div class="note" style="margin-bottom:12px"><b>Document identity.</b> Core does not yet extract document titles. ' +
    'Documents are identified by their canonical URL and document id, exactly as committed. ' +
    'Search matches URL, institution, source, jurisdiction, text layer and date.</div>';
  const th = (key, label, cls) =>
    '<th class="sortable ' + (cls || '') + '" data-sk="' + key + '">' + label +
    (f.sort === key ? '<span class="arr">' + (f.dir === 'asc' ? '&#9650;' : '&#9660;') + '</span>' : '') + '</th>';

  html += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    th('date', 'DATE') + th('inst', 'INSTITUTION') + th('layer', 'TYPE') +
    th('fresh', 'TEMPORAL') + th('facts', 'FACTS', 'num-col') + th('ios', 'IOS', 'num-col') + th('src', 'SOURCE') +
    '</tr></thead><tbody>';
  slice.forEach(d => {
    const src = IX.srcs[d.source_id] || {};
    html += '<tr class="rowlink" data-go="#/documents/' + d.document_id + '">' +
      '<td class="mono">' + (d.best_iso ? esc(d.best_iso) : '<span class="dim">—</span>') + '</td>' +
      '<td class="t-strong ellip" title="' + esc(src.institution_name || '') + '">' + esc(src.institution_name || d.source_id) + '</td>' +
      '<td class="dim">' + esc(d.text_layer) + '</td>' +
      '<td>' + bStatus(d.fresh_status) + '</td>' +
      '<td class="num-col"><span class="num' + (d.n_facts > 0 ? ' hot' : '') + '">' + d.n_facts + '</span></td>' +
      '<td class="num-col"><span class="num' + (d.n_intelligence > 0 ? ' hot' : '') + '">' + d.n_intelligence + '</span></td>' +
      '<td class="mono dim ellip" title="' + esc(d.source_id) + '">' + esc(d.source_id) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  if (!slice.length) html += emptyRegistry('document');
  html += pager(sorted.length, f.page, per, pages, 'docs');
  main.innerHTML = html;
  bindGo(main);
  wirePager('docs', () => refreshDocs());
  main.querySelectorAll('th.sortable').forEach(t => t.onclick = () => {
    const k = t.dataset.sk;
    if (f.sort === k) f.dir = (f.dir === 'asc' ? 'desc' : 'asc');
    else { f.sort = k; f.dir = (k === 'facts' || k === 'ios' || k === 'date') ? 'desc' : 'asc'; }
    refreshDocs();
  });
}

/* ============================================================ DOCUMENT DETAIL */

function viewDocDetail(app, docId) {
  const d = IX.docs[docId];
  if (!d) { app.innerHTML = notFound('Document', docId, '#/documents'); return; }
  const src = IX.srcs[d.source_id] || null;
  const ios = D.intelligence.filter(io => (io.chain || []).some(c => c.document_id === docId));
  const facts = FACTS.filter(f => f.document_id === docId);

  let html = '' +
    '<div class="crumb"><a href="#/documents">DOCUMENTS</a><span class="sep">/</span><span class="mono">' + esc(d.document_id) + '</span></div>' +

    '<div class="io-head">' +
      '<div class="io-kind">DOCUMENT</div>' +
      '<div class="io-inst" style="font-size:15px;font-family:var(--mono);overflow-wrap:anywhere">' + esc(d.canonical_url || d.document_id) + '</div>' +
      '<div class="io-sub">' + bStatus(d.fresh_status) + (src ? bOfficial(src) : '') +
        (d.n_intelligence > 0 ? bEvidence(facts.length) : '') + '</div>' +
      '<div class="io-actions">' +
        (d.canonical_url ? '<a class="btn primary" href="' + esc(d.canonical_url) + '" target="_blank" rel="noopener">OPEN ORIGINAL DOCUMENT</a>' : '') +
        (src ? '<a class="btn" href="#/sources/' + esc(src.source_id) + '">SOURCE PROFILE</a>' : '') +
        (facts.length ? '<a class="btn" href="#/facts?doc=' + esc(d.document_id) + '">VIEW FACTS (' + facts.length + ')</a>' : '') +
      '</div>' +
    '</div>' +

    '<div class="section"><div class="section-title">DOCUMENT METADATA</div>' +
    '<div class="meta-grid">' +
      mcell('Document identifier', '<span class="mono">' + esc(d.document_id) + '</span>') +
      mcell('Institution', esc(src ? src.institution_name : 'Not available')) +
      mcell('Document type', 'Not available <span class="dim">(Core stores text layer: ' + esc(d.text_layer) + ')</span>') +
      mcell('Publication date', d.best_iso ? fmtDate(d.best_iso) : na(null)) +
      mcell('Jurisdiction', esc(src ? src.jurisdiction + ' (' + src.region + ')' : 'Not available')) +
      mcell('Source', esc(src ? src.institution_name + ' · ' + src.official_domain : d.source_id)) +
      mcell('Facts extracted', num(d.n_facts)) +
      mcell('Intelligence objects', num(d.n_intelligence)) +
      mcell('Status', esc(d.status)) +
      mcell('Usable (stored)', d.usable === 'True' ? 'Yes' : 'No') +
      mcell('Text layer', esc(d.text_layer) + (d.text_chars ? ' · ' + Number(d.text_chars).toLocaleString('en-GB') + ' chars' : '')) +
      mcell('Acquisition', d.new_document === 'True' ? 'First claim this wave' : 'Known from earlier wave') +
    '</div></div>';

  if (ios.length) {
    html += '<div class="section"><div class="section-title">INTELLIGENCE OBJECTS FROM THIS DOCUMENT <span class="sub">' +
      ios.length + ' object' + (ios.length === 1 ? '' : 's') + '</span></div>';
    ios.forEach(io => {
      html += '<div class="feed-row" data-go="#/intelligence/' + io.io_id + '">' +
        '<div class="f-left">' + bStatus(io.date_status) +
        '<span class="f-inst ellip">' + esc(io.institution_name) + '</span></div>' +
        '<div class="f-right"><span class="f-facts"><span class="num">' + (io.chain || []).length + '</span> linked facts</span>' +
        '<span class="f-open">OPEN &rarr;</span></div></div>';
    });
    html += '</div>';
  } else {
    html += '<div class="section"><div class="section-title">INTELLIGENCE OBJECTS</div>' +
      '<div class="note">This document produced no intelligence objects in this snapshot. ' +
      'It is stored and searchable, but extraction yielded no IO-bound facts.</div></div>';
  }

  html += '<div class="section"><div class="section-title">TECHNICAL PROVENANCE</div>' +
    '<div class="meta-grid">' +
      mcell('Canonical URL', d.canonical_url ? '<a href="' + esc(d.canonical_url) + '" target="_blank" rel="noopener">' + esc(d.canonical_url) + '</a>' : na(null)) +
      mcell('Source identifier', '<span class="mono">' + esc(d.source_id) + '</span>') +
      mcell('Freshness basis', esc(d.fresh_status)) +
    '</div></div>';

  app.innerHTML = html;
  bindGo(app);
}

/* ============================================================ FACTS EXPLORER */

function factFiltered() {
  const f = LS.facts;
  const q = lower(f.q.trim());
  return FACTS.filter(x => {
    if (f.metric && x.metric !== f.metric) return false;
    if (f.tstat && x.date_status !== f.tstat) return false;
    if (f.sector && x.sector_label !== f.sector) return false;
    if (f.src && x.source_id !== f.src) return false;
    if (f.doc && x.document_id !== f.doc) return false;
    if (f.inst.trim() && lower(x.institution).indexOf(lower(f.inst.trim())) === -1) return false;
    if (q && x._lc.indexOf(q) === -1) return false;
    return true;
  });
}
function factSort(arr) {
  const f = LS.facts;
  const dir = f.dir === 'asc' ? 1 : -1;
  const by = {
    metric: (a, b) => String(a.metric).localeCompare(String(b.metric)) * dir,
    value: (a, b) => String(a.value).localeCompare(String(b.value)) * dir,
    inst: (a, b) => a.institution.localeCompare(b.institution) * dir,
    doc: (a, b) => String(a.document_id).localeCompare(String(b.document_id)) * dir,
    src: (a, b) => String(a.source_id).localeCompare(String(b.source_id)) * dir,
    tstat: (a, b) => statusRank(a.date_status) - statusRank(b.date_status),
  }[f.sort] || null;
  return by ? arr.slice().sort(by) : arr.slice();
}

function viewFacts(app, query) {
  /* deep links are deterministic: reset list filters, then apply the query param */
  if (query.src || query.doc) {
    Object.assign(LS.facts, { q: '', metric: null, tstat: null, sector: null, inst: '', src: null, doc: null, page: 1 });
    if (query.src) LS.facts.src = query.src;
    if (query.doc) LS.facts.doc = query.doc;
  }
  LS.facts.page = 1;
  renderFacts(app);
}
function renderFacts(app) {
  let html = '' +
    '<div class="view-head">' +
      '<div class="view-title">FACTS</div>' +
      '<div class="view-count" id="facts-count"></div>' +
    '</div>' +
    '<div class="cols"><div class="col-main" id="facts-main"></div>' +
    '<div class="col-side"><div class="panel filter-panel"><div class="panel-head"><span class="panel-label">FILTERS</span>' +
    '<span class="panel-meta">' + FACTS.length.toLocaleString('en-GB') + ' total</span></div><div class="panel-body" id="facts-filters"></div></div></div></div>';
  app.innerHTML = html;
  renderFactFilters();
  refreshFacts();
}

function renderFactFilters() {
  const f = LS.facts;
  const el = document.getElementById('facts-filters');
  const metrics = uniq(FACTS.map(x => x.metric));
  const sectors = uniq(FACTS.map(x => x.sector_label));

  el.innerHTML =
    fg('Search', '<input type="text" id="ff-q" placeholder="value, description, institution..." value="' + esc(f.q) + '">') +
    fg('Institution', '<input type="text" id="ff-inst" placeholder="contains..." value="' + esc(f.inst) + '">') +
    fg('Metric', '<div class="opts">' + metrics.map(v => '<span class="fopt' + (f.metric === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>') +
    fg('Temporal status', '<div class="opts">' + ['FRESH', 'HISTORICAL', 'UNDATED'].map(v =>
      '<span class="fopt' + (f.tstat === v ? ' on' : '') + '" data-f="' + v + '">' + v + '</span>').join('') + '</div>') +
    fg('Sector', '<div class="opts">' + sectors.map(v => '<span class="fopt' + (f.sector === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>') +
    (f.src ? fg('Source (linked)', '<div class="opts"><span class="fopt on" data-f="__src__">' + esc(f.src) + '</span></div>') : '') +
    (f.doc ? fg('Document (linked)', '<div class="opts"><span class="fopt on" data-f="__doc__">' + esc(f.doc) + '</span></div>') : '') +
    '<div class="fgroup"><button class="btn sm" id="ff-clear">CLEAR ALL FILTERS</button></div>';

  const qEl = document.getElementById('ff-q');
  qEl.oninput = () => { f.q = qEl.value; f.page = 1; refreshFacts(); };
  const iEl = document.getElementById('ff-inst');
  iEl.oninput = () => { f.inst = iEl.value; f.page = 1; refreshFacts(); };
  el.querySelectorAll('.fopt').forEach(o => o.onclick = () => {
    const v = o.dataset.f; f.page = 1;
    if (v === '__src__') { f.src = null; }
    else if (v === '__doc__') { f.doc = null; }
    else if (['FRESH', 'HISTORICAL', 'UNDATED'].includes(v)) f.tstat = (f.tstat === v ? null : v);
    else if (metrics.includes(v)) f.metric = (f.metric === v ? null : v);
    else if (sectors.includes(v)) f.sector = (f.sector === v ? null : v);
    renderFactFilters(); refreshFacts();
  });
  document.getElementById('ff-clear').onclick = () => {
    Object.assign(LS.facts, { q: '', metric: null, tstat: null, sector: null, inst: '', src: null, doc: null, page: 1 });
    renderFacts(document.getElementById('app'));
  };
}

function refreshFacts() {
  const f = LS.facts;
  const all = factFiltered();
  const sorted = factSort(all);
  const main = document.getElementById('facts-main');
  const per = f.per;
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  if (f.page > pages) f.page = pages;
  const slice = sorted.slice((f.page - 1) * per, f.page * per);

  const c = document.getElementById('facts-count');
  if (c) c.textContent = all.length.toLocaleString('en-GB') + ' of ' + FACTS.length.toLocaleString('en-GB') +
    ' IO-bound facts (snapshot holds ' + D.meta.counts.facts.toLocaleString('en-GB') + ' facts total; ' +
    (D.meta.counts.facts - FACTS.length).toLocaleString('en-GB') + ' are not bound to an intelligence object)';

  const th = (key, label) =>
    '<th class="sortable" data-sk="' + key + '">' + label +
    (f.sort === key ? '<span class="arr">' + (f.dir === 'asc' ? '&#9650;' : '&#9660;') + '</span>' : '') + '</th>';

  let html = '<div class="note" style="margin-bottom:12px"><b>Schema note.</b> UNIT and PERIOD are not yet produced by ROUAA Core. ' +
    'The columns are reserved (shown as &ldquo;—&rdquo;) and will populate when Core attaches them. ' +
    'All other values are verbatim from the committed snapshot.</div>';
  html += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    th('metric', 'FACT') + '<th>VALUE</th><th>UNIT</th><th>PERIOD</th><th>DESCRIPTION</th>' +
    th('inst', 'INSTITUTION') + th('doc', 'DOCUMENT') + th('src', 'SOURCE') +
    th('tstat', 'TEMPORAL') + '<th>EVIDENCE</th>' +
    '</tr></thead><tbody>';
  slice.forEach(x => {
    html += '<tr>' +
      '<td class="mono">' + esc(x.metric) + '</td>' +
      '<td class="mono t-strong" style="color:var(--accent)">' + esc(x.value) + '</td>' +
      '<td>' + nDash() + '</td><td>' + nDash() + '</td>' +
      '<td class="ellip" title="' + esc(x.raw_value) + '">' + esc(x.raw_value) + '</td>' +
      '<td class="ellip">' + esc(x.institution) + '</td>' +
      '<td class="mono dim">' + esc(x.document_id.slice(0, 12)) + '…</td>' +
      '<td class="mono dim ellip" title="' + esc(x.source_id) + '">' + esc(x.source_id) + '</td>' +
      '<td>' + bStatus(x.date_status) + '</td>' +
      '<td><a class="btn sm" href="#/evidence/' + x.io_id + '/' + esc(x.fact_id) + '">VIEW</a></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  if (!slice.length) html += emptyRegistry('fact');
  html += pager(sorted.length, f.page, per, pages, 'facts');
  main.innerHTML = html;
  wirePager('facts', () => refreshFacts());
  main.querySelectorAll('th.sortable').forEach(t => t.onclick = () => {
    const k = t.dataset.sk;
    if (f.sort === k) f.dir = (f.dir === 'asc' ? 'desc' : 'asc');
    else { f.sort = k; f.dir = 'asc'; }
    refreshFacts();
  });
}

/* ============================================================ SOURCES (list) */

function srcFiltered() {
  const f = LS.sources;
  const q = lower(f.q.trim());
  return D.sources.filter(s => {
    if (f.jur && s.jurisdiction !== f.jur) return false;
    if (f.auth && s.authority_type !== f.auth) return false;
    if (f.sector && s.sector_label !== f.sector) return false;
    if (f.prod === 'yes' && !(s.unique_vio > 0)) return false;
    if (f.prod === 'no' && (s.unique_vio > 0)) return false;
    if (q && lower(s.institution_name + ' ' + s.official_domain + ' ' + s.jurisdiction + ' ' + s.source_id + ' ' + s.sector_label).indexOf(q) === -1) return false;
    return true;
  });
}
function srcSort(arr) {
  const f = LS.sources;
  const dir = f.dir === 'asc' ? 1 : -1;
  const by = {
    inst: (a, b) => a.institution_name.localeCompare(b.institution_name) * dir,
    jur: (a, b) => String(a.jurisdiction).localeCompare(String(b.jurisdiction)) * dir,
    auth: (a, b) => String(a.authority_type).localeCompare(String(b.authority_type)) * dir,
    docs: (a, b) => ((a.documents_acquired || 0) - (b.documents_acquired || 0)) * dir,
    facts: (a, b) => ((a.facts || 0) - (b.facts || 0)) * dir,
    ios: (a, b) => ((a.unique_vio || 0) - (b.unique_vio || 0)) * dir,
    fresh: (a, b) => ((a.fresh_vio || 0) - (b.fresh_vio || 0)) * dir,
  }[f.sort] || null;
  return by ? arr.slice().sort(by) : arr.slice();
}

function viewSources(app) {
  LS.sources.page = 1;
  renderSources(app);
}
function renderSources(app) {
  let html = '' +
    '<div class="view-head">' +
      '<div class="view-title">SOURCES</div>' +
      '<div class="view-count" id="src-count"></div>' +
    '</div>' +
    '<div class="cols"><div class="col-main" id="src-main"></div>' +
    '<div class="col-side"><div class="panel filter-panel"><div class="panel-head"><span class="panel-label">FILTERS</span>' +
    '<span class="panel-meta">' + D.sources.length + ' total</span></div><div class="panel-body" id="src-filters"></div></div></div></div>';
  app.innerHTML = html;
  renderSrcFilters();
  refreshSources();
}

function renderSrcFilters() {
  const f = LS.sources;
  const el = document.getElementById('src-filters');
  const jur = uniq(D.sources.map(s => s.jurisdiction));
  const auth = uniq(D.sources.map(s => s.authority_type));
  const sector = uniq(D.sources.map(s => s.sector_label));

  el.innerHTML =
    fg('Search', '<input type="text" id="fs-q" placeholder="institution, domain..." value="' + esc(f.q) + '">') +
    fg('Jurisdiction', '<div class="opts">' + jur.map(v => '<span class="fopt' + (f.jur === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>') +
    fg('Authority type', '<div class="opts">' + auth.map(v => '<span class="fopt' + (f.auth === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>') +
    fg('Sector', '<div class="opts">' + sector.map(v => '<span class="fopt' + (f.sector === v ? ' on' : '') + '" data-f="' + esc(v) + '">' + esc(v) + '</span>').join('') + '</div>') +
    fg('Intelligence production', '<div class="opts">' + ['yes', 'no'].map(v =>
      '<span class="fopt' + (f.prod === v ? ' on' : '') + '" data-f="p_' + v + '">' +
      (v === 'yes' ? 'VIO-producing (42)' : 'Registered, not yet productive') + '</span>').join('') + '</div>') +
    '<div class="fgroup"><button class="btn sm" id="fs-clear">CLEAR ALL FILTERS</button></div>';

  const qEl = document.getElementById('fs-q');
  qEl.oninput = () => { f.q = qEl.value; f.page = 1; refreshSources(); };
  el.querySelectorAll('.fopt').forEach(o => o.onclick = () => {
    const v = o.dataset.f; f.page = 1;
    if (v.startsWith('p_')) f.prod = (f.prod === v.slice(2) ? null : v.slice(2));
    else if (jur.includes(v)) f.jur = (f.jur === v ? null : v);
    else if (auth.includes(v)) f.auth = (f.auth === v ? null : v);
    else if (sector.includes(v)) f.sector = (f.sector === v ? null : v);
    renderSrcFilters(); refreshSources();
  });
  document.getElementById('fs-clear').onclick = () => {
    Object.assign(LS.sources, { q: '', jur: null, auth: null, sector: null, prod: null, page: 1 });
    renderSources(document.getElementById('app'));
  };
}

function refreshSources() {
  const f = LS.sources;
  const all = srcFiltered();
  const sorted = srcSort(all);
  const main = document.getElementById('src-main');
  const per = f.per;
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  if (f.page > pages) f.page = pages;
  const slice = sorted.slice((f.page - 1) * per, f.page * per);

  const c = document.getElementById('src-count');
  if (c) c.textContent = all.length + ' of ' + D.sources.length + ' registered official sources · ' +
    D.sources.filter(s => s.unique_vio > 0).length + ' produced verified intelligence this wave';

  const th = (key, label, cls) =>
    '<th class="sortable ' + (cls || '') + '" data-sk="' + key + '">' + label +
    (f.sort === key ? '<span class="arr">' + (f.dir === 'asc' ? '&#9650;' : '&#9660;') + '</span>' : '') + '</th>';

  let html = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    th('inst', 'INSTITUTION') + th('jur', 'JURISDICTION') + th('auth', 'AUTHORITY') +
    th('docs', 'DOCS', 'num-col') + th('facts', 'FACTS', 'num-col') + th('ios', 'IOS', 'num-col') + th('fresh', 'FRESH IOS', 'num-col') + '<th>ACCESS</th>' +
    '</tr></thead><tbody>';
  slice.forEach(s => {
    html += '<tr class="rowlink" data-go="#/sources/' + esc(s.source_id) + '">' +
      '<td class="t-strong ellip" title="' + esc(s.institution_name) + '">' + esc(s.institution_name) + '</td>' +
      '<td class="mono">' + esc(s.jurisdiction) + '</td>' +
      '<td class="dim">' + esc(s.authority_type) + '</td>' +
      '<td class="num-col"><span class="num">' + num(s.documents_acquired) + '</span></td>' +
      '<td class="num-col"><span class="num' + (s.facts > 0 ? ' hot' : '') + '">' + num(s.facts) + '</span></td>' +
      '<td class="num-col"><span class="num' + (s.unique_vio > 0 ? ' hot' : '') + '">' + num(s.unique_vio) + '</span></td>' +
      '<td class="num-col"><span class="num">' + num(s.fresh_vio) + '</span></td>' +
      '<td class="dim mono">' + esc(s.access_status) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  if (!slice.length) html += emptyRegistry('source');
  html += pager(sorted.length, f.page, per, pages, 'sources');
  main.innerHTML = html;
  bindGo(main);
  wirePager('sources', () => refreshSources());
  main.querySelectorAll('th.sortable').forEach(t => t.onclick = () => {
    const k = t.dataset.sk;
    if (f.sort === k) f.dir = (f.dir === 'asc' ? 'desc' : 'asc');
    else { f.sort = k; f.dir = (k === 'inst' || k === 'jur' || k === 'auth') ? 'asc' : 'desc'; }
    refreshSources();
  });
}

/* ============================================================ SOURCE PROFILE */

function viewSourceDetail(app, srcId) {
  const s = IX.srcs[srcId];
  if (!s) { app.innerHTML = notFound('Source', srcId, '#/sources'); return; }
  const docs = D.documents.filter(d => d.source_id === srcId);
  const facts = FACTS.filter(f => f.source_id === srcId);
  const ios = D.intelligence.filter(io => io.source_id === srcId);
  const st = SRC_STATS[srcId] || {};
  const undated = ios.filter(io => io.date_status === 'UNDATED').length;
  const productive = (s.unique_vio || 0) > 0;

  let html = '' +
    '<div class="crumb"><a href="#/sources">SOURCES</a><span class="sep">/</span><span class="mono">' + esc(s.source_id) + '</span></div>' +

    '<div class="io-head">' +
      '<div class="io-kind">SOURCE PROFILE</div>' +
      '<div class="io-inst">' + esc(s.institution_name) + '</div>' +
      '<div class="io-sub">' + bOfficial(s) +
        (productive ? '<span class="badge b-accent" title="Produced ' + s.unique_vio + ' verified intelligence object(s) this wave">VIO-PRODUCING</span>' :
          '<span class="badge b-undated" title="Registered official source — no verified intelligence object produced this wave">REGISTERED · NOT YET PRODUCTIVE</span>') +
      '</div>' +
      '<div class="io-actions">' +
        '<a class="btn primary" href="' + esc(s.canonical_source_url || s.endpoint) + '" target="_blank" rel="noopener">OPEN OFFICIAL SOURCE</a>' +
        (docs.length ? '<a class="btn" href="#/facts?src=' + esc(s.source_id) + '">VIEW FACTS (' + facts.length + ')</a>' : '') +
      '</div>' +
      '<div class="io-ids">' +
        'jurisdiction <b>' + esc(s.jurisdiction) + '</b> (' + esc(s.region) + ') &nbsp;·&nbsp; sector <b>' + esc(s.sector_label) + '</b>' +
        ' &nbsp;·&nbsp; language <b>' + esc(s.language) + '</b> &nbsp;·&nbsp; cohort <b>' + esc(s.cohort) + '</b>' +
        ' &nbsp;·&nbsp; discovered via <b>' + esc(s.discovery_method) + '</b><br>' +
        'endpoint kind <b>' + esc(s.endpoint_kind) + '</b> &nbsp;·&nbsp; pattern set <b>' + esc(s.pattern_set) + '</b>' +
        ' &nbsp;·&nbsp; selection reasons <b>' + esc((s.selection_reasons || []).join(', ') || '—') + '</b>' +
      '</div>' +
    '</div>' +

    /* --- SOURCE → DOCUMENT → FACT → INTELLIGENCE relationship --- */
    '<div class="section"><div class="section-title">SOURCE &rarr; DOCUMENT &rarr; FACT &rarr; INTELLIGENCE <span class="sub">the production chain of this source</span></div>' +
      '<div class="rel-strip">' +
        '<div class="rel-node" data-go="#/sources/' + esc(s.source_id) + '"><div class="rn-k">SOURCE</div><div class="rn-v">1</div><div class="rn-s">this profile</div></div>' +
        '<div class="rel-join">&rarr;</div>' +
        '<div class="rel-node" data-go="#/documents" ><div class="rn-k">DOCUMENTS</div><div class="rn-v' + (docs.length ? ' hot' : '') + '">' + docs.length + '</div><div class="rn-s">acquired &amp; stored</div></div>' +
        '<div class="rel-join">&rarr;</div>' +
        '<div class="rel-node" data-go="#/facts?src=' + esc(s.source_id) + '"><div class="rn-k">FACTS</div><div class="rn-v' + (facts.length ? ' hot' : '') + '">' + facts.length + '</div><div class="rn-s">IO-bound, evidence-linked</div></div>' +
        '<div class="rel-join">&rarr;</div>' +
        '<div class="rel-node" data-go="#/intelligence?src=' + esc(s.source_id) + '"><div class="rn-k">INTELLIGENCE</div><div class="rn-v' + (ios.length ? ' hot' : '') + '">' + ios.length + '</div><div class="rn-s">verified objects</div></div>' +
      '</div>' +
    '</div>' +

    /* --- metadata --- */
    '<div class="section"><div class="section-title">SOURCE METADATA</div>' +
    '<div class="meta-grid">' +
      mcell('Institution', esc(s.institution_name)) +
      mcell('Jurisdiction', esc(s.jurisdiction) + ' (' + esc(s.region) + ')') +
      mcell('Source type', esc(s.authority_type) + ' · ' + esc(s.authority_level)) +
      mcell('Official URL', '<a href="' + esc(s.canonical_source_url || s.endpoint) + '" target="_blank" rel="noopener">' + esc(s.endpoint) + '</a>') +
      mcell('Official domain', esc(s.official_domain)) +
      mcell('Sector', esc(s.sector_label)) +
      mcell('Access status', esc(s.access_status)) +
      mcell('Failure class', esc(s.failure_class)) +
      mcell('Production status (S-level)', esc(s.production_status)) +
      mcell('Latest publication date', s.latest_publication_date ? fmtDate(s.latest_publication_date) : na(null)) +
    '</div></div>' +

    /* --- production --- */
    '<div class="section"><div class="section-title">PRODUCTION</div>' +
    '<div class="meta-grid">' +
      mcell('Documents discovered', num(s.documents_discovered)) +
      mcell('Documents acquired', num(s.documents_acquired)) +
      mcell('Documents usable (stored)', num(s.documents_usable)) +
      mcell('Facts extracted', num(s.facts)) +
      mcell('Events', num(s.events)) +
      mcell('Candidate IOs', num(s.candidate_io)) +
      mcell('Unique verified IOs', num(s.unique_vio)) +
    '</div></div>' +

    /* --- freshness --- */
    '<div class="section"><div class="section-title">FRESHNESS <span class="sub">temporal classes of intelligence produced by this source</span></div>' +
    '<div class="meta-grid">' +
      mcell('Fresh IOs', bStatus('FRESH') + ' <span class="num">' + num(s.fresh_vio) + '</span>') +
      mcell('Historical IOs', bStatus('HISTORICAL') + ' <span class="num">' + num(s.historical_vio) + '</span>') +
      mcell('Undated IOs', bStatus('UNDATED') + ' <span class="num">' + num(undated) + '</span>') +
      mcell('Latest publication date', s.latest_publication_date ? esc(s.latest_publication_date) : na(null)) +
    '</div></div>' +

    /* --- evidence coverage --- */
    '<div class="section"><div class="section-title">EVIDENCE COVERAGE</div>' +
    '<div class="meta-grid">' +
      mcell('Facts bound to IOs', num(st.chain_facts || 0)) +
      mcell('Facts with evidence excerpt', num(st.evidence_facts || 0)) +
      mcell('Coverage', num(s.facts > 0 ? st.chain_facts : 0) + ' / ' + num(s.facts) +
        ' extracted facts are IO-bound with verbatim evidence' + (s.facts > 0 && st.chain_facts < s.facts ? ' — remainder stored but not IO-bound' : '')) +
    '</div></div>';

  /* --- intelligence objects from this source --- */
  if (ios.length) {
    html += '<div class="section"><div class="section-title">INTELLIGENCE OBJECTS <span class="sub">' + ios.length + ' from this source</span></div>';
    ios.forEach(io => {
      html += '<div class="feed-row" data-go="#/intelligence/' + io.io_id + '">' +
        '<div class="f-left">' + bStatus(io.date_status) +
        '<span class="f-inst ellip">' + esc(io.institution_name) + '</span></div>' +
        '<div class="f-right">' +
        (ioDateKey(io) ? '<span class="f-date">' + fmtDate(ioDateKey(io)) + '</span>' : '') +
        '<span class="f-facts"><span class="num">' + (io.chain || []).length + '</span> facts</span>' +
        '<span class="f-open">OPEN &rarr;</span></div></div>';
    });
    html += '</div>';
  } else {
    html += '<div class="section"><div class="section-title">INTELLIGENCE OBJECTS</div>' +
      '<div class="note">No verified intelligence objects produced by this source in this snapshot. ' +
      'Documents and extracted facts (if any) are stored and searchable.</div></div>';
  }

  /* --- documents table (this source) --- */
  if (docs.length) {
    html += '<div class="section"><div class="section-title">DOCUMENTS FROM THIS SOURCE <span class="sub">' + docs.length +
      ' — showing first 100</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>DATE</th><th>DOCUMENT</th><th>TEMPORAL</th><th class="num-col">FACTS</th><th class="num-col">IOS</th></tr></thead><tbody>';
    docs.slice(0, 100).forEach(d => {
      html += '<tr class="rowlink" data-go="#/documents/' + d.document_id + '">' +
        '<td class="mono">' + (d.best_iso ? esc(d.best_iso) : '<span class="dim">—</span>') + '</td>' +
        '<td class="mono dim ellip" title="' + esc(d.canonical_url) + '">' + esc(cleanUrl(d.canonical_url)) + '</td>' +
        '<td>' + bStatus(d.fresh_status) + '</td>' +
        '<td class="num-col"><span class="num">' + d.n_facts + '</span></td>' +
        '<td class="num-col"><span class="num">' + d.n_intelligence + '</span></td></tr>';
    });
    html += '</tbody></table></div>';
    if (docs.length > 100) html += '<div class="note" style="margin-top:8px">+' + (docs.length - 100) +
      ' further documents — open the DOCUMENTS section and filter by this source id: <span class="mono">' + esc(s.source_id) + '</span></div>';
    html += '</div>';
  }

  html += '<div class="section"><div class="section-title">TECHNICAL PROVENANCE</div>' +
    '<div class="meta-grid">' +
      mcell('Source identifier', '<span class="mono">' + esc(s.source_id) + '</span>') +
      mcell('Discovery status', '<span class="mono">' + esc(s.discovery_status) + '</span>') +
      mcell('Access status', esc(s.access_status)) +
      mcell('Production accounting class', esc(s.failure_class) + ' · S-level ' + esc(s.production_status)) +
    '</div></div>';

  app.innerHTML = html;
  bindGo(app);
}

/* ============================================================ PRODUCTION (demoted) */

function viewProduction(app) {
  const p = D.production;
  const a = p.accounting_summary;
  const sdefs = p.s_levels_definition || {};

  const kv = rows => '<div class="kv-list">' + rows.map(([k, v, hot]) =>
    '<div class="kv"><span class="k">' + k + '</span><span class="v' + (hot ? ' hot' : '') + '">' + v + '</span></div>').join('') + '</div>';

  let html = '' +
    '<div class="view-head">' +
      '<div class="view-title">PRODUCTION</div>' +
      '<div class="view-count">' + esc(p.wave_name) + ' · executed ' + esc(p.executed_at) + '</div>' +
    '</div>' +

    '<div class="note" style="margin-bottom:14px"><b>Position of this section.</b> Production accounting exists for transparency about what Core ' +
    'actually ran and produced. It is deliberately demoted from the front page: institutional users consume intelligence first, ' +
    'production mechanics last. All figures are committed Core accounting — none are computed by the interface.</div>' +

    '<div class="prod-grid">' +
      '<div class="panel"><div class="panel-head"><span class="panel-label">WAVE ACCOUNTING</span></div>' +
        kv([
          ['Population (registered sources', a.population],
          ['Access OK', a.access_ok],
          ['Documents acquired', a.documents_acquired],
          ['Documents first claim', a.documents_first_claim],
          ['Documents usable (stored)', a.documents_usable],
          ['Facts run', a.facts_run.toLocaleString('en-GB')],
          ['Facts new', a.facts_new.toLocaleString('en-GB'), true],
          ['VIO candidates', a.vio_candidate],
          ['VIO verified', a.vio_verified, true],
          ['VIO unique net-new', a.vio_unique_new],
          ['VIO fresh', a.vio_fresh],
          ['VIO historical', a.vio_historical],
          ['VIO-producing sources', a.productive_sources_vio_basis, true],
          ['Source universe after wave', a.universe_after.toLocaleString('en-GB')],
          ['Runtime (s)', a.runtime_seconds],
        ]) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">FRESHNESS LADDER (VIO)</span></div>' +
        kv([
          ['Fresh (in window)', a.vio_fresh + ' <span class="badge b-fresh">FRESH</span>'],
          ['Historical (dated)', a.vio_historical + ' <span class="badge b-historical">HISTORICAL</span>'],
          ['Undated', (a.vio_verified - a.vio_fresh - a.vio_historical) + ' <span class="badge b-undated">UNDATED</span>'],
        ]) +
        '<div class="panel-body"><div class="dim" style="font-size:11px">Frozen fresh window ' + esc(D.meta.fresh_window.start) +
        ' &rarr; ' + esc(D.meta.fresh_window.end) + '. Retrieval time is never used as publication time (Core V2 temporal rule).</div></div></div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">VERIFICATION</span>' +
        '<span class="panel-meta">' + (p.verification.V1_identity_chain.pass === p.verification.V1_identity_chain.checked &&
          p.verification.V2_temporal.pass === true && p.verification.V3_dedup.pass === true && p.verification.V4_contamination.pass === true
          ? 'ALL PASS' : 'SEE NOTES') + '</span></div>' +
        kv([
          ['V1 identity chain', p.verification.V1_identity_chain.pass + ' / ' + p.verification.V1_identity_chain.checked],
          ['V2 temporal', p.verification.V2_temporal.pass ? 'PASS' : 'FAIL'],
          ['V3 dedup', p.verification.V3_dedup.pass ? 'PASS' : 'FAIL' + ' · overlaps ' + p.verification.V3_dedup.overlaps],
          ['V4 contamination', p.verification.V4_contamination.pass ? 'PASS' : 'FAIL'],
          ['Contamination excluded', 'facts ' + a.contamination_excluded.facts + ' · events ' + a.contamination_excluded.events +
            ' · IOs ' + a.contamination_excluded.ios],
        ]) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">SOURCE PIPELINE STAGES (S-LEVELS)</span>' +
        '<span class="panel-meta">' + a.population + ' sources</span></div>' +
        kv(Object.entries(sdefs).map(([k, def]) => ['S' === k[0] ? k + ' — ' + def : k, a.s_levels[k] ?? 0])) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">FAILURE / OUTCOME CLASSES (Z)</span></div>' +
        kv(Object.entries(a.z_classes).map(([k, v]) => [k, v])) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">DEFINITIONS</span></div><div class="panel-body">' +
        '<div style="font-size:11.5px;color:var(--fg-2);line-height:1.7">' +
        '<b style="color:var(--fg)">Discovered</b> — documents found by the discovery crawler on an accessible source (documents_discovered).<br>' +
        '<b style="color:var(--fg)">Acquired</b> — documents fetched and committed to the store (documents_acquired; first claim = never seen in earlier waves).<br>' +
        '<b style="color:var(--fg)">Stored / usable</b> — acquired documents with a usable text layer for extraction (documents_usable).<br>' +
        '<b style="color:var(--fg)">Productive</b> — a source that produced at least one verified intelligence object this wave (' +
        a.productive_sources_vio_basis + ' of ' + a.population + ').<br>' +
        '<b style="color:var(--fg)">FRESH / HISTORICAL / UNDATED</b> — temporal classes of intelligence objects; ' +
        'freshness is attributed from committed publication metadata only, never from retrieval time.' +
        '</div></div></div>' +
    '</div>';

  app.innerHTML = html;
}

/* ============================================================ SEARCH PAGE */

function viewSearch(app, q) {
  const input = document.getElementById('gsearch-input');
  if (input && !q) { q = input.value; }
  document.title = q ? 'Search: ' + q + ' — ROUAA' : 'Search — ROUAA';

  let html = '' +
    '<div class="view-head"><div class="view-title">SEARCH</div>' +
    '<div class="view-count">query: <span class="mono">' + esc(q) + '</span></div></div>';

  if (!q) {
    html += '<div class="note">Type a query in the global search bar (top). Search covers intelligence objects, documents, facts and sources.</div>';
    app.innerHTML = html; return;
  }

  /* full result sets, not the 4-row preview */
  const t = lower(q.trim());
  const has = s => lower(s).indexOf(t) !== -1;
  const intelAll = D.intelligence.filter(io => has(io.institution_name + ' ' + io.event_type_label + ' ' + io.jurisdiction + ' ' + io.sector_label + ' ' + io.headline + ' ' + io.io_id));
  const docsAll = D.documents.filter(d => has(d.canonical_url + ' ' + d.document_id + ' ' + ((IX.srcs[d.source_id] || {}).institution_name || '') + ' ' + d.source_id));
  const factsAll = FACTS.filter(f => f._lc.indexOf(t) !== -1);
  const srcsAll = D.sources.filter(s => has(s.institution_name + ' ' + s.official_domain + ' ' + s.jurisdiction + ' ' + s.source_id + ' ' + s.sector_label));
  const total = intelAll.length + docsAll.length + factsAll.length + srcsAll.length;

  html += '<div class="note" style="margin-bottom:16px"><b>' + total.toLocaleString('en-GB') + ' result' + (total === 1 ? '' : 's') +
    '</b> across this snapshot — INTELLIGENCE ' + intelAll.length + ' · DOCUMENTS ' + docsAll.length +
    ' · FACTS ' + factsAll.length + ' · SOURCES ' + srcsAll.length + '. Results contain only committed objects; nothing is synthesized.</div>';

  const section = (label, arr, render, cap) => {
    if (!arr.length) return;
    html += '<div class="sr-cat"><div class="section-title">' + label + ' <span class="sub">' + arr.length + ' result' + (arr.length === 1 ? '' : 's') + '</span></div>';
    arr.slice(0, cap || 50).forEach(it => { html += render(it); });
    if (arr.length > (cap || 50)) html += '<div class="note" style="margin-top:8px">+' + (arr.length - (cap || 50)) + ' more — refine the query or use section filters.</div>';
    html += '</div>';
  };

  section('INTELLIGENCE', intelAll, io =>
    '<div class="sr-row" data-go="#/intelligence/' + io.io_id + '">' + bStatus(io.date_status) +
    '<span class="sr-t ellip">' + esc(io.institution_name) + ' — ' + esc(io.event_type_label) + '</span>' +
    '<span class="sr-m">' + esc(io.jurisdiction) + ' · ' + io.n_facts + ' facts</span></div>');
  section('DOCUMENTS', docsAll, d =>
    '<div class="sr-row" data-go="#/documents/' + d.document_id + '">' +
    '<span class="sr-t ellip mono" style="font-size:11px">' + esc(cleanUrl(d.canonical_url)) + '</span>' +
    '<span class="sr-m">' + esc((IX.srcs[d.source_id] || {}).institution_name || d.source_id) + '</span></div>');
  section('FACTS', factsAll, f =>
    '<div class="sr-row" data-go="#/evidence/' + f.io_id + '/' + f.fact_id + '">' +
    '<span class="sr-t ellip"><span class="mono" style="color:var(--accent)">' + esc(f.value) + '</span> — ' + esc(String(f.raw_value).slice(0, 90)) + '</span>' +
    '<span class="sr-m">' + esc(f.metric) + ' · ' + esc(f.institution) + '</span></div>', 50);
  section('SOURCES', srcsAll, s =>
    '<div class="sr-row" data-go="#/sources/' + s.source_id + '">' +
    '<span class="sr-t ellip">' + esc(s.institution_name) + '</span>' +
    '<span class="sr-m">' + esc(s.jurisdiction) + ' · ' + (s.unique_vio || 0) + ' IOs</span></div>');

  if (!total) html += '<div class="note">No committed object matches this query. The interface does not synthesize or approximate results.</div>';

  app.innerHTML = html;
  bindGo(app);
}

/* ============================================================ OBSERVATORY (live)
   FRONTEND LIVE OBSERVATORY INTEGRATION V1 — a real read window onto
   ROUAA Core Production Observation API. Every number rendered here is
   consumed from the live /production/* response via OBS — never from a
   constant, never recomputed, never invented. Unavailable = stated. */

const OBSP = { per: 25, page: 1 };   /* transient ledger pagination state */

function obsNum(v) {
  if (v === null || v === undefined) return '<span class="na" title="Not provided by the Observation API for this run">NOT AVAILABLE</span>';
  if (typeof v === 'number') return v.toLocaleString('en-GB');
  return esc(String(v));
}
function obsBool(v) {
  if (v === true) return '<span class="obs-ok">YES</span>';
  if (v === false) return '<span class="obs-no">NO</span>';
  return '<span class="na">NOT AVAILABLE</span>';
}
/* string-valued live fields: absent means absent — stated, never blank-ambiguous */
function obsStr(v) {
  return (v === null || v === undefined || v === '') ? '<span class="na">NOT AVAILABLE</span>' : esc(v);
}
function obsStatusBadge(st) {
  if (st == null) return '<span class="na">NOT AVAILABLE</span>';
  const cls = st === 'COMPLETED' ? 'b-fresh' : (st === 'RUNNING' ? 'b-historical' : 'b-undated');
  return '<span class="badge ' + cls + '">' + esc(st) + '</span>';
}
function obsKV(rows) {
  return '<div class="kv-list">' + rows.map(([path, k, v, hot]) =>
    '<div class="kv"><span class="k">' + k + '</span><span class="v' + (hot ? ' hot' : '') + '"' +
    (path ? ' data-obsf="' + path + '"' : '') + '>' + v + '</span></div>').join('') + '</div>';
}
function obsConnLine() {
  const s = OBS.state;
  const dot = s.phase === 'LIVE' ? 'live' : (s.phase === 'IDLE' ? 'idle' : 'dead');
  const label = s.phase === 'LIVE' ? 'LIVE' : (s.phase === 'IDLE' ? 'CONNECTING' : (s.phase === 'UNREACHABLE' ? 'NOT REACHABLE' : 'API ERROR'));
  let tail = '';
  if (s.http != null) tail += ' · HTTP ' + s.http;
  if (s.status_code) tail += ' · ' + esc(s.status_code);
  if (s.fetched_at) tail += ' · fetched ' + esc(fmtDateTime(s.fetched_at.toISOString ? s.fetched_at.toISOString() : String(s.fetched_at)));
  return '<div class="obs-conn ' + (s.phase === 'LIVE' ? 'ok' : 'bad') + '">' +
    '<span class="obs-dot ' + dot + '"></span><b>' + label + '</b>' +
    '<span class="obs-conn-base mono" title="Production Observation API base URL — every /production/* read goes through the OBS client">' + esc(OBS.base) + '</span>' +
    '<span class="obs-conn-tail">' + tail + '</span>' +
    '<span class="obs-conn-ro">READ-ONLY · GET ONLY</span></div>';
}
function obsUnavailable(app, err, what) {
  app.innerHTML =
    '<div class="view-head"><div class="view-title">OBSERVATORY</div>' +
    '<div class="view-count">live production observation</div></div>' +
    obsConnLine() +
    '<div class="note" style="margin:14px 0"><b>OBSERVATION API NOT AVAILABLE — ' + esc(what) + '.</b> ' +
    'The interface does not fabricate production numbers. Every run, metric, source and failure figure on this surface ' +
    'is read live from the ROUAA Core Production Observation API; none is stored in this interface. ' +
    'When the API is unreachable the honest state is exactly this one: <b>NOT AVAILABLE</b>.</div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-label">OPERATOR — POINT THE WINDOW AT THE API</span></div><div class="panel-body">' +
    '<div class="obs-toolbar"><input id="obs-base" type="text" spellcheck="false" placeholder="' + esc(OBS.base) + '" value="' + esc(OBS.base) + '">' +
    '<button id="obs-base-set">SET API BASE</button><button id="obs-retry">RETRY</button></div>' +
    '<div class="dim" style="font-size:11px;margin-top:8px">The API base is resolved from the <span class="mono">?api=</span> query parameter, then the persisted operator setting, then the default. ' +
    'It persists in this browser only. The Core server grants access per-origin (CORS allowlist) — the deployment operator decides which origins may read.</div>' +
    (err && err.message ? '<div class="dim mono" style="font-size:11px;margin-top:8px">' + esc(err.message) + '</div>' : '') +
    '</div></div>';
  const setBtn = document.getElementById('obs-base-set');
  if (setBtn) setBtn.onclick = () => {
    const v = (document.getElementById('obs-base').value || '').trim().replace(/\/+$/, '');
    if (!v) return;
    try { localStorage.setItem('rouaa.obs.api', v); } catch (e) {}
    OBS.base = v; route();
  };
  const rbtn = document.getElementById('obs-retry');
  if (rbtn) rbtn.onclick = () => route();
}
function obsWireBaseControl(root, refresh) {
  const inp = root.querySelector('#obs-base-live');
  const btn = root.querySelector('#obs-base-live-set');
  if (btn) btn.onclick = () => {
    const v = (inp.value || '').trim().replace(/\/+$/, '');
    if (!v) return;
    try { localStorage.setItem('rouaa.obs.api', v); } catch (e) {}
    OBS.base = v; route();
  };
  const ref = root.querySelector('#obs-refresh');
  if (ref) ref.onclick = () => refresh();
}

/* the funnel — verbatim counts from the sources endpoint, drawn to scale */
function obsFunnel(f) {
  if (!f) return '';
  const steps = [
    ['sources', 'SOURCES'], ['attempted', 'ATTEMPTED'], ['acquired', 'ACQUIRED'],
    ['documents', 'DOCUMENTS'], ['facts', 'FACTS'], ['events', 'EVENTS'],
    ['io', 'IO'], ['vio', 'VIO'], ['fresh_vio', 'FRESH VIO'],
  ];
  const max = Math.max.apply(null, steps.map(([k]) => Number(f[k]) || 0));
  return '<div class="obs-funnel">' + steps.map(([k, label]) => {
    const v = f[k];
    const w = max > 0 ? Math.max(1.5, (Number(v) || 0) / max * 100) : 0;
    return '<div class="fun-row"><span class="fun-k">' + label + '</span>' +
      '<span class="fun-barwrap"><span class="fun-bar' + (k === 'fresh_vio' ? ' hot' : '') + '" style="width:' + w + '%"></span></span>' +
      '<span class="fun-v mono" data-obsf="funnel.' + k + '">' + obsNum(v) + '</span></div>';
  }).join('') + '</div>';
}
/* the eight failure classes — verbatim from the failures response; zero is shown as zero */
function obsClassCards(orderClasses) {
  if (!orderClasses) return '<div class="note">Order classes not provided by the API for this run.</div>';
  return '<div class="obs-classes">' + Object.entries(orderClasses).map(([cls, o]) => {
    const c = (o && o.count != null) ? o.count : null;
    const zero = Number(c) === 0;
    const ids = (o && o.source_ids && o.source_ids.length) ? '<div class="cls-src mono">' + esc(o.source_ids.join(', ')) + '</div>' : '';
    const seen = (o && (o.first_seen || o.last_seen))
      ? '<div class="cls-seen mono">' + esc(o.first_seen || '—') + ' &rarr; ' + esc(o.last_seen || '—') + '</div>' : '';
    return '<div class="cls-card' + (zero ? ' zero' : '') + '" data-obsf="order_classes.' + cls + '.count">' +
      '<div class="cls-name">' + esc(cls) + '</div>' +
      '<div class="cls-count mono' + (zero ? '' : ' hot') + '">' + obsNum(c) + '</div>' +
      ids + seen +
      '<div class="cls-zero">' + (zero ? 'ZERO — recorded explicitly' : '') + '</div></div>';
  }).join('') + '</div>';
}
/* offset pager for run-scoped ledgers */
function obsPager(total, offset, limit, key) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  let btns = '';
  const win = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) win.push(p);
    else if (win[win.length - 1] !== '…') win.push('…');
  }
  win.forEach(p => {
    if (p === '…') btns += '<button disabled>…</button>';
    else btns += '<button class="' + (p === page ? 'cur' : '') + '" data-obsgo="' + (p - 1) * limit + '">' + p + '</button>';
  });
  return '<div class="pager" data-obspager="' + key + '">' +
    '<span>' + total.toLocaleString('en-GB') + ' rows in run</span>' +
    '<select data-obsper>' + PER_PAGE_OPTS.map(o => '<option value="' + o + '"' + (o === limit ? ' selected' : '') + '>' + o + ' / page</option>').join('') + '</select>' +
    '<div class="pg-btns"><button data-obsgo="prev" ' + (page <= 1 ? 'disabled' : '') + '>&#9664; PREV</button>' + btns +
    '<button data-obsgo="next" ' + (page >= pages ? 'disabled' : '') + '>NEXT &#9654;</button></div>' +
    '<span class="pg-info">page ' + page + ' / ' + pages + '</span></div>';
}
function obsWirePager(key, offset, limit, sourceId, refresh) {
  document.querySelectorAll('[data-obspager="' + key + '"]').forEach(p => {
    p.querySelectorAll('[data-obsgo]').forEach(b => b.onclick = () => {
      const v = b.dataset.obsgo;
      if (v === 'prev') OBSP.page = Math.max(1, Math.floor(offset / limit));
      else if (v === 'next') OBSP.page = Math.floor(offset / limit) + 2;
      else OBSP.page = Math.floor(Number(v) / limit) + 1;
      refresh();
    });
    const sel = p.querySelector('[data-obsper]');
    if (sel) sel.onchange = () => { OBSP.per = parseInt(sel.value, 10); OBSP.page = 1; refresh(); };
  });
}
/* click-to-expand: the verbatim API row, every field, nothing summarized away */
function obsWireRowExpand(root) {
  root.querySelectorAll('tr[data-obsrow]').forEach(tr => {
    tr.addEventListener('click', () => {
      const nid = 'obsx-' + tr.dataset.obsrow;
      let x = document.getElementById(nid);
      if (x) { x.remove(); return; }
      const raw = tr.dataset.obsjson ? JSON.parse(tr.dataset.obsjson) : null;
      const cells = Array.from(tr.children).map(td => esc(td.textContent.trim())).join(' · ');
      x = document.createElement('tr');
      x.className = 'obs-expand';
      x.id = nid;
      x.innerHTML = '<td colspan="' + tr.children.length + '">' +
        '<div class="obsx-line">' + cells + '</div>' +
        (raw ? '<pre class="obsx-json">' + esc(JSON.stringify(raw, null, 1)) + '</pre>' : '') + '</td>';
      tr.after(x);
    });
  });
}

/* ------------------------------------------------ observatory home: status + runs */

async function viewObservatory(app) {
  app.innerHTML = '<div class="loading">Reading live production observation…</div>';
  const load = async () => {
    const [status, metrics, runs] = await Promise.all([OBS.status(), OBS.metrics(), OBS.runs()]);
    const last = status.last_run || null;
    const agg = (metrics && metrics.aggregate) || {};
    const q = (fn, d) => (d == null ? '<span class="na">NOT AVAILABLE</span>' : fn(d));

    let html = '' +
      '<div class="view-head"><div class="view-title">OBSERVATORY</div>' +
      '<div class="view-count">live read window on ROUAA Core production — ' + esc(status.served_tree ? status.served_tree.branch : '?') +
      ' @ ' + esc(String(status.served_tree ? status.served_tree.commit : '').slice(0, 10)) + '</div></div>' +
      obsConnLine() +
      '<div class="obs-toolbar" style="margin:12px 0">' +
      '<input id="obs-base-live" type="text" spellcheck="false" value="' + esc(OBS.base) + '" placeholder="Production Observation API base URL">' +
      '<button id="obs-base-live-set">SET API BASE</button><button id="obs-refresh">REFRESH NOW</button>' +
      '<span class="dim" style="font-size:11px;align-self:center">auto-refresh every 30s · polling contract V1</span></div>' +

      '<div class="note" style="margin-bottom:14px"><b>What this surface is.</b> A read-only window onto the ROUAA Core Production Observation API. ' +
      'It shows what Core is producing <i>now</i> — runs, sources, documents, intelligence units and failures — exactly as the closed ' +
      'observation contract serves them. Nothing here is stored in the interface: if the API is unreachable, the surface says so. ' +
      'The frozen repository snapshot (LSE-V4) under the other navigation keys is a separate, committed artifact.</div>' +

      '<div class="obs-qgrid">' +
      '<div class="panel obs-q"><div class="panel-head"><span class="panel-label">CORE NOW — LAST RUN</span></div><div class="panel-body">' +
        (last ? obsStatusBadge(last.status) + '<div class="obs-big mono" data-obsf="last_run.run_id">' + esc(last.run_id) + '</div>' +
        '<div class="dim" style="font-size:11px">' + esc(last.run_seq || '') + ' · ' + esc(last.run_type || '') + ' · finished ' + esc(last.finished_at || '—') + '</div>'
        : '<span class="na">NOT AVAILABLE</span>') + '</div></div>' +
      '<div class="panel obs-q"><div class="panel-head"><span class="panel-label">SERVED TREE</span></div><div class="panel-body">' +
        '<div class="obs-big mono" data-obsf="served_tree.commit">' + esc(String(status.served_tree ? status.served_tree.commit : '').slice(0, 10)) + '</div>' +
        '<div class="dim" style="font-size:11px">branch <span class="mono">' + esc(status.served_tree ? status.served_tree.branch : '') + '</span></div>' +
        '<div class="dim" style="font-size:11px">runs indexed <b data-obsf="runs_indexed">' + obsNum(status.runs_indexed) + '</b> · with contract <b data-obsf="runs_with_contract">' + obsNum(status.runs_with_contract) + '</b></div>' +
        '</div></div>' +
      '<div class="panel obs-q"><div class="panel-head"><span class="panel-label">PRODUCTION VOLUME (ALL INDEXED RUNS)</span></div><div class="panel-body">' +
        '<div class="obs-big mono" data-obsf="aggregate.vio_count">' + q(obsNum, agg.vio_count) + '</div>' +
        '<div class="dim" style="font-size:11px">VIO · documents <b data-obsf="aggregate.document_count">' + q(obsNum, agg.document_count) + '</b> · runs <b data-obsf="runs_total">' + obsNum(metrics.runs_total) + '</b></div>' +
        '</div></div>' +
      '<div class="panel obs-q"><div class="panel-head"><span class="panel-label">FRESHNESS (ALL INDEXED RUNS)</span></div><div class="panel-body">' +
        '<div class="obs-big mono" data-obsf="aggregate.fresh_vio_count">' + q(obsNum, agg.fresh_vio_count) + '</div>' +
        '<div class="dim" style="font-size:11px">fresh VIO · failures <b data-obsf="aggregate.failure_count">' + q(obsNum, agg.failure_count) + '</b></div>' +
        '</div></div>' +
      '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">RUN REGISTRY</span>' +
      '<span class="panel-meta">' + obsNum(runs.count) + ' runs · ' + esc((runs.branches_served || []).length) + ' branches served · every served branch unmerged</span></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>SEQ</th><th>RUN ID</th><th>TYPE</th><th>STATUS</th><th>STARTED</th><th>FINISHED</th><th>BRANCH</th>' +
      '<th class="num-col">SRC</th><th class="num-col">DOCS</th><th class="num-col">FACTS</th><th class="num-col">VIO</th><th class="num-col">FRESH</th><th class="num-col">FAIL</th>' +
      '</tr></thead><tbody>';
    (runs.runs || []).forEach(r => {
      html += '<tr class="rowlink" data-go="#/observatory/runs/' + encodeURIComponent(r.run_id) + '">' +
        '<td class="mono dim">' + esc(r.run_seq || '') + '</td>' +
        '<td class="mono t-strong" data-f="run_id">' + esc(r.run_id) + '</td>' +
        '<td class="dim">' + esc(r.run_type || '') + '</td>' +
        '<td>' + obsStatusBadge(r.status) + '</td>' +
        '<td class="dim mono" style="font-size:11px">' + esc((r.started_at || '').replace('T', ' ').replace('Z', '')) + '</td>' +
        '<td class="dim mono" style="font-size:11px">' + esc((r.finished_at || '').replace('T', ' ').replace('Z', '')) + '</td>' +
        '<td class="dim" style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.branch || '') + '</td>' +
        '<td class="num-col" data-f="source_count">' + obsNum(r.source_count) + '</td>' +
        '<td class="num-col" data-f="document_count">' + obsNum(r.document_count) + '</td>' +
        '<td class="num-col" data-f="fact_count">' + obsNum(r.fact_count) + '</td>' +
        '<td class="num-col" data-f="vio_count">' + obsNum(r.vio_count) + '</td>' +
        '<td class="num-col" data-f="fresh_vio_count">' + obsNum(r.fresh_vio_count) + '</td>' +
        '<td class="num-col" data-f="failure_count">' + obsNum(r.failure_count) + '</td></tr>';
    });
    html += '</tbody></table></div>' +
      '<div class="panel-body"><div class="dim" style="font-size:11px">' + esc(runs.git_note || runs.branch_independence || '') + '</div></div></div>';
    app.innerHTML = html;
    bindGo(app);
    obsWireBaseControl(app, load);
  };
  try { await load(); OBS.armPoll(load); } catch (e) { obsUnavailable(app, e, 'OBSERVATORY HOME'); }
}

/* ------------------------------------------------ run detail */

async function viewObsRun(app, runId) {
  app.innerHTML = '<div class="loading">Reading run ' + esc(runId) + ' from the live observation API…</div>';
  const load = async () => {
    const run = await OBS.run(runId);
    if (run.status_code === 'RUN_NOT_FOUND') {
      app.innerHTML = '<div class="note"><b>RUN NOT FOUND.</b> The live observation API does not know <span class="mono">' + esc(runId) + '</span>. The interface does not guess.</div>' + obsConnLine();
      return;
    }
    const id = run.identity || {};
    const acc = run.accounting || {};
    const env = id.environment || {};
    const acq = acc.by_acquisition_result || {};
    const freshShare = (acc.vio_count > 0 && acc.fresh_vio_count != null)
      ? (100 * acc.fresh_vio_count / acc.vio_count).toFixed(1) + '% of VIO (presentation arithmetic on live values)'
      : '<span class="na">NOT AVAILABLE</span>';

    let html = '' +
      '<div class="view-head"><div class="view-title">RUN DETAIL</div>' +
      '<div class="view-count mono" data-obsf="identity.run_id">' + esc(runId) + '</div></div>' +
      obsConnLine() +
      '<div class="obs-runbar"><a href="#/observatory">&larr; RUN REGISTRY</a>' +
      obsStatusBadge(id.status) +
      '<span class="mono dim">' + esc(id.run_seq || '') + '</span>' +
      '<span class="dim">' + esc(id.run_type || '') + '</span>' +
      '<span class="dim">' + esc(id.run_kind || '') + '</span>' +
      '<button id="obs-refresh" class="obs-mini">REFRESH</button></div>' +

      '<div class="obs-drill">' +
      ['sources', 'documents', 'facts', 'events', 'intelligence', 'failures'].map(k =>
        '<a class="drill-chip" href="#/observatory/runs/' + encodeURIComponent(runId) + '/' + k + '">' + k.toUpperCase() + ' &rarr;</a>').join('') +
      '</div>' +

      '<div class="prod-grid obs-grid">' +
      '<div class="panel"><div class="panel-head"><span class="panel-label">RUN IDENTITY</span></div>' + obsKV([
        ['identity.run_id', 'RUN ID', '<span class="mono">' + esc(id.run_id) + '</span>'],
        ['identity.run_seq', 'Run sequence', obsStr(id.run_seq)],
        ['identity.run_kind', 'Run kind', obsStr(id.run_kind)],
        ['identity.run_type', 'Run type', obsStr(id.run_type)],
        ['identity.task_id', 'Task ID', '<span class="mono" style="font-size:11px">' + obsStr(id.task_id) + '</span>'],
        ['identity.status', 'Status', obsStatusBadge(id.status)],
        ['identity.started_at', 'Started (UTC)', obsStr(fmtDateTime(id.started_at))],
        ['identity.completed_at', 'Completed (UTC)', obsStr(fmtDateTime(id.completed_at))],
        ['identity.branch', 'Branch', obsStr(id.branch)],
        ['identity.commit', 'Engine commit', '<span class="mono">' + obsStr(id.commit) + '</span>', true],
        ['identity.engine_version', 'Engine version', obsStr(id.engine_version)],
        ['identity.resume_commit', 'Resume commit', obsStr(id.resume_commit)],
      ]) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">EXECUTION ENVIRONMENT</span>' +
      '<span class="panel-meta">recorded at run start: ' + obsBool(id.environment_recorded) + '</span></div>' + obsKV([
        ['identity.environment.host', 'Host', '<span class="mono" style="font-size:11px">' + obsStr(env.host) + '</span>'],
        ['identity.environment.python', 'Python', obsStr(env.python)],
        ['identity.environment.platform', 'Platform', '<span class="mono" style="font-size:10px">' + obsStr(env.platform) + '</span>'],
        ['identity.environment.engine_pid', 'Engine PID', obsStr(env.engine_pid)],
        ['identity.environment.launch_mode', 'Launch mode', obsStr(env.launch_mode)],
      ]) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">SOURCE ACCOUNTING</span></div>' + obsKV([
        ['accounting.source_count', 'Sources in run', obsNum(acc.source_count)],
        ['accounting.attempted_sources', 'Attempted', obsNum(acc.attempted_sources), true],
        ['accounting.acquired_sources', 'Acquired', obsNum(acc.acquired_sources), true],
        ['accounting.success_count', 'Successes', obsNum(acc.success_count)],
        null_placeholder(acq),
      ].filter(Boolean)) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">DOCUMENT ACCOUNTING</span></div>' + obsKV([
        ['accounting.documents_discovered', 'Documents discovered', obsNum(acc.documents_discovered)],
        ['accounting.documents_extracted', 'Documents extracted', obsNum(acc.documents_extracted)],
        ['accounting.document_count', 'Documents landed in store', obsNum(acc.document_count), true],
      ]) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">INTELLIGENCE ACCOUNTING</span></div>' + obsKV([
        ['accounting.fact_count', 'Facts', obsNum(acc.fact_count)],
        ['accounting.event_count', 'Events', obsNum(acc.event_count)],
        ['accounting.io_count', 'IO', obsNum(acc.io_count)],
        ['accounting.vio_count', 'VIO', obsNum(acc.vio_count), true],
        ['accounting.fresh_vio_count', 'Fresh VIO', obsNum(acc.fresh_vio_count), true],
        [null, 'Fresh share', freshShare],
      ]) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">EXECUTION</span></div>' + obsKV([
        ['accounting.duration_s', 'Duration (s)', obsNum(acc.duration_s)],
        [null, 'Throughput VIO/s', (acc.throughput && acc.throughput.vio_per_second != null) ? esc(acc.throughput.vio_per_second) : '<span class="na">NOT AVAILABLE</span>'],
        [null, 'Throughput docs/s', (acc.throughput && acc.throughput.documents_per_second != null) ? esc(acc.throughput.documents_per_second) : '<span class="na">NOT AVAILABLE</span>'],
      ]) + '</div>' +

      '<div class="panel"><div class="panel-head"><span class="panel-label">ACCOUNTING / RECONCILIATION STATUS</span></div>' + obsKV([
        ['accounting_status', 'Status', '<b class="obs-ok mono" style="font-size:11.5px">' + esc(run.accounting_status) + '</b>'],
        ['counting_source', 'Counting source', '<span class="mono" style="font-size:11px">' + esc(run.counting_source) + '</span>'],
      ]) + '</div>' +
      '</div>';

    /* failure observation — fetched live, zeros explicit */
    let fhtml = '<div class="panel"><div class="panel-head"><span class="panel-label">FAILURE OBSERVATION — THE EIGHT ORDER CLASSES</span>' +
      '<span class="panel-meta">live from /production/runs/&lt;run&gt;/failures</span></div><div class="panel-body">';
    try {
      const f = await OBS.failures(runId);
      fhtml += '<div class="obs-failhead">Total failures: <b class="mono" data-obsf="failure_count">' + obsNum(f.failure_count) + '</b>' +
        (Number(f.failure_count) === 0 ? ' — <span class="obs-ok">zero, recorded explicitly (not hidden, not converted to "healthy")</span>' : '') + '</div>' +
        obsClassCards(f.order_classes);
      if (f.native && f.native.by_class && Object.keys(f.native.by_class).length) {
        fhtml += '<div class="section-title" style="margin-top:14px">NATIVE CHAIN CLASSES (VERBATIM)</div><div class="obs-chips">' +
          Object.entries(f.native.by_class).map(([k, v]) => '<span class="chip mono">' + esc(k) + ' · ' + obsNum(v) + '</span>').join('') + '</div>';
      }
    } catch (e) {
      fhtml += '<div class="note">Failure observation not available from the live API for this run: ' + esc(e.message) + '</div>';
    }
    fhtml += '<div class="dim" style="font-size:11px;margin-top:10px">Class mapping is read-time and disclosed by the contract; raw failure rows keep the chain vocabulary verbatim. ' +
      'A zero is displayed as zero — never hidden, never restyled as health.</div></div></div>';

    app.innerHTML = html + fhtml;
    const ref = document.getElementById('obs-refresh');
    if (ref) ref.onclick = () => load();
  };
  try { await load(); OBS.armPoll(load); } catch (e) { obsUnavailable(app, e, 'RUN DETAIL ' + runId); }
}
function null_placeholder(acq) {
  if (!acq || !Object.keys(acq).length) return [null, 'By acquisition result', '<span class="na">NOT AVAILABLE</span>'];
  return [null, 'By acquisition result', '<span class="obs-chips">' + Object.entries(acq).map(([k, v]) =>
    '<span class="chip mono">' + esc(k) + ' · ' + obsNum(v) + '</span>').join('') + '</span>'];
}
/* contract-expressed ledger unavailability (e.g. legacy run without a closed
   contract): the served status_code and note, verbatim — nothing invented */
function obsLedgerUnavailable(d) {
  return '<div class="note"><b>' + esc(d.status_code) + '.</b> The observation API served this status for the requested ledger. ' +
    (d.note ? esc(d.note) + ' ' : '') +
    'The interface renders the served state verbatim — it does not reconstruct, estimate or fill ledger rows that the closed contract does not provide.</div>';
}

/* ------------------------------------------------ run-scoped ledgers (drilldowns) */

async function viewObsLedger(app, runId, kind, query) {
  app.innerHTML = '<div class="loading">Reading ' + esc(kind) + ' ledger for ' + esc(runId) + '…</div>';
  const sourceId = query.source_id || '';
  const load = async () => {
    const offset = (OBSP.page - 1) * OBSP.per;
    const limit = OBSP.per;
    let head = '<div class="view-head"><div class="view-title">' + kind.toUpperCase() + '</div>' +
      '<div class="view-count mono">' + esc(runId) + '</div></div>' + obsConnLine() +
      '<div class="obs-runbar"><a href="#/observatory/runs/' + encodeURIComponent(runId) + '">&larr; RUN DETAIL</a>' +
      '<a href="#/observatory">&larr; RUN REGISTRY</a>' +
      '<button id="obs-refresh" class="obs-mini">REFRESH</button></div>';

    if (kind === 'sources') {
      const d = await OBS.sources(runId, { limit: 100, offset: 0 });
      if (d.status_code && d.status_code !== 'OK') {
        app.innerHTML = head + obsLedgerUnavailable(d);
        const ref = document.getElementById('obs-refresh');
        if (ref) ref.onclick = () => load();
        return;
      }
      head += '<div class="panel"><div class="panel-head"><span class="panel-label">PIPELINE FUNNEL</span>' +
        '<span class="panel-meta">' + esc(d.funnel_note || '') + '</span></div><div class="panel-body">' + obsFunnel(d.funnel) + '</div></div>';
      if (d.by_acquisition_result && Object.keys(d.by_acquisition_result).length) {
        head += '<div class="obs-chips" style="margin:10px 0">' + Object.entries(d.by_acquisition_result).map(([k, v]) =>
          '<span class="chip mono">' + esc(k) + ' · ' + obsNum(v) + '</span>').join('') + '</div>';
      }
      let t = head + '<div class="panel"><div class="panel-head"><span class="panel-label">SOURCES IN THIS RUN</span>' +
        '<span class="panel-meta">' + obsNum(d.total_in_run) + ' marker rows · click a row for the verbatim observation record</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>SOURCE</th><th>JUR</th><th>ACCESS</th><th>ACQUISITION RESULT</th><th class="num-col">LINKS</th>' +
        '<th class="num-col">LANDED</th><th class="num-col">DUP</th><th class="num-col">FACTS</th><th class="num-col">EVENTS</th>' +
        '<th class="num-col">IO</th><th class="num-col">FRESH IO</th><th class="num-col">REQ</th><th>DOCS</th></tr></thead><tbody>';
      (d.rows || []).forEach((r, i) => {
        t += '<tr class="rowlink" data-obsrow="' + i + '" data-obsjson="' + esc(JSON.stringify(r)).replace(/"/g, '&quot;') + '">' +
          '<td class="mono t-strong" data-f="SOURCE_ID">' + esc(r.SOURCE_ID || r.source_id || '') + '</td>' +
          '<td class="dim">' + esc(r.JURISDICTION || '') + '</td>' +
          '<td class="dim">' + esc(r.ACCESS_RESULT || '') + '</td>' +
          '<td>' + esc(r.ACQUISITION_RESULT || '') + '</td>' +
          '<td class="num-col" data-f="document_links_found">' + obsNum(r.document_links_found) + '</td>' +
          '<td class="num-col" data-f="documents_landed">' + obsNum(r.documents_landed) + '</td>' +
          '<td class="num-col">' + obsNum(r.documents_duplicate_prior_capital) + '</td>' +
          '<td class="num-col" data-f="FACT_COUNT">' + obsNum(r.FACT_COUNT != null ? r.FACT_COUNT : r.facts) + '</td>' +
          '<td class="num-col">' + obsNum(r.EVENT_COUNT != null ? r.EVENT_COUNT : r.events) + '</td>' +
          '<td class="num-col" data-f="IO_COUNT">' + obsNum(r.IO_COUNT != null ? r.IO_COUNT : r.IO) + '</td>' +
          '<td class="num-col" data-f="FRESH_IO_COUNT">' + obsNum(r.FRESH_IO_COUNT != null ? r.FRESH_IO_COUNT : r.fresh_IO) + '</td>' +
          '<td class="num-col">' + obsNum(r.REQUEST_COUNT != null ? r.REQUEST_COUNT : r.requests) + '</td>' +
          '<td><a href="#/observatory/runs/' + encodeURIComponent(runId) + '/documents?source_id=' + encodeURIComponent(r.SOURCE_ID || r.source_id || '') + '" class="obs-link">view &rarr;</a></td></tr>';
      });
      t += '</tbody></table></div><div class="panel-body"><div class="dim" style="font-size:11px">Source status on this surface is derived exclusively from this production observation response — never from registry membership.</div></div></div>';
      app.innerHTML = t;
      obsWireRowExpand(app);
    } else if (kind === 'intelligence') {
      const d = await OBS.intelligence(runId, true);
      if (d.status_code && d.status_code !== 'OK') {
        app.innerHTML = head + obsLedgerUnavailable(d);
        const ref = document.getElementById('obs-refresh');
        if (ref) ref.onclick = () => load();
        return;
      }
      let t = head + '<div class="prod-grid">' +
        '<div class="panel"><div class="panel-head"><span class="panel-label">INTELLIGENCE AGGREGATE</span></div><div class="panel-body obs-int-grid">' +
        ['facts', 'events', 'io', 'vio', 'fresh_vio'].map(k =>
          '<div class="int-cell"><div class="int-k">' + k.replace('_', ' ').toUpperCase() + '</div>' +
          '<div class="int-v mono" data-obsf="intelligence.' + k + '">' + obsNum(d.intelligence ? d.intelligence[k] : null) + '</div></div>').join('') +
        '</div><div class="dim" style="font-size:11px">' + esc(d.counting_source || '') + '</div></div></div>';
      if (d.by_source) {
        t += '<div class="panel"><div class="panel-head"><span class="panel-label">BY SOURCE</span><span class="panel-meta">' +
          obsNum(d.by_source_total_sources) + ' sources</span></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>SOURCE</th><th class="num-col">FACTS</th><th class="num-col">EVENTS</th>' +
          '<th class="num-col">VIO</th><th class="num-col">FRESH VIO</th></tr></thead><tbody>' +
          Object.entries(d.by_source).map(([sid, o]) =>
            '<tr><td class="mono t-strong">' + esc(sid) + '</td><td class="num-col">' + obsNum(o.facts) + '</td>' +
            '<td class="num-col">' + obsNum(o.events) + '</td><td class="num-col">' + obsNum(o.vio) + '</td>' +
            '<td class="num-col">' + obsNum(o.fresh_vio) + '</td></tr>').join('') +
          '</tbody></table></div></div>';
      } else {
        t += '<div class="note">Per-source regroup not served for this run.</div>';
      }
      app.innerHTML = t;
    } else if (kind === 'failures') {
      const d = await OBS.failures(runId, { limit: OBSP.per, offset: offset });
      if (d.status_code && d.status_code !== 'OK') {
        app.innerHTML = head + obsLedgerUnavailable(d);
        const ref = document.getElementById('obs-refresh');
        if (ref) ref.onclick = () => load();
        return;
      }
      let t = head +
        '<div class="panel"><div class="panel-head"><span class="panel-label">FAILURE OBSERVATION</span>' +
        '<span class="panel-meta">total failures: <b class="mono">' + obsNum(d.total_in_run) + '</b></span></div><div class="panel-body">' +
        '<div class="obs-failhead">failure_count: <b class="mono" data-obsf="failure_count">' + obsNum(d.failure_count) + '</b></div>' +
        obsClassCards(d.order_classes) +
        ((d.native && d.native.note) ? '<div class="dim" style="font-size:11px;margin-top:10px">' + esc(d.native.note) + '</div>' : '') +
        ((d.native && d.native.by_subject_kind && Object.keys(d.native.by_subject_kind).length)
          ? '<div class="obs-chips" style="margin-top:8px">' + Object.entries(d.native.by_subject_kind).map(([k, v]) =>
              '<span class="chip mono">' + esc(k) + ' · ' + obsNum(v) + '</span>').join('') + '</div>' : '') +
        ((d.class_mapping && Object.keys(d.class_mapping).length)
          ? '<div class="section-title" style="margin-top:14px">CLASS MAPPING (SERVED FOR AUDIT)</div><div class="obs-chips">' +
            Object.entries(d.class_mapping).map(([k, v]) => '<span class="chip mono">' + esc(k) + ' &rarr; ' + esc(v) + '</span>').join('') + '</div>' +
            '<div class="dim" style="font-size:11px;margin-top:6px">' + esc(d.class_mapping_note || '') + '</div>' : '') +
        '</div></div>';
      if ((d.rows || []).length) {
        t += '<div class="panel"><div class="panel-head"><span class="panel-label">RAW FAILURE ROWS</span></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>CLASS</th><th>SUBJECT</th><th>SOURCE</th><th>FIRST SEEN</th><th>LAST SEEN</th><th>DETAIL</th></tr></thead><tbody>';
        d.rows.forEach((r, i) => {
          t += '<tr class="rowlink" data-obsrow="f' + i + '" data-obsjson="' + esc(JSON.stringify(r)).replace(/"/g, '&quot;') + '">' +
            '<td class="mono">' + esc(r.failure_class || r['class'] || r.CLASS || '') + '</td>' +
            '<td class="mono dim" style="font-size:11px">' + esc(r.subject || r.subject_ref || '') + '</td>' +
            '<td class="mono dim">' + esc(r.source_id || r.SOURCE_ID || '') + '</td>' +
            '<td class="dim mono" style="font-size:11px">' + esc(r.first_seen || '') + '</td>' +
            '<td class="dim mono" style="font-size:11px">' + esc(r.last_seen || '') + '</td>' +
            '<td class="dim" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.detail || r.reason || '') + '</td></tr>';
        });
        t += '</tbody></table></div>' + obsPager(d.total_in_run, d.offset, d.limit, 'obsf') + '</div>';
      } else if (Number(d.total_in_run) === 0) {
        t += '<div class="note"><b>Zero failure rows in this run.</b> The count is zero as served by the closed contract — displayed as zero, not hidden.</div>';
      }
      app.innerHTML = t;
      obsWireRowExpand(app);
      obsWirePager('obsf', d.offset, d.limit, sourceId, load);
    } else {
      /* documents / facts / events — run-scoped ledger listings */
      const d = await (kind === 'documents' ? OBS.documents(runId, { limit, offset, source_id: sourceId })
        : kind === 'facts' ? OBS.facts(runId, { limit, offset, source_id: sourceId })
        : OBS.events(runId, { limit, offset, source_id: sourceId }));
      if (d.status_code && d.status_code !== 'OK') {
        app.innerHTML = head + obsLedgerUnavailable(d);
        const ref = document.getElementById('obs-refresh');
        if (ref) ref.onclick = () => load();
        return;
      }
      let t = head + '<div class="obs-runbar">' +
        (sourceId ? '<span class="chip mono">filtered · source_id=' + esc(sourceId) + '</span>' +
          '<a class="obs-link" href="#/observatory/runs/' + encodeURIComponent(runId) + '/' + kind + '">clear filter</a>' : '') +
        '</div>' +
        '<div class="panel"><div class="panel-head"><span class="panel-label">' + kind.toUpperCase() + ' LEDGER ROWS</span>' +
        '<span class="panel-meta">' + obsNum(d.total_in_run) + ' rows in run · ledger: ' + esc(d.ledger || '') +
        ' · resolution: ' + esc(d.ledger_resolution || '') + ' · click a row for the verbatim record</span></div>';
      let thead = '', rowsHtml = '';
      if (kind === 'documents') {
        thead = '<th>URL</th><th>SOURCE</th><th>FORMAT</th><th class="num-col">BYTES</th><th>OUTCOME</th><th>ACQUIRED</th><th>FIRST SEEN</th>';
        rowsHtml = (d.rows || []).map((r, i) =>
          '<tr class="rowlink" data-obsrow="d' + i + '" data-obsjson="' + esc(JSON.stringify(r)).replace(/"/g, '&quot;') + '">' +
          '<td class="mono t-strong" style="font-size:11px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-f="url">' + esc(cleanUrl(r.url || '')) + '</td>' +
          '<td class="mono dim" data-f="source_id">' + esc(r.source_id || '') + '</td>' +
          '<td class="dim">' + esc(r.format || '') + '</td>' +
          '<td class="num-col">' + obsNum(r.bytes) + '</td>' +
          '<td>' + esc(r.outcome || r.state || '') + '</td>' +
          '<td>' + obsBool(r.acquired) + '</td>' +
          '<td class="dim mono" style="font-size:11px">' + esc((r.first_seen || r.ts || '').replace('T', ' ').replace('Z', '')) + '</td></tr>').join('');
      } else if (kind === 'facts') {
        thead = '<th>FACT</th><th>ARTIFACT</th><th>SOURCE</th><th>VALUE</th><th>CONTEXT</th><th>LOCATOR</th><th>TS</th>';
        rowsHtml = (d.rows || []).map((r, i) =>
          '<tr class="rowlink" data-obsrow="a' + i + '" data-obsjson="' + esc(JSON.stringify(r)).replace(/"/g, '&quot;') + '">' +
          '<td class="mono t-strong" data-f="fact_id">' + esc(r.fact_id || '') + '</td>' +
          '<td class="mono dim" style="font-size:11px">' + esc(r.artifact_id || '') + '</td>' +
          '<td class="mono dim" data-f="source_id">' + esc(r.source_id || '') + '</td>' +
          '<td class="mono" style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.value != null ? String(r.value) : '') + '</td>' +
          '<td class="dim">' + esc(r.context || '') + '</td>' +
          '<td class="dim mono" style="font-size:11px">' + esc(r.locator || '') + '</td>' +
          '<td class="dim mono" style="font-size:11px">' + esc((r.ts || '').replace('T', ' ').replace('Z', '')) + '</td></tr>').join('');
      } else {
        thead = '<th>EVENT</th><th>FACT</th><th>ARTIFACT</th><th>SOURCE</th><th>SUBJECT</th><th>TS</th>';
        rowsHtml = (d.rows || []).map((r, i) =>
          '<tr class="rowlink" data-obsrow="e' + i + '" data-obsjson="' + esc(JSON.stringify(r)).replace(/"/g, '&quot;') + '">' +
          '<td class="mono t-strong" data-f="event_id">' + esc(r.event_id || '') + '</td>' +
          '<td class="mono dim" style="font-size:11px">' + esc(r.fact_id || '') + '</td>' +
          '<td class="mono dim" style="font-size:11px">' + esc(r.artifact_id || '') + '</td>' +
          '<td class="mono dim" data-f="source_id">' + esc(r.source_id || '') + '</td>' +
          '<td class="dim mono" style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.subject_ref || '') + '</td>' +
          '<td class="dim mono" style="font-size:11px">' + esc((r.ts || '').replace('T', ' ').replace('Z', '')) + '</td></tr>').join('');
      }
      t += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + thead + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
        '<div class="panel-body">' + obsPager(d.total_in_run, d.offset, d.limit, 'obsl') + '</div></div>';
      app.innerHTML = t;
      obsWireRowExpand(app);
      obsWirePager('obsl', d.offset, d.limit, sourceId, load);
    }
    const ref = document.getElementById('obs-refresh');
    if (ref) ref.onclick = () => load();
  };
  try { await load(); } catch (e) { obsUnavailable(app, e, (kind || '').toUpperCase() + ' LEDGER ' + runId); }
}

/* ============================================================ start */

boot();

