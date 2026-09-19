/* ==========================================================================
   ROUAA INSTITUTIONAL INTELLIGENCE — V1 PROTOTYPE (static, read-only)
   Repository Production Snapshot · Wave LSE-V4 · NOT A LIVE FEED
   All data loaded from ./data/*.json — generated verbatim from committed
   Core production artifacts by build_presentation.py (read-only adapter).
   ========================================================================== */

'use strict';

const D = { meta: null, intelligence: [], documents: [], sources: [], production: null };
const docIndex = {}, srcIndex = {};

/* ---------------------------------------------------------------- utils */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
function shortId(id) { return id || ''; }

function dateBadge(io) {
  if (io.date_status === 'FRESH') return '<span class="badge fresh" title="Publication date inside the frozen fresh window">Recent</span>';
  if (io.date_status === 'HISTORICAL') return '<span class="badge historical" title="Dated, but outside the fresh window">Historical</span>';
  return '<span class="badge undated" title="No publication date attributed by Core">Undated</span>';
}
function dateLine(io) {
  if (io.date_status === 'FRESH') {
    const basis = io.publication_provenance || 'attributed';
    return (io.publication_time ? fmtDateTime(io.publication_time) : fmtDate(io.best_document_date)) + ' · basis: ' + esc(basis);
  }
  if (io.date_status === 'HISTORICAL') {
    const basis = io.publication_provenance || 'attributed';
    return (io.publication_time ? fmtDateTime(io.publication_time) : fmtDate(io.best_document_date)) + ' · basis: ' + esc(basis);
  }
  return 'No publication date attributed';
}

/* ---------------------------------------------------------------- boot */
async function boot() {
  const el = document.getElementById('app');
  el.innerHTML = '<div class="loading">Loading repository production snapshot…</div>';
  const base = 'data/';
  const [meta, intelligence, documents, sources, production] = await Promise.all([
    fetch(base + 'meta.json').then(r => r.json()),
    fetch(base + 'intelligence.json').then(r => r.json()),
    fetch(base + 'documents.json').then(r => r.json()),
    fetch(base + 'sources.json').then(r => r.json()),
    fetch(base + 'production.json').then(r => r.json()),
  ]);
  D.meta = meta; D.intelligence = intelligence; D.documents = documents; D.sources = sources; D.production = production;
  documents.forEach(d => docIndex[d.document_id] = d);
  sources.forEach(s => srcIndex[s.source_id] = s);
  renderMasthead();
  window.addEventListener('hashchange', route);
  route();
}

/* ---------------------------------------------------------------- masthead */
function renderMasthead() {
  const m = D.meta;
  document.getElementById('masthead-meta').innerHTML =
    '<div class="strong">Repository Production Snapshot</div>' +
    '<div>Wave ' + esc(m.wave) + ' · Snapshot ' + esc(m.snapshot_date) + '</div>';
  document.getElementById('system-strip').innerHTML =
    '<span><span class="dot"></span><span class="mode">' + esc(m.snapshot_kind) + '</span>' +
    '&nbsp;·&nbsp;ROUAA Core commit ' + esc(m.production_commit.slice(0, 7)) +
    '&nbsp;·&nbsp;fresh window ' + esc(m.fresh_window.start) + ' → ' + esc(m.fresh_window.end) + '</span>' +
    '<span>THIS IS NOT A LIVE PRODUCTION FEED — frozen snapshot of committed Core outputs</span>';
}

/* ---------------------------------------------------------------- router */
function route() {
  const h = location.hash.slice(1) || '/';
  const parts = h.split('/').filter(Boolean);
  const app = document.getElementById('app');
  window.scrollTo(0, 0);
  setActiveNav(parts[0] || '');
  if (parts.length === 0) return viewHome(app);
  if (parts[0] === 'intelligence' && parts[1]) return viewIntelligence(app, parts[1]);
  if (parts[0] === 'document' && parts[1]) return viewDocument(app, parts[1]);
  if (parts[0] === 'source' && parts[1]) return viewSource(app, parts[1]);
  if (parts[0] === 'production') return viewProduction(app);
  if (parts[0] === 'documents') return viewDocuments(app);
  if (parts[0] === 'sources') return viewSources(app);
  return viewHome(app);
}
function setActiveNav(key) {
  document.querySelectorAll('.topnav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('data-key') === key);
  });
}

/* =========================================================================
   HOME — EXECUTIVE BRIEF
   ========================================================================= */
const FILTER = { q: '', fresh: '', sector: '', juris: '', etype: '' };

function viewHome(app) {
  const m = D.meta;
  const fresh = D.intelligence.filter(i => i.date_status === 'FRESH' && i.is_new).length;
  const hist = D.intelligence.filter(i => i.date_status === 'HISTORICAL' && i.is_new).length;
  const und = D.intelligence.filter(i => i.date_status === 'UNDATED' && i.is_new).length;

  // real sectors with counts
  const sectors = {};
  D.intelligence.forEach(i => { if (i.sector_label) sectors[i.sector_label] = (sectors[i.sector_label] || 0) + 1; });
  const sectorKeys = Object.keys(sectors).sort((a, b) => sectors[b] - sectors[a]);

  const jurisdictions = {};
  D.intelligence.forEach(i => { if (i.jurisdiction) jurisdictions[i.jurisdiction] = (jurisdictions[i.jurisdiction] || 0) + 1; });
  const jurisKeys = Object.keys(jurisdictions).sort();

  app.innerHTML = `
  <div class="page-head">
    <div class="kicker">Executive Brief · ${esc(m.snapshot_date)}</div>
    <h1 class="page-title">What should I know?</h1>
    <div class="page-sub">Official-source intelligence produced by ROUAA Core in the latest production wave.
    Every object below is traceable: intelligence → facts → documents → official source.
    ${fresh} objects are recent (published inside the ${esc(m.fresh_window.start)} → ${esc(m.fresh_window.end)} window);
    ${hist} are dated but historical; ${und} carry no attributed publication date — Core never guesses dates.</div>
  </div>

  <div class="brief-strip">
    <div class="brief-cell"><div class="v">${fresh}</div><div class="k">Recent intelligence</div><div class="note">published in fresh window</div></div>
    <div class="brief-cell"><div class="v">${hist}</div><div class="k">Historical (dated)</div><div class="note">outside fresh window</div></div>
    <div class="brief-cell"><div class="v">${und}</div><div class="k">Undated</div><div class="note">no date attributed — shown, not hidden</div></div>
    <div class="brief-cell"><div class="v">${m.counts.net_new_vio}</div><div class="k">Net-new VIO this wave</div><div class="note">+${m.counts.rediscovered} re-discoveries of known VIOs</div></div>
    <div class="brief-cell"><div class="v">${m.counts.sources}</div><div class="k">Sources in wave</div><div class="note">of 10,383 registered universe</div></div>
    <div class="brief-cell"><div class="v">${m.counts.documents}</div><div class="k">Documents acquired</div><div class="note">${m.counts.facts.toLocaleString()} facts extracted</div></div>
  </div>

  <div class="section-label"><span>Latest Intelligence</span><span class="count">${D.intelligence.length} objects · recent first</span></div>

  <div class="filter-bar">
    <div class="search">🔍 <input id="fq" placeholder="Search headline, institution, fact value…" value="${esc(FILTER.q)}"></div>
    <select id="f-fresh">
      <option value="">Freshness: all</option>
      <option value="FRESH"${FILTER.fresh === 'FRESH' ? ' selected' : ''}>Recent only</option>
      <option value="HISTORICAL"${FILTER.fresh === 'HISTORICAL' ? ' selected' : ''}>Historical only</option>
      <option value="UNDATED"${FILTER.fresh === 'UNDATED' ? ' selected' : ''}>Undated only</option>
    </select>
    <select id="f-sector">
      <option value="">Sector: all</option>
      ${sectorKeys.map(s => `<option value="${esc(s)}"${FILTER.sector === s ? ' selected' : ''}>${esc(s)} (${sectors[s]})</option>`).join('')}
    </select>
    <select id="f-juris">
      <option value="">Jurisdiction: all</option>
      ${jurisKeys.map(j => `<option value="${esc(j)}"${FILTER.juris === j ? ' selected' : ''}>${esc(j)} (${jurisdictions[j]})</option>`).join('')}
    </select>
    <select id="f-etype">
      <option value="">Type: all</option>
      <option value="regulatory_enforcement"${FILTER.etype === 'regulatory_enforcement' ? ' selected' : ''}>Regulatory enforcement (12)</option>
      <option value="monetary_policy_decision"${FILTER.etype === 'monetary_policy_decision' ? ' selected' : ''}>Monetary policy decision (1)</option>
      <option value="statistical_release"${FILTER.etype === 'statistical_release' ? ' selected' : ''}>Statistical release (132)</option>
      <option value="market_statistic_release"${FILTER.etype === 'market_statistic_release' ? ' selected' : ''}>Market statistic (2)</option>
    </select>
    <button class="reset" id="f-reset">Reset</button>
  </div>

  <div class="intel-list" id="intel-list"></div>

  <div class="section-label"><span>Institutional Coverage</span><span class="count">producing intelligence this wave</span></div>
  <div id="coverage" class="panel"></div>
  `;
  renderIntelList();
  renderCoverage();

  const q = document.getElementById('fq');
  q.addEventListener('input', () => { FILTER.q = q.value; renderIntelList(); });
  ['fresh', 'sector', 'juris', 'etype'].forEach(k => {
    document.getElementById('f-' + k).addEventListener('change', e => { FILTER[k] = e.target.value; renderIntelList(); });
  });
  document.getElementById('f-reset').addEventListener('click', () => {
    FILTER.q = ''; FILTER.fresh = ''; FILTER.sector = ''; FILTER.juris = ''; FILTER.etype = '';
    viewHome(app);
  });
}

function filteredIntel() {
  const q = FILTER.q.trim().toLowerCase();
  return D.intelligence.filter(io => {
    if (FILTER.fresh && io.date_status !== FILTER.fresh) return false;
    if (FILTER.sector && io.sector_label !== FILTER.sector) return false;
    if (FILTER.juris && io.jurisdiction !== FILTER.juris) return false;
    if (FILTER.etype && io.event_type !== FILTER.etype) return false;
    if (q) {
      const hay = (io.headline + ' ' + io.institution_name + ' ' + io.jurisdiction + ' ' + io.sector_label + ' ' +
        io.chain.map(l => l.value + ' ' + l.metric + ' ' + l.excerpt).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderIntelList() {
  const list = document.getElementById('intel-list');
  const rows = filteredIntel();
  if (!rows.length) {
    list.innerHTML = '<div class="empty">No intelligence objects match the current filters in this production snapshot.</div>';
    return;
  }
  list.innerHTML = rows.map(io => `
  <article class="intel-card ${io.date_status.toLowerCase()}">
    <div class="row1">
      <span class="etype">${esc(io.event_type_label)}${io.event_type === 'regulatory_enforcement' ? ' <span class="badge risk">Enforcement</span>' : ''}</span>
      <span class="datebox">${dateBadge(io)} ${esc(dateLine(io))}</span>
    </div>
    <h3><a href="#/intelligence/${esc(io.io_id)}">${esc(io.headline)}</a></h3>
    <div class="byline"><b>${esc(io.institution_name)}</b> · ${esc(io.jurisdiction)} · ${esc(io.sector_label)} · language: ${esc(io.language)}${io.is_new ? '' : ' · <span class="badge neutral" title="Already known before this wave (excluded from net-new accounting)">Re-discovered VIO</span>'}</div>
    <div class="evidence-line">
      <span>Evidence: <b>${io.n_facts}</b> verified fact${io.n_facts === 1 ? '' : 's'} · <b>${io.n_documents}</b> official document${io.n_documents === 1 ? '' : 's'}</span>
      <span>Identity chain: <b>verified by Core</b></span>
      <span class="actions">
        <a class="btn solid" href="#/intelligence/${esc(io.io_id)}">Read Intelligence</a>
        <a class="btn ghost" href="#/intelligence/${esc(io.io_id)}#/evidence" onclick="setTimeout(()=>document.getElementById('evidence-section')?.scrollIntoView({behavior:'smooth'}),80)">View Evidence</a>
      </span>
    </div>
  </article>`).join('');
}

function renderCoverage() {
  const byInst = {};
  D.intelligence.forEach(io => {
    const k = io.source_id;
    if (!byInst[k]) byInst[k] = { name: io.institution_name, juris: io.jurisdiction, sector: io.sector_label, n: 0, fresh: 0 };
    byInst[k].n++;
    if (io.date_status === 'FRESH') byInst[k].fresh++;
  });
  const rows = Object.entries(byInst).sort((a, b) => b[1].n - a[1].n);
  document.getElementById('coverage').innerHTML = `
  <table class="data">
    <thead><tr><th>Institution</th><th>Jurisdiction</th><th>Sector</th><th class="right">Intelligence objects</th><th class="right">Recent</th><th></th></tr></thead>
    <tbody>${rows.map(([sid, v]) => `
      <tr>
        <td><b>${esc(v.name)}</b></td>
        <td>${esc(v.juris)}</td>
        <td>${esc(v.sector)}</td>
        <td class="num right">${v.n}</td>
        <td class="num right">${v.fresh || '—'}</td>
        <td class="right"><a class="btn ghost" href="#/source/${esc(sid)}">Source profile</a></td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="mini-note">${rows.length} sources produced intelligence in this wave (of 357 wave sources, of 10,383 registered universe). Production metrics are deliberately secondary — see <a href="#/production">Core Production</a>.</div>`;
}

/* =========================================================================
   INTELLIGENCE OBJECT VIEW
   ========================================================================= */
function viewIntelligence(app, ioId) {
  const io = D.intelligence.find(x => x.io_id === ioId);
  if (!io) { app.innerHTML = '<div class="empty">Intelligence object not found in this snapshot: ' + esc(ioId) + '</div>'; return; }

  const docs = [...new Set(io.chain.map(l => l.document_id))].map(did => docIndex[did]).filter(Boolean);
  const src = srcIndex[io.source_id];
  const metricCounts = {};
  io.chain.forEach(l => { metricCounts[l.metric] = (metricCounts[l.metric] || 0) + 1; });
  const metricLine = Object.entries(metricCounts).map(([k, v]) => v + ' × ' + k.replace(/_/g, ' ')).join(', ');

  app.innerHTML = `
  <div class="crumbs"><a href="#/">Intelligence</a> › <a href="#/">${esc(io.sector_label)}</a> › <span class="mono">${esc(io.io_id)}</span></div>

  <div class="detail-head">
    <div class="row1 flex" style="justify-content:space-between">
      <span class="etype" style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--accent)">${esc(io.event_type_label)}</span>
      <span>${dateBadge(io)} ${io.is_new ? '' : '<span class="badge neutral">Re-discovered VIO</span>'}</span>
    </div>
    <h1>${esc(io.headline)}</h1>
    <div class="meta-line">
      <span>Institution: <b><a href="#/source/${esc(io.source_id)}">${esc(io.institution_name)}</a></b></span>
      <span>Jurisdiction: <b>${esc(io.jurisdiction)}</b></span>
      <span>Sector: <b>${esc(io.sector_label)}</b></span>
      <span>Language: <b>${esc(io.language)}</b></span>
    </div>
    <div class="meta-line mt">
      <span>Publication: <b>${esc(dateLine(io))}</b></span>
      <span>Object identity: <span class="mono" style="font-family:var(--mono);font-size:11.5px">${esc(io.io_id)} · v${io.version}</span></span>
      <span>Event: <span style="font-family:var(--mono);font-size:11.5px">${esc(io.event_id)} · v${io.event_version}</span></span>
    </div>
  </div>

  <div class="panel">
    <div class="panel-label">Intelligence</div>
    <p style="font-size:15px;line-height:1.6">
      This intelligence object aggregates <b>${io.n_facts}</b> verified fact${io.n_facts === 1 ? '' : 's'}
      (${esc(metricLine)}) extracted from <b>${io.n_documents}</b> official document${io.n_documents === 1 ? '' : 's'}
      published by <b>${esc(io.institution_name)}</b>${io.jurisdiction ? ' (' + esc(io.jurisdiction) + ')' : ''}.
      Every fact is bound to its source excerpt, document and institution below — nothing in this object is inferred beyond what the documents state.
    </p>
    <div class="mini-note">Object type as produced by ROUAA Core: <b>${esc(io.event_type_label)}</b>. Headline is template-generated by Core from event type + institution.</div>
  </div>

  <div class="panel">
    <div class="panel-label">What Happened</div>
    ${io.chain.slice(0, 6).map((l, i) => `
      <div style="margin-bottom:14px">
        <div class="flex" style="justify-content:space-between;align-items:baseline">
          <span><span class="fact-value">${esc(l.value)}</span> <span class="fact-metric">${esc(l.metric.replace(/_/g, ' '))}${l.raw_value ? ' · raw: ' + esc(l.raw_value) : ''}</span></span>
          <span style="font-size:12px;color:var(--muted)"><a href="#/document/${esc(l.document_id)}">document ${esc(l.document_id.slice(0, 12))}…</a></span>
        </div>
        <div class="excerpt">“${esc(l.excerpt)}”</div>
      </div>`).join('')}
    ${io.chain.length > 6 ? `<div class="mini-note">Showing first 6 of ${io.chain.length} facts — full list in Key Facts below.</div>` : ''}
  </div>

  <div class="panel">
    <div class="panel-label">Why It Matters</div>
    <div class="note-box pending">
      Evidence-backed facts available. Executive interpretation layer not yet attached to this object.
    </div>
    <div class="mini-note">ROUAA Core V1 produces evidence-backed intelligence objects; an institutional interpretation layer
    ("why it matters" analysis) is a planned Core capability and does not exist in the current output schema.
    This prototype never fabricates interpretations.</div>
  </div>

  <div class="panel" id="evidence-section">
    <div class="panel-label">Evidence Chain</div>
    <div class="chain-visual">
      <div class="chain-node">
        <div class="chain-rail"><div class="chain-dot"></div><div class="chain-line"></div></div>
        <div class="chain-body">
          <div class="chain-title">Intelligence Object · ${esc(io.event_type_label)}</div>
          <div class="chain-desc"><span class="idref">${esc(io.io_id)}</span> — identity chain verified by Core (fact → document → source, 4-leg verification).</div>
        </div>
      </div>
      <div class="chain-node">
        <div class="chain-rail"><div class="chain-dot fact"></div><div class="chain-line"></div></div>
        <div class="chain-body">
          <div class="chain-title">Supported by ${io.n_facts} verified fact${io.n_facts === 1 ? '' : 's'}</div>
          <div class="chain-desc">${io.chain.slice(0, 3).map(l => `<span class="idref">${esc(l.fact_id)}</span>`).join(' · ')}${io.chain.length > 3 ? ' · …' : ''} — each with a source excerpt (see Key Facts).</div>
        </div>
      </div>
      <div class="chain-node">
        <div class="chain-rail"><div class="chain-dot doc"></div><div class="chain-line"></div></div>
        <div class="chain-body">
          <div class="chain-title">Extracted from ${io.n_documents} official document${io.n_documents === 1 ? '' : 's'}</div>
          <div class="chain-desc">${docs.slice(0, 3).map(d => `<a href="#/document/${esc(d.document_id)}"><span class="idref">${esc(d.document_id)}</span></a>`).join(' · ')}${docs.length > 3 ? ' · …' : ''} — content-addressed (SHA-256), acquisition-audited.</div>
        </div>
      </div>
      <div class="chain-node">
        <div class="chain-rail"><div class="chain-dot src"></div></div>
        <div class="chain-body">
          <div class="chain-title">Published by an official institution</div>
          <div class="chain-desc"><a href="#/source/${esc(io.source_id)}"><b>${esc(io.institution_name)}</b></a>${src && src.official_domain ? ' · ' + esc(src.official_domain) : ''} — official-source registry, verified domain.</div>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-label">Key Facts <span style="float:right;font-weight:500;letter-spacing:0.3px;text-transform:none;color:var(--muted);font-size:12px">${io.chain.length} facts · verbatim from Core store</span></div>
    <div style="overflow-x:auto">
    <table class="data">
      <thead><tr><th>Value</th><th>Metric</th><th>Source excerpt (verbatim)</th><th>Document</th><th>Provenance</th></tr></thead>
      <tbody>
      ${io.chain.map(l => `
        <tr>
          <td class="num"><span class="fact-value">${esc(l.value)}</span></td>
          <td><span class="fact-metric">${esc(l.metric.replace(/_/g, ' '))}</span><br><span class="mono">${esc(l.fact_id)}</span></td>
          <td style="max-width:420px"><div class="excerpt" style="margin-top:0">“${esc(l.excerpt)}”</div></td>
          <td><a href="#/document/${esc(l.document_id)}">${esc(l.document_id.slice(0, 18))}…</a><br><span class="mono">${esc(l.evidence_location || '')}</span></td>
          <td><span class="mono" style="font-size:10.5px">sha:${esc(l.content_sha256 ? l.content_sha256.slice(0, 12) : '')}…</span><br><span class="mono" style="font-size:10.5px">${esc(l.evidence_id)}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-label">Primary Documents</div>
    ${docs.map(d => `
      <div class="doc-card">
        <div class="url"><a href="${esc(d.canonical_url)}" target="_blank" rel="noopener">${esc(d.canonical_url)}</a></div>
        <div class="props">
          <span>${d.best_iso ? 'Dated: <b>' + esc(fmtDate(d.best_iso)) + '</b>' : 'No attributed date'}</span>
          <span>Layer: <b>${esc(d.text_layer || '—')}</b></span>
          <span>Text: <b>${(d.text_chars || 0).toLocaleString()}</b> chars</span>
          <span>Facts: <b>${d.n_facts}</b></span>
          <span>${d.fresh_status === 'FRESH' ? '<span class="badge fresh">Recent</span>' : d.fresh_status === 'HISTORICAL' ? '<span class="badge historical">Historical</span>' : '<span class="badge undated">Undated</span>'}</span>
        </div>
        <div class="mt"><a class="btn" href="${esc(d.canonical_url)}" target="_blank" rel="noopener">Open Original Document ↗</a>
        <a class="btn ghost" href="#/document/${esc(d.document_id)}">Document detail</a></div>
      </div>`).join('')}
    <div class="mini-note">Links point to the canonical URLs recorded at acquisition time. ROUAA does not mirror or rehost third-party content.</div>
  </div>

  <div class="panel">
    <div class="panel-label">Source</div>
    ${src ? `
    <div class="kv-grid">
      <div class="k">Institution</div><div class="v"><b>${esc(src.institution_name)}</b> — <a href="#/source/${esc(src.source_id)}">full source profile ↗</a></div>
      <div class="k">Official domain</div><div class="v mono">${esc(src.official_domain || '—')}</div>
      <div class="k">Jurisdiction / region</div><div class="v">${esc(src.jurisdiction)} · ${esc(src.region)}</div>
      <div class="k">Authority</div><div class="v">${esc(src.authority_type)} (${esc(src.authority_level || '—')})</div>
      <div class="k">Registry identity</div><div class="v mono">${esc(src.source_id)}</div>
      <div class="k">Provenance</div><div class="v">Registered via ${esc(src.discovery_method)} · wave cohort ${esc(src.cohort)}${src.selection_reasons && src.selection_reasons.length ? ' · selection: ' + esc(src.selection_reasons.join(', ')) : ''}</div>
    </div>` : '<div class="empty">Source registry entry not present in wave population file.</div>'}
  </div>`;
}

/* =========================================================================
   DOCUMENT VIEW
   ========================================================================= */
function viewDocument(app, docId) {
  const d = docIndex[docId];
  if (!d) { app.innerHTML = '<div class="empty">Document not found in this snapshot: ' + esc(docId) + '</div>'; return; }
  const src = srcIndex[d.source_id];
  const ios = D.intelligence.filter(io => io.chain.some(l => l.document_id === docId));

  app.innerHTML = `
  <div class="crumbs"><a href="#/documents">Documents</a> › <span style="font-family:var(--mono);font-size:11.5px">${esc(docId)}</span></div>
  <div class="detail-head">
    <span class="badge outline">Official document</span>
    ${d.fresh_status === 'FRESH' ? '<span class="badge fresh">Recent</span>' : d.fresh_status === 'HISTORICAL' ? '<span class="badge historical">Historical</span>' : '<span class="badge undated">Undated</span>'}
    <h1 style="font-size:19px;font-family:var(--mono);font-weight:400;word-break:break-all">${esc(d.canonical_url)}</h1>
    <div class="meta-line">
      <span>Institution: <b>${src ? '<a href="#/source/' + esc(d.source_id) + '">' + esc(src.institution_name) + '</a>' : esc(d.source_id)}</b></span>
      <span>Best attributed date: <b>${d.best_iso ? esc(fmtDate(d.best_iso)) : 'none'}</b></span>
    </div>
    <div class="mt"><a class="btn solid" href="${esc(d.canonical_url)}" target="_blank" rel="noopener">Open Original Document ↗</a></div>
  </div>

  <div class="panel">
    <div class="panel-label">Document Metadata (verbatim from Core)</div>
    <div class="kv-grid">
      <div class="k">Document identity</div><div class="v mono">${esc(d.document_id)}</div>
      <div class="k">Canonical URL</div><div class="v mono" style="word-break:break-all">${esc(d.canonical_url)}</div>
      <div class="k">Status</div><div class="v">${esc(d.status)}</div>
      <div class="k">Freshness classification</div><div class="v">${esc(d.fresh_status)}${d.best_iso ? ' (best date ' + esc(d.best_iso) + ')' : ''}</div>
      <div class="k">Text layer</div><div class="v">${esc(d.text_layer || '—')} · ${(d.text_chars || 0).toLocaleString()} characters</div>
      <div class="k">Usable for extraction</div><div class="v">${esc(d.usable)}</div>
      <div class="k">First claim (new this wave)</div><div class="v">${esc(d.new_document)}</div>
      <div class="k">Extracted facts</div><div class="v">${d.n_facts}</div>
      <div class="k">Supporting intelligence</div><div class="v">${ios.length}</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-label">Associated Intelligence</div>
    ${ios.length ? ios.map(io => `
      <div style="border-bottom:1px solid var(--hairline-2);padding:10px 0">
        <a href="#/intelligence/${esc(io.io_id)}"><b>${esc(io.headline)}</b></a>
        <span style="font-size:12.5px;color:var(--muted)"> · ${esc(io.event_type_label)} · ${dateBadge(io)}</span>
      </div>`).join('') : '<div class="empty">This document produced facts but no intelligence object in this wave.</div>'}
  </div>`;
}

/* =========================================================================
   SOURCE VIEW
   ========================================================================= */
function viewSource(app, srcId) {
  const s = srcIndex[srcId];
  if (!s) { app.innerHTML = '<div class="empty">Source not found in this snapshot: ' + esc(srcId) + '</div>'; return; }
  const ios = D.intelligence.filter(io => io.source_id === srcId);
  const docs = D.documents.filter(d => d.source_id === srcId);
  const nDocsAcq = docs.length;

  app.innerHTML = `
  <div class="crumbs"><a href="#/sources">Sources</a> › ${esc(s.institution_name)}</div>
  <div class="detail-head">
    <span class="badge outline">Official source profile</span>
    ${s.access_status === 'ACCESS_OK' ? '<span class="badge fresh">Access verified</span>' : '<span class="badge undated">' + esc(s.access_status) + '</span>'}
    <h1>${esc(s.institution_name)}</h1>
    <div class="meta-line">
      <span>Jurisdiction: <b>${esc(s.jurisdiction)}</b></span>
      <span>Authority: <b>${esc(s.authority_type)}</b></span>
      <span>Sector: <b>${esc(s.sector_label)}</b></span>
      <span>Language: <b>${esc(s.language)}</b></span>
    </div>
    <div class="mt"><a class="btn" href="${esc(s.canonical_source_url || s.endpoint)}" target="_blank" rel="noopener">Official endpoint ↗</a></div>
  </div>

  <div class="dim-grid">
    <div class="dim-card">
      <h4>Host Coverage</h4>
      <div class="dim-note">Can the official host be reached and discovered at all?</div>
      <div class="dim-row"><span>Access status</span><span class="val">${esc(s.access_status)}</span></div>
      <div class="dim-row"><span>Discovery status</span><span class="val">${esc(s.discovery_status || '—')}</span></div>
      <div class="dim-row"><span>Endpoint kind</span><span class="val">${esc(s.endpoint_kind || '—')}</span></div>
      <div class="dim-row"><span>Failure class</span><span class="val">${esc(s.failure_class || 'none')}</span></div>
      <div class="dim-row"><span>Official domain</span><span class="val mono" style="font-size:11px">${esc(s.official_domain || '—')}</span></div>
    </div>
    <div class="dim-card">
      <h4>Source Depth</h4>
      <div class="dim-note">How much official content does the source actually yield?</div>
      <div class="dim-row"><span>Documents discovered</span><span class="val">${s.documents_discovered}</span></div>
      <div class="dim-row"><span>Documents acquired</span><span class="val">${s.documents_acquired}</span></div>
      <div class="dim-row"><span>Documents usable</span><span class="val">${s.documents_usable}</span></div>
      <div class="dim-row"><span>Facts extracted</span><span class="val">${s.facts.toLocaleString()}</span></div>
      <div class="dim-row"><span>Latest attributed date</span><span class="val">${s.latest_publication_date ? esc(s.latest_publication_date) : 'none'}</span></div>
    </div>
    <div class="dim-card">
      <h4>Intelligence Production</h4>
      <div class="dim-note">Does the content convert into intelligence objects?</div>
      <div class="dim-row"><span>Candidate IO</span><span class="val">${s.candidate_io}</span></div>
      <div class="dim-row"><span>Unique VIO (attributed)</span><span class="val">${s.unique_vio}</span></div>
      <div class="dim-row"><span>Recent VIO</span><span class="val">${s.fresh_vio}</span></div>
      <div class="dim-row"><span>Historical VIO</span><span class="val">${s.historical_vio}</span></div>
      <div class="dim-row"><span>Production status</span><span class="val">${esc(s.production_status)}</span></div>
    </div>
  </div>

  <div class="panel mt">
    <div class="panel-label">Registry Record (verbatim from Core)</div>
    <div class="kv-grid">
      <div class="k">Registry identity</div><div class="v mono">${esc(s.source_id)}</div>
      <div class="k">Endpoint</div><div class="v mono" style="word-break:break-all">${esc(s.endpoint)}</div>
      <div class="k">Discovery method</div><div class="v">${esc(s.discovery_method)}</div>
      <div class="k">Wave cohort</div><div class="v">${esc(s.cohort)}${s.selection_reasons && s.selection_reasons.length ? ' — ' + esc(s.selection_reasons.join(', ')) : ''}</div>
      <div class="k">Pattern set / event focus</div><div class="v">${esc(s.pattern_set || '—')}</div>
      <div class="k">Region</div><div class="v">${esc(s.region)}</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-label">Associated Intelligence (${ios.length})</div>
    ${ios.length ? `
    <div style="overflow-x:auto"><table class="data">
      <thead><tr><th>Intelligence object</th><th>Type</th><th>Date status</th><th>Facts</th><th></th></tr></thead>
      <tbody>${ios.map(io => `
        <tr>
          <td style="max-width:420px"><a href="#/intelligence/${esc(io.io_id)}"><b>${esc(io.headline)}</b></a></td>
          <td>${esc(io.event_type_label)}</td>
          <td>${dateBadge(io)} ${io.best_document_date ? esc(fmtDate(io.best_document_date)) : ''}</td>
          <td class="num">${io.n_facts}</td>
          <td class="right"><a class="btn ghost" href="#/intelligence/${esc(io.io_id)}">Open</a></td>
        </tr>`).join('')}
      </tbody></table></div>` :
    '<div class="empty">This source produced documents/facts but no intelligence object in this wave.</div>'}
  </div>

  <div class="panel">
    <div class="panel-label">Documents (${docs.length} in wave ledger)</div>
    ${docs.length ? `
    <div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table class="data">
      <thead><tr><th>Document</th><th>Date status</th><th>Best date</th><th>Layer</th><th>Facts</th></tr></thead>
      <tbody>${docs.map(d => `
        <tr>
          <td style="max-width:380px"><a href="#/document/${esc(d.document_id)}" style="font-family:var(--mono);font-size:11px">${esc(d.canonical_url.slice(0, 72))}${d.canonical_url.length > 72 ? '…' : ''}</a></td>
          <td>${d.fresh_status === 'FRESH' ? '<span class="badge fresh">Recent</span>' : d.fresh_status === 'HISTORICAL' ? '<span class="badge historical">Historical</span>' : '<span class="badge undated">Undated</span>'}</td>
          <td>${d.best_iso ? esc(fmtDate(d.best_iso)) : '—'}</td>
          <td>${esc(d.text_layer || '—')}</td>
          <td class="num">${d.n_facts}</td>
        </tr>`).join('')}
      </tbody></table></div>` :
    '<div class="empty">No documents acquired from this source in this wave.</div>'}
  </div>`;
}

/* =========================================================================
   DOCUMENTS BROWSE (secondary)
   ========================================================================= */
function viewDocuments(app) {
  const docs = D.documents.slice().sort((a, b) => (b.n_intelligence - a.n_intelligence) || ((b.best_iso || '') < (a.best_iso || '') ? -1 : 1));
  app.innerHTML = `
  <div class="page-head">
    <div class="kicker">Document Ledger</div>
    <h1 class="page-title">Official Documents Acquired</h1>
    <div class="page-sub">${D.documents.length} documents acquired in wave LSE-V4 · ${(D.documents.filter(d => d.fresh_status === 'FRESH').length)} recent · ${(D.documents.filter(d => d.fresh_status === 'HISTORICAL').length)} historical · ${(D.documents.filter(d => d.fresh_status === 'DATE_UNKNOWN').length)} undated. Sorted by intelligence contribution.</div>
  </div>
  <div class="panel">
  <div style="overflow-x:auto;max-height:640px;overflow-y:auto">
  <table class="data">
    <thead><tr><th>Canonical URL</th><th>Institution</th><th>Date status</th><th>Best date</th><th class="right">Facts</th><th class="right">Intel</th><th></th></tr></thead>
    <tbody>${docs.map(d => {
      const s = srcIndex[d.source_id];
      return `<tr>
        <td style="max-width:420px"><a href="#/document/${esc(d.document_id)}" style="font-family:var(--mono);font-size:11px">${esc(d.canonical_url.slice(0, 70))}${d.canonical_url.length > 70 ? '…' : ''}</a></td>
        <td style="max-width:220px;font-size:12px">${s ? esc(s.institution_name) : esc(d.source_id)}</td>
        <td>${d.fresh_status === 'FRESH' ? '<span class="badge fresh">Recent</span>' : d.fresh_status === 'HISTORICAL' ? '<span class="badge historical">Historical</span>' : '<span class="badge undated">Undated</span>'}</td>
        <td>${d.best_iso ? esc(fmtDate(d.best_iso)) : '—'}</td>
        <td class="num right">${d.n_facts}</td>
        <td class="num right">${d.n_intelligence}</td>
        <td class="right"><a class="btn ghost" href="${esc(d.canonical_url)}" target="_blank" rel="noopener">Original ↗</a></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>
  </div>`;
}

/* =========================================================================
   SOURCES BROWSE (secondary)
   ========================================================================= */
function viewSources(app) {
  const srcs = D.sources.slice().sort((a, b) => (b.n_intelligence - a.n_intelligence) || (b.unique_vio - a.unique_vio));
  app.innerHTML = `
  <div class="page-head">
    <div class="kicker">Source Registry — Wave Population</div>
    <h1 class="page-title">Official Sources</h1>
    <div class="page-sub">${D.sources.length} sources registered in wave LSE-V4 (universe after wave: 10,383).
    ${D.sources.filter(s => s.access_status === 'ACCESS_OK').length} accessible · ${D.sources.filter(s => s.n_intelligence > 0).length} produced intelligence.
    Source quality is never reduced to a single score — coverage, depth and production are shown separately.</div>
  </div>
  <div class="panel">
  <div style="overflow-x:auto;max-height:640px;overflow-y:auto">
  <table class="data">
    <thead><tr><th>Institution</th><th>Jurisdiction</th><th>Sector</th><th>Access</th><th class="right">Docs</th><th class="right">Facts</th><th class="right">VIO</th><th class="right">Recent</th><th></th></tr></thead>
    <tbody>${srcs.map(s => `
      <tr>
        <td style="max-width:280px"><a href="#/source/${esc(s.source_id)}"><b>${esc(s.institution_name)}</b></a></td>
        <td>${esc(s.jurisdiction)}</td>
        <td style="font-size:12px">${esc(s.sector_label)}</td>
        <td>${s.access_status === 'ACCESS_OK' ? '<span class="badge fresh">OK</span>' : '<span class="badge undated" title="' + esc(s.failure_class || '') + '">' + esc(s.access_status.replace('ACCESS_', '')) + '</span>'}</td>
        <td class="num right">${s.documents_acquired}</td>
        <td class="num right">${s.facts.toLocaleString()}</td>
        <td class="num right">${s.unique_vio}</td>
        <td class="num right">${s.fresh_vio}</td>
        <td class="right"><a class="btn ghost" href="#/source/${esc(s.source_id)}">Profile</a></td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

/* =========================================================================
   PRODUCTION VIEW (secondary, builders' view)
   ========================================================================= */
function viewProduction(app) {
  const p = D.production;
  const w = p.wave, b = p.before, a = p.after, v = p.verification;
  const num = x => (x == null ? '—' : Number(x).toLocaleString());
  const afterUniverse = a.registered_universe != null ? a.registered_universe
    : (p.accounting_summary && p.accounting_summary.universe_after);
  const rows = [
    ['Registered source universe', num(b.registered_universe), num(afterUniverse)],
    ['Productive sources (≥1 VIO)', num(b.productive_sources), num(a.productive_sources)],
    ['Facts (global)', num(b.facts), num(a.facts)],
    ['Events (global)', num(b.events), num(a.events)],
    ['Intelligence objects (global)', num(b.io), num(a.io)],
    ['Unique VIO (global)', num(b.unique_vio), num(a.unique_vio)],
    ['Fresh VIO (global, M2 basis)', num(b.fresh_vio_m2), num(a.fresh_vio_m2)],
  ];
  app.innerHTML = `
  <div class="page-head">
    <div class="kicker">Secondary View · Builders</div>
    <h1 class="page-title">ROUAA Core — Production</h1>
    <div class="page-sub">Production accounting for wave ${esc(p.wave_name)} (run <span style="font-family:var(--mono)">${esc(p.wave_id)}</span>),
    executed ${esc(p.executed_at)} at commit <span style="font-family:var(--mono)">${esc(D.meta.production_commit.slice(0, 7))}</span>.
    This view is deliberately secondary: the executive experience is the intelligence itself, not pipeline volume.</div>
  </div>

  <div class="section-label"><span>Wave Accounting (verbatim from Core scorecard)</span></div>
  <div class="panel"><div class="kv-grid">
    <div class="k">Population (new sources registered)</div><div class="v">${w.candidate_sources}</div>
    <div class="k">Accessible (ACCESS_OK)</div><div class="v">${w.accessible_sources_s1}</div>
    <div class="k">Sources producing documents</div><div class="v">${w.sources_producing_documents_s3}</div>
    <div class="k">VIO-producing sources</div><div class="v">${w.productive_sources_vio_basis}</div>
    <div class="k">Documents acquired</div><div class="v">${w.documents_acquired} (${w.new_unique_documents} first-claim new)</div>
    <div class="k">Usable documents</div><div class="v">${w.usable_documents} · dated: ${w.dated_documents} (recent ${w.recent_documents} / historical ${w.historical_documents})</div>
    <div class="k">Facts extracted</div><div class="v">${w.facts.toLocaleString()} (${w.new_unique_facts.toLocaleString()} new unique)</div>
    <div class="k">Events / IO produced</div><div class="v">${w.events} / ${w.io}</div>
    <div class="k">Net-new unique VIO</div><div class="v"><b>${w.new_unique_vio}</b> — recent ${w.fresh_new_vio} · historical ${w.historical_new_vio} · undated ${w.undated_new_vio}</div>
    <div class="k">Fresh window (frozen)</div><div class="v">${esc(D.meta.fresh_window.start)} → ${esc(D.meta.fresh_window.end)} (retrieval time never used as publication)</div>
  </div></div>

  <div class="section-label"><span>Global Production — Before → After This Wave</span></div>
  <div class="panel">
  <table class="data">
    <thead><tr><th>Measure</th><th class="right">Before</th><th class="right">After</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="num right">${r[1]}</td><td class="num right"><b>${r[2]}</b></td></tr>`).join('')}</tbody>
  </table>
  </div>

  <div class="section-label"><span>Verification (4-leg, from quality_verification.json)</span></div>
  <div class="panel"><div class="kv-grid">
    <div class="k">V1 — Identity chain</div><div class="v">${v.V1_identity_chain.pass ? '<span class="verdict-PASS">PASS</span>' : 'FAIL'} — ${v.V1_identity_chain.checked}/135 new VIOs checked (fact → document → source)</div>
    <div class="k">V2 — Temporal basis</div><div class="v">${v.V2_temporal.pass ? '<span class="verdict-PASS">PASS</span>' : 'FAIL'} — ${esc(v.V2_temporal.note || '')}</div>
    <div class="k">V3 — Deduplication</div><div class="v">${v.V3_dedup.pass ? '<span class="verdict-PASS">PASS</span>' : 'FAIL'} — ${v.V3_dedup.run_ios} run · ${v.V3_dedup.overlaps} re-discoveries excluded · ${v.V3_dedup.new} net-new</div>
    <div class="k">V4 — Contamination</div><div class="v">${v.V4_contamination.pass ? '<span class="verdict-PASS">PASS</span>' : 'FAIL'} — zero leak (facts/events/IOs)</div>
  </div></div>

  <div class="section-label"><span>Snapshot Provenance</span></div>
  <div class="panel"><div class="kv-grid">
    <div class="k">Core repository</div><div class="v mono">jsiadyarslan-lab/rouaa-intelligence-core</div>
    <div class="k">Production branch</div><div class="v mono">${esc(D.meta.production_branch)}</div>
    <div class="k">Production commit</div><div class="v mono">${esc(D.meta.production_commit)}</div>
    <div class="k">Artifacts directory</div><div class="v mono">artifacts/large-scale-official-source-expansion-v4/</div>
    <div class="k">Snapshot date</div><div class="v">${esc(D.meta.snapshot_date)}</div>
    <div class="k">Adapter</div><div class="v">interface/build_presentation.py — read-only export of committed store JSONL into static presentation JSON. No Core logic touched.</div>
  </div>
  <div class="mini-note">Displayed intelligence = 147 IO rows produced by the wave (135 net-new + 12 re-discoveries, per Core dedup accounting).</div>
  </div>`;
}

boot();
