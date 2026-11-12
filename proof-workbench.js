'use strict';

(() => {
  const FILES = {
    manifest: 'proof-manifest.json',
    summary: 'proof-summary.json',
    sources: 'proof-sources.json',
    runs: 'proof-runs.json',
    documents: 'proof-documents.json',
    facts: 'proof-facts.json',
    evidence: 'proof-evidence.json',
    events: 'proof-events.json',
    intelligence: 'proof-intelligence-objects.json',
    deliveries: 'proof-deliveries.json',
    quality: 'proof-quality.json'
  };

  const NAV = [
    ['overview', 'Overview'],
    ['sources', 'Source Universe'],
    ['acquisition', 'Acquisition'],
    ['documents', 'Documents'],
    ['facts', 'Facts'],
    ['evidence', 'Evidence'],
    ['events', 'Events'],
    ['intelligence', 'Intelligence Objects'],
    ['deliveries', 'Deliveries'],
    ['runs', 'Production Runs'],
    ['quality', 'Quality & Integrity']
  ];

  const $ = (id) => document.getElementById(id);
  const state = { data: null, verification: null, route: 'overview', selectedDocument: null, selectedFact: null, selectedIoId: null, candidateFilter: '', search: '' };
  const main = $('pw-main');
  const nav = $('pw-navigation');

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNum(v) {
    if (v == null) return 'NOT MEASURED';
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : String(v);
  }
  function dateLabel(v) {
    if (!v) return 'NOT AVAILABLE';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return esc(v);
    return d.toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  }
  function stateClass(value) {
    const v = String(value || '').toUpperCase();
    if (v.includes('BLOCKED') || v.includes('NOT_QUALIFIED') || v.includes('INSUFFICIENT')) return 'is-blocked';
    if (v.includes('FAILED') || v.includes('UNAVAILABLE')) return 'is-error';
    if (v.includes('FIXTURE')) return 'is-fixture';
    if (v === 'VERIFIED') return 'is-ok';
    if (v.includes('UNKNOWN') || v.includes('NOT_PROVEN') || v.includes('PENDING')) return 'is-warning';
    return 'is-muted';
  }
  function tag(value) {
    return '<span class="pw-status ' + stateClass(value) + '">' + esc(value || 'UNKNOWN') + '</span>';
  }
  function pageHead(kicker, title, desc, meta) {
    return '<div class="pw-page-head"><div><div class="pw-section-kicker">' + esc(kicker) +
      '</div><h1 class="pw-page-title">' + esc(title) + '</h1><p class="pw-page-desc">' +
      esc(desc) + '</p></div><div class="pw-page-meta">' + esc(meta || '') + '</div></div>';
  }
  function panel(title, body, note) {
    return '<section class="pw-panel"><div class="pw-panel-head"><div class="pw-panel-kicker">' + esc(title) +
      '</div>' + (note ? '<div class="pw-panel-note">' + esc(note) + '</div>' : '') +
      '</div><div class="pw-panel-body">' + body + '</div></section>';
  }
  function metric(label, value, note, route, tone) {
    const cls = route ? 'pw-metric is-clickable' : 'pw-metric';
    return '<button type="button" class="' + cls + '" ' + (route ? 'data-route="' + esc(route) + '"' : 'disabled') + '>' +
      '<span class="pw-metric-label">' + esc(label) + '</span><span class="pw-metric-value ' + (tone || '') + '">' +
      esc(fmtNum(value)) + '</span><span class="pw-metric-note">' + esc(note || '') + '</span></button>';
  }
  function toolbar(placeholder, sortOptions) {
    const opts = (sortOptions || []).map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('');
    return '<div class="pw-toolbar"><input class="pw-search" id="pw-filter" type="search" placeholder="' +
      esc(placeholder || 'Filter visible records…') + '" autocomplete="off">' +
      (opts ? '<select class="pw-select" id="pw-sort" aria-label="Sort rows">' + opts + '</select>' : '') +
      '<span class="pw-panel-note" id="pw-row-count"></span></div>';
  }
  function table(headers, rows, emptyText) {
    if (!rows.length) return '<div class="pw-empty"><div class="pw-empty-title">NO ROWS IN THIS SNAPSHOT</div>' + esc(emptyText || 'No matching records are available.') + '</div>';
    return '<div class="pw-table-wrap"><table class="pw-table"><thead><tr>' +
      headers.map(h => '<th>' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function row(cells) { return '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>'; }
  function empty(title, value, body, stateLabel) {
    return '<div class="pw-empty"><div class="pw-empty-title">' + esc(title) + '</div>' +
      (value != null ? '<div class="pw-empty-value">' + esc(value) + '</div>' : '') +
      '<div>' + esc(body) + '</div>' + (stateLabel ? '<div style="margin-top:12px">' + tag(stateLabel) + '</div>' : '') + '</div>';
  }
  function keyValue(label, value) {
    return '<div class="pw-kv"><div class="pw-kv-label">' + esc(label) + '</div><div class="pw-kv-value">' + esc(value == null || value === '' ? 'NOT AVAILABLE' : value) + '</div></div>';
  }
  function routeButton(route, label) {
    return '<button class="pw-action" data-route="' + esc(route) + '">' + esc(label) + '</button>';
  }
  function noDataNotice(text) {
    return '<div class="pw-callout is-neutral">' + esc(text) + '</div>';
  }
  function isR7Snapshot() {
    return !!(state.data && state.data.manifest && state.data.manifest.data_scope === 'R7_FIRST_VERIFIED_INTELLIGENCE_OBJECT');
  }
  function r7Fact() {
    const entries = state.data && state.data.facts && state.data.facts.entries || [];
    return entries.find(x => x.fact_id === state.selectedFact) || entries[0] || null;
  }
  function r7Io() {
    const entries = state.data && state.data.intelligence && state.data.intelligence.entries || [];
    return entries.find(x => x.io_id === state.selectedIoId) || entries[0] || null;
  }

  function renderVerificationPanel() {
    const v = state.verification || {};
    const q = state.data.quality || {};
    const raw = q.raw_document_sha256 || {};
    const artifactStates = Object.entries(v.artifactStateCounts || {})
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([name,count]) => name + ': ' + fmtNum(count)).join(' · ') || 'NOT PROVEN';
    const cell = (label, valueHtml) =>
      '<div><span class="pw-detail-label">' + esc(label) +
      '</span><div class="pw-detail-value">' + valueHtml + '</div></div>';
    const r7 = isR7Snapshot();
    const integrityNote = r7
      ? '<div class="pw-callout is-neutral"><strong>JSON export integrity and original-source integrity are separate checks.</strong> All mirrored JSON exports passed browser SHA-256, byte-length and identity checks. Core also rehashed the one original Istat HTML blob against its Representation. This does not constitute independent human review of the metric semantics.</div>'
      : '<div class="pw-callout is-neutral"><strong>VERIFIED applies only to the mirrored JSON snapshot files.</strong> It does not upgrade the original-document byte checks. The manifest reports those checks as EXECUTOR_REPORTED; this workbench has not independently re-read the 30 original raw blobs.</div>';
    const rawLabel = r7 ? 'Original document SHA-256' : 'Original-document SHA report';
    const rawDetail = r7
      ? tag(raw.state || 'NOT_PROVEN') + ' · ' + fmtNum(raw.verified) + '/' + fmtNum(raw.checked) + ' original bytes rehashed in Core Proof run'
      : tag(raw.state || 'NOT_PROVEN') + ' · ' + fmtNum(raw.verified) + '/' + fmtNum(raw.checked) + ' executor-reported matches';
    const humanReview = q.independent_review_state || (r7 ? 'PENDING_HUMAN_REVIEW' : 'NOT_PROVEN');
    return panel('VERIFICATION BOUNDARIES',
      integrityNote +
      '<div class="pw-detail-grid" style="margin-top:12px">' +
      cell('Mirrored JSON exports', tag('VERIFIED') + ' · ' + fmtNum(v.verifiedFiles) + '/' + fmtNum(v.totalFiles) + ' SHA-256 + byte length') +
      cell('Manifest verification_state', tag(v.manifestState || 'NOT_PROVEN')) +
      cell(rawLabel, rawDetail) +
      cell(r7 ? 'Independent semantic review' : 'Independent raw-byte re-read',
        r7 ? tag(humanReview) : tag('NOT_PROVEN') + ' · 0 original files re-read here') +
      cell('Manifest source-artifact states', esc(artifactStates)) +
      cell('Snapshot data_scope', esc(v.dataScope || 'NOT PROVEN')) +
      (r7 ? cell('Core commit', '<span class="pw-mono">' + esc(v.coreCommit || 'NOT PROVEN') + '</span>') : '') +
      (r7 ? cell('Run ID', '<span class="pw-mono">' + esc(v.runId || 'NOT PROVEN') + '</span>') : '') +
      (r7 ? cell('Execution ID', '<span class="pw-mono">' + esc(v.executionId || 'NOT PROVEN') + '</span>') : '') +
      cell('Snapshot kind', esc(v.snapshotKind || 'NOT PROVEN')) +
      '</div>');
  }

  function renderOverview() {
    if (isR7Snapshot()) return renderR7Overview();
    const s = state.data.summary.r4_isolated_benchmark;
    const p = state.data.summary.production_baseline;
    const funnel = [
      ['Sources configured', s.sources_configured],
      ['Sources attempted', s.sources_attempted],
      ['Sources qualified', s.sources_qualified],
      ['Documents committed', s.documents_committed],
      ['Documents qualified', s.documents_strict_qualified + s.documents_qualified_with_notes],
      ['Verified financial Facts', s.verified_financial_facts],
      ['Verified economic Events', s.verified_economic_events],
      ['Verified Intelligence Objects', s.verified_intelligence_objects],
      ['Verified Deliveries', s.verified_deliveries]
    ];
    const max = Math.max(1, ...funnel.map(x => x[1]));
    const funnelHtml = '<div class="pw-funnel">' + funnel.map(x =>
      '<div class="pw-funnel-row"><div class="pw-funnel-label">' + esc(x[0]) +
      '</div><div class="pw-track"><span style="width:' + (Math.max(0, Math.min(100, x[1] / max * 100))) + '%"></span></div>' +
      '<div class="pw-funnel-value">' + fmtNum(x[1]) + '</div></div>').join('') + '</div>';
    const pItems = [
      ['Intelligence Objects', p.io], ['Events', p.events], ['Facts', p.facts],
      ['Documents', p.documents], ['Sources', p.sources], ['Runs', p.runs]
    ];
    const pHtml = '<div class="pw-baseline-grid">' + pItems.map(x =>
      '<div class="pw-baseline-item"><div class="pw-baseline-value">' + fmtNum(x[1]) +
      '</div><span class="pw-baseline-label">' + esc(x[0]) + '</span></div>').join('') + '</div>';
    let h = pageHead('01 / EXECUTIVE VIEW', 'Overview',
      'Did Core produce verified intelligence, or did it only acquire and qualify documents? R4 acquisition and historical production are separated below.',
      'ARCHIVED SNAPSHOT · ' + dateLabel(state.data.manifest.generated_at));
    h += renderVerificationPanel();
    h += '<div class="pw-overline">R4 ISOLATED BENCHMARK · NOT PRODUCTION</div><div class="pw-grid pw-metric-grid">';
    h += metric('Sources configured', s.sources_configured, 'R4 cohort', 'sources');
    h += metric('Sources qualified', s.sources_qualified, 'Source-level QUALIFIED', 'sources');
    h += metric('Documents committed', s.documents_committed, 'Acquisition rows', 'documents');
    h += metric('Documents qualified', s.documents_strict_qualified + s.documents_qualified_with_notes, '15 strict · 14 with notes', 'documents');
    h += metric('Verified financial Facts', s.verified_financial_facts, 'Fixture rows excluded', 'facts', 'is-blocked');
    h += metric('Verified economic Events', s.verified_economic_events, 'DOCUMENT_INGESTED excluded', 'events', 'is-blocked');
    h += metric('Verified Intelligence Objects', s.verified_intelligence_objects, 'No canonical IO', 'intelligence', 'is-blocked');
    h += metric('Verified Deliveries', s.verified_deliveries, 'No IO to deliver', 'deliveries', 'is-blocked');
    h += '</div>';
    h += '<div class="pw-split"><div>' + panel('R4 PRODUCTION FUNNEL', funnelHtml, 'Counts remain tied to R4 scope') +
      panel('R4 ACQUISITION VS INTELLIGENCE', '<div class="pw-callout is-error"><strong>NO VERIFIED INTELLIGENCE OBJECTS.</strong> R4 contains 30 fixture Facts and 30 fixture Events. Those rows are excluded from financial/economic production.</div><div style="height:10px"></div>' +
      '<div class="pw-actions">' + routeButton('facts', 'Inspect Fact classification') + routeButton('events', 'Inspect Event classification') + routeButton('quality', 'Open quality ledger') + '</div>') + '</div>' +
      '<div>' + panel('SEPARATE PRODUCTION BASELINE', pHtml, 'Historical read-only counters · not R4') +
      panel('CURRENT IO PROOF DECISION', '<div class="pw-empty"><div class="pw-empty-title">OP-IO-001</div><div class="pw-empty-value">BLOCKED</div><div>No document in the 30-document R4 corpus passed value, meaning and evidence review.</div><div style="margin-top:12px">' + tag('BLOCKED_NO_SUPPORTED_INTELLIGENCE_INPUT') + '</div></div>') + '</div></div>';
    h += '<div class="pw-panel-note" style="margin-top:13px">Core commit: ' + esc(state.data.manifest.core_commit) +
      ' · Run: ' + esc(state.data.manifest.run_id) + ' · Execution: ' + esc(state.data.manifest.execution_id) + '</div>';
    main.innerHTML = h;
  }
  function renderSources() {
    if (isR7Snapshot()) return renderR7Sources();
    const entries = state.data.sources.entries.slice();
    if (state.candidateFilter) {
      const exact = state.candidateFilter;
      state.search = exact;
      state.candidateFilter = '';
    }
    const sortValue = $('pw-sort')?.value || 'candidate_id';
    entries.sort((a,b) => String(a[sortValue] ?? '').localeCompare(String(b[sortValue] ?? '')));
    const rows = entries.filter(x => searchable(x, state.search)).map(x => row([
      '<span class="pw-mono">' + esc(x.candidate_id) + '</span>',
      '<button class="pw-table-link" data-candidate="' + esc(x.candidate_id) + '">' + esc(x.institution || 'Not available') + '</button>',
      esc(x.domain || 'Not available'),
      tag(x.terminal_state),
      fmtNum(x.documents_committed),
      '<span class="pw-reason">' + esc(x.failure_reason || '—') + '</span>'
    ]));
    main.innerHTML = pageHead('02 / SOURCE REGISTRY', 'Source Universe',
      'One row per R4 candidate. Identity, terminal state and document output are shown as recorded; a qualified source is not a verified intelligence producer.',
      fmtNum(entries.length) + ' SOURCE RECORDS') +
      toolbar('Filter candidate, institution, domain or terminal state…', [['candidate_id','Candidate ID'],['institution','Institution'],['terminal_state','Terminal state'],['domain','Domain']]) +
      table(['Candidate ID','Institution','Domain','Terminal state','Documents committed','Failure / state reason'], rows, 'No source records match the current filter.');
    bindFilter();
  }
  function renderAcquisition() {
    if (isR7Snapshot()) return renderR7Acquisition();
    const s = state.data.summary.r4_isolated_benchmark;
    const r = state.data.runs.entries[0];
    const terminal = state.data.sources.entries.reduce((o,x)=>(o[x.terminal_state]=(o[x.terminal_state]||0)+1,o),{});
    const stateRows = Object.entries(terminal).sort((a,b)=>b[1]-a[1]).map(x=>row([tag(x[0]),fmtNum(x[1])]));
    main.innerHTML = pageHead('03 / ACQUISITION LEDGER', 'Acquisition',
      'Request and job accounting from the R4 isolated benchmark. Sweep-network retries and acquisition-run retries are separate ledgers.',
      'RUN ' + r.run_id) +
      '<div class="pw-grid pw-metric-grid">' +
      metric('Requests in R4 network ledger', s.network_ledger_requests, 'As reported by R4', null) +
      metric('Acquisition jobs', r.sources_configured == null ? s.acquisition_jobs_total : s.acquisition_jobs_total, '42 jobs total', null) +
      metric('Acquisition attempts', s.acquisition_job_attempts, '54 attempts across 42 jobs', null) +
      metric('Acquisition-run retries', s.acquisition_runner_retries, '12 retries on terminal errors', null, 'is-blocked') +
      metric('Sweep network retries', s.sweep_network_ledger_retries, 'Separate network-ledger counter', null) +
      metric('Jobs failed', s.acquisition_jobs_failed, 'All 12 terminal failures remained failures', null, 'is-blocked') +
      metric('Documents committed', s.documents_committed, '30 documents stored', 'documents') +
      metric('Bytes in network ledger', (s.network_ledger_bytes / 1024 / 1024).toFixed(2) + ' MB', 'Recorded network ledger bytes', null) +
      '</div>' +
      '<div class="pw-callout is-error"><strong>RETRY POLICY DEFECT FOUND.</strong> The acquisition runner made 12 retries on 301/302/404/robots errors. R4 sweep ledger reports 1 retry under its separate 429/5xx policy. These counters are not merged.</div>' +
      '<div class="pw-split" style="margin-top:13px"><div>' + panel('SOURCE TERMINAL STATES', table(['Terminal state','Sources'], stateRows), '100 candidate outcomes') +
      '</div><div>' + panel('ACQUISITION EXECUTION', keyValue('Run ID',r.run_id)+keyValue('Execution ID',r.execution_id)+keyValue('Jobs total',s.acquisition_jobs_total)+keyValue('Successful jobs',s.acquisition_jobs_success)+keyValue('Failed jobs',s.acquisition_jobs_failed)+keyValue('Policy result','R5 FIX-01 committed; tests pending')) + '</div></div>';
  }
  function searchable(record, query) {
    if (!query) return true;
    const q = String(query).toLowerCase();
    return JSON.stringify(record).toLowerCase().includes(q);
  }
  function renderDocuments() {
    if (isR7Snapshot()) return renderR7Documents();
    const entries = state.data.documents.entries.slice();
    if (state.candidateFilter) state.search = state.candidateFilter;
    const sortValue = $('pw-sort')?.value || 'publication_date';
    entries.sort((a,b)=>String(b[sortValue]||'').localeCompare(String(a[sortValue]||'')));
    const rows = entries.filter(x=>searchable(x,state.search)).map(x=>row([
      '<button class="pw-table-link pw-mono" data-document="' + esc(x.document_id) + '">' + esc(x.document_id) + '</button>',
      esc(x.title||'Not available'),
      esc(x.institution||x.source_id||'Not available'),
      esc(x.publication_date||'NOT AVAILABLE'),
      tag(x.qualification_status),
      '<span class="pw-mono">' + esc(x.content_sha256 ? x.content_sha256.slice(0,12)+'…' : 'NOT AVAILABLE') + '</span>'
    ]));
    let detail='';
    if(state.selectedDocument){
      const d=entries.find(x=>x.document_id===state.selectedDocument);
      if(d) detail='<section class="pw-detail"><div class="pw-panel-kicker">DOCUMENT DETAIL</div><h2 style="font-size:16px;font-weight:500;margin:7px 0 14px">'+esc(d.title||d.document_id)+'</h2><div class="pw-detail-grid">'+
        '<div><span class="pw-detail-label">Document ID</span><div class="pw-detail-value">'+esc(d.document_id)+'</div></div>'+
        '<div><span class="pw-detail-label">Source</span><div class="pw-detail-value">'+esc(d.institution||d.source_id||'Not available')+'</div></div>'+
        '<div><span class="pw-detail-label">Publication date</span><div class="pw-detail-value">'+esc(d.publication_date||'Not available')+'</div></div>'+
        '<div><span class="pw-detail-label">Content SHA-256</span><div class="pw-detail-value pw-mono">'+esc(d.content_sha256||'Not available')+'</div></div>'+
        '<div><span class="pw-detail-label">Qualification</span><div class="pw-detail-value">'+tag(d.qualification_status)+'</div></div>'+
        '<div><span class="pw-detail-label">Evidence status</span><div class="pw-detail-value">'+tag(d.evidence_state)+'</div></div>'+
        '</div><p class="pw-page-desc">'+esc(d.qualification_reason||'No qualification reason was recorded.')+'</p><div class="pw-actions">'+routeButton('facts','View Fact classification')+routeButton('evidence','View Evidence scope')+'</div></section>';
    }
    main.innerHTML=pageHead('04 / DOCUMENT LEDGER','Documents',
      'Thirty archived R4 documents with source, publication date, SHA-256 and battery outcome. The original binaries remain in the isolated Core proof store.',
      fmtNum(entries.length)+' DOCUMENTS')+detail+
      toolbar('Filter title, source, document ID, SHA or outcome…',[['publication_date','Publication date'],['title','Title'],['qualification_status','Qualification status']])+
      table(['Document ID','Title','Source','Publication date','Qualification','Original SHA-256'],rows,'No document records match the current filter.');
    bindFilter();
  }
  function renderFacts() {
    if (isR7Snapshot()) return renderR7Facts();
    const f=state.data.facts;
    main.innerHTML=pageHead('05 / FACT LEDGER','Facts',
      'This page distinguishes accepted financial/economic Facts from quarantined test output. Fixture rows are never represented as verified metrics.',
      'R4 ISOLATED BENCHMARK')+
      '<div class="pw-grid pw-metric-grid">'+
      metric('Verified financial Facts',0,'No accepted Fact',null,'is-blocked')+
      metric('Fixture Fact rows',f.fixture_outputs.count,'fixture_word_count',null)+
      metric('Non-fixture Fact candidates',0,'No supported candidate after review',null)+
      metric('Production Baseline Facts',state.data.summary.production_baseline.facts,'Separate historical scope',null)+'</div>'+
      panel('QUARANTINED FIXTURE OUTPUTS',
        '<div class="pw-callout"><strong>FIXTURE_NOT_INTELLIGENCE.</strong> The 30 R4 Fact rows use metric <span class="pw-mono">fixture_word_count</span>. The value is a word count derived from document text, not a financial/economic statistic. It is excluded from Intelligence Objects and verified Facts.</div>'+
        '<div style="margin-top:12px">'+keyValue('Stored rows',f.fixture_outputs.count)+keyValue('Metric',f.fixture_outputs.metric)+keyValue('Classification',f.fixture_outputs.classification)+keyValue('Verified financial Facts',0)+'</div>'+
        '<div class="pw-actions" style="margin-top:12px">'+routeButton('evidence','Inspect fixture evidence scope')+routeButton('quality','Inspect quality and integrity')+'</div>');
  }
  function renderEvidence() {
    if (isR7Snapshot()) return renderR7Evidence();
    const e=state.data.evidence;
    main.innerHTML=pageHead('06 / EVIDENCE REVIEW','Evidence',
      'Evidence rows must support the exact Fact value, semantic meaning, unit and temporal scope. R4 evidence is attached to fixture output and is not production proof.',
      fmtNum(e.inventory_rows)+' RECORDED ROWS')+
      '<div class="pw-grid pw-metric-grid">'+
      metric('Recorded Evidence rows',e.inventory_rows,'Raw R4 metadata count',null)+
      metric('Fixture-bound Evidence',e.fixture_bound_rows,'Evidence attached to fixture Fact/Event rows',null)+
      metric('Production Evidence excerpts',0,'No accepted intelligence evidence',null,'is-blocked')+
      metric('Original document SHA claims',state.data.quality.raw_document_sha256.checked,'EXECUTOR_REPORTED · not independently re-read here',null,'is-warning')+
      metric('Independent raw-byte re-reads',0,'NOT_PROVEN in this workbench',null,'is-blocked')+'</div>'+
      empty('NO PRODUCTION EVIDENCE AVAILABLE', '60 FIXTURE-BOUND ROWS',
        'The 60 recorded Evidence rows support quarantined fixture outputs. This snapshot does not expose them as evidence for a financial Fact. Original document SHA-256 fingerprints are recorded separately.',
        'FIXTURE');
  }
  function renderEvents() {
    if (isR7Snapshot()) return renderR7Events();
    const e=state.data.events;
    main.innerHTML=pageHead('07 / EVENT LEDGER','Events',
      'Only supported economic/financial event types are shown as intelligence. Document arrival is not an economic event.',
      'R4 ISOLATED BENCHMARK')+
      '<div class="pw-grid pw-metric-grid">'+
      metric('Verified economic Events',0,'No supported Event passed review',null,'is-blocked')+
      metric('Fixture Event rows',e.fixture_outputs.count,'DOCUMENT_INGESTED',null)+
      metric('Fixture Event type',null,e.fixture_outputs.event_type,null)+
      metric('Production Baseline Events',state.data.summary.production_baseline.events,'Separate historical scope',null)+'</div>'+
      '<div class="pw-callout is-error"><strong>DOCUMENT_INGESTED IS NOT AN ECONOMIC EVENT.</strong> The R4 Event rows are test bookkeeping and remain excluded from canonical intelligence.</div>'+
      empty('NO VERIFIED ECONOMIC EVENTS',0,'No R4 document supported a Fact and an Event of an existing Core type after value, meaning and Evidence review.','NOT_PROVEN');
  }
  function renderIntelligence() {
    if (isR7Snapshot()) return renderR7Intelligence();
    main.innerHTML=pageHead('08 / CANONICAL OUTPUT','Intelligence Objects',
      'A canonical IO must connect an accepted Event, Fact versions, original Evidence, document, source and Provenance. No placeholder object is shown.',
      'CANONICAL CORE CONTRACT')+
      '<div class="pw-callout is-error"><strong>BLOCKED_NO_SUPPORTED_INTELLIGENCE_INPUT.</strong> The 30-document cohort did not yield an accepted Fact and supported Event. IO creation is deliberately withheld.</div>'+
      '<div style="height:12px"></div>'+
      empty('NO VERIFIED INTELLIGENCE OBJECTS',0,
        'The source → document → fact → evidence → event → IO → delivery chain is not complete for this snapshot. An IO ID, headline or placeholder would be fabricated.',
        'BLOCKED');
  }
  function renderDeliveries() {
    if (isR7Snapshot()) return renderR7Deliveries();
    main.innerHTML=pageHead('09 / CONSUMER DELIVERY','Deliveries',
      'IO creation, delivery record creation, API success and external receipt are different states. This ledger shows only Core delivery records.',
      'READ ONLY')+
      '<div class="pw-callout is-neutral">A successful database write or an IO-shaped JSON object is not proof that an external consumer received the intelligence.</div>'+
      '<div style="height:12px"></div>'+
      empty('NO DELIVERY RECORDS',0,'No canonical Intelligence Object exists in the R4 proof scope, so no Delivery was created and no external consumer receipt is claimed.','NOT_PROVEN');
  }
  function renderRuns() {
    if (isR7Snapshot()) return renderR7Runs();
    const r=state.data.runs.entries[0], p=state.data.summary.production_baseline;
    main.innerHTML=pageHead('10 / EXECUTION HISTORY','Production Runs',
      'Run and execution identity are displayed separately. Historical production counters are not merged into the isolated R4 benchmark.',
      'R4 + SEPARATE BASELINE')+
      panel('R4 ISOLATED EXECUTION',keyValue('Run ID',r.run_id)+keyValue('Execution ID',r.execution_id)+
        keyValue('Plan',r.plan_id)+keyValue('Branch',r.branch)+keyValue('Core commit',r.core_commit)+
        keyValue('Status',r.status)+keyValue('Sources configured',r.sources_configured)+
        keyValue('Sources attempted',r.sources_attempted)+keyValue('Sources qualified',r.sources_qualified)+
        keyValue('Documents committed',r.documents_committed)+keyValue('Fixture Facts / Events',r.fixture_facts+' / '+r.fixture_events)+
        keyValue('Verified IO / Deliveries',r.intelligence_objects+' / '+r.deliveries)+
        keyValue('Acquisition attempts / retries',r.acquisition_attempts+' / '+r.acquisition_retries)+
        keyValue('Sweep ledger retries',r.sweep_network_ledger_retries)+
        keyValue('Retry accounting',r.retry_accounting_state), 'R4 isolated benchmark')+
      panel('PRODUCTION BASELINE — SEPARATE SCOPE',
        '<div class="pw-callout">These counters are a historical production read-only probe. They are not part of R4 and are not new R5 output.</div>'+
        '<div style="height:10px"></div><div class="pw-baseline-grid">'+
        [['IO',p.io],['Events',p.events],['Facts',p.facts],['Documents',p.documents],['Sources',p.sources],['Runs',p.runs]].map(x=>
          '<div class="pw-baseline-item"><div class="pw-baseline-value">'+fmtNum(x[1])+'</div><span class="pw-baseline-label">'+esc(x[0])+'</span></div>').join('')+'</div>');
  }
  function renderQuality() {
    if (isR7Snapshot()) return renderR7Quality();
    const q=state.data.quality;
    main.innerHTML=pageHead('11 / ACCEPTANCE CONTROLS','Quality & Integrity',
      'Integrity controls, document qualification, fixture separation and the independent-review state. Passing storage checks does not prove intelligence semantics.',
      'R4 INTEGRITY + R5 OP-IO-001')+
      '<div class="pw-grid pw-metric-grid">'+
      metric('Raw document SHA claims',q.raw_document_sha256.checked,'EXECUTOR_REPORTED · '+q.raw_document_sha256.verified+' reported matches',null,'is-warning')+
      metric('Independent raw-byte re-reads',0,'NOT_PROVEN in this workbench',null,'is-blocked')+
      metric('Orphan blobs',q.orphan_blobs,'Executor-reported R4 integrity',null)+
      metric('False SUCCESS',q.false_success,'Executor-reported R4 integrity',null)+'</div>'+
      renderVerificationPanel()+
      panel('DOCUMENT BATTERY',keyValue('Strict qualified',q.document_qualification.strict)+
        keyValue('Qualified with notes',q.document_qualification.with_notes)+
        keyValue('Not qualified',q.document_qualification.not_qualified)+
        keyValue('Documents reviewed',30))+
      panel('PROVENANCE & STORE INTEGRITY',keyValue('Documents active',q.documents_active)+
        keyValue('Representations',q.representations)+keyValue('Fixture Fact rows',q.fixture_facts)+
        keyValue('Fixture Event rows',q.fixture_events)+keyValue('Evidence rows',q.evidence_rows)+
        keyValue('Provenance complete (storage links)',String(q.provenance_complete))+ 
        keyValue('Raw-document fingerprint state',q.raw_document_sha256.state))+
      panel('OP-IO-001 ELIGIBILITY',keyValue('Documents reviewed',q.op_io_001.documents_reviewed)+
        keyValue('Acquisition only',q.op_io_001.acquisition_only)+
        keyValue('Unsupported content',q.op_io_001.unsupported_content)+
        keyValue('Insufficient evidence',q.op_io_001.insufficient_evidence)+
        keyValue('Final eligible',q.op_io_001.final_eligible)+
        keyValue('Verdict',q.op_io_001.verdict))+
      '<div class="pw-callout is-error"><strong>HUMAN REVIEW PENDING.</strong> The machine audit is an eligibility decision, not an independent human acceptance of a future Fact/Event/IO chain.</div>';
  }
  function r7Rows(section) {
    return (state.data && state.data[section] && state.data[section].entries) || [];
  }
  function r7Document() {
    const docs = r7Rows('documents');
    return docs.find(d => d.document_id === state.selectedDocument) || docs[0] || null;
  }
  function r7EvidenceForFact(fact) {
    if (!fact) return [];
    return (state.data.evidence.evidence_items || []).filter(e =>
      e.event_or_fact_id === fact.fact_id || e.evidence_id === fact.evidence_id);
  }
  function r7SourceLink(doc) {
    const url = doc && (doc.canonical_url || doc.source_url);
    return url ? '<a class="pw-table-link" href="' + esc(url) +
      '" target="_blank" rel="noopener noreferrer">OPEN OFFICIAL SOURCE ↗</a>' : 'NOT AVAILABLE';
  }
  function r7FactValue(fact) {
    if (!fact) return 'NOT AVAILABLE';
    return fmtNum(fact.value) + (fact.unit ? ' ' + esc(fact.unit) : '') +
      (fact.currency ? ' ' + esc(fact.currency) : '');
  }
  function r7ChainStep(label, value, stateLabel, route) {
    return '<button class="pw-baseline-item" ' + (route ? 'data-route="' + esc(route) + '"' : 'disabled') +
      '><div class="pw-baseline-value">' + esc(value) + '</div>' +
      '<span class="pw-baseline-label">' + esc(label) + '</span>' +
      '<div style="margin-top:7px">' + tag(stateLabel || 'OBSERVED') + '</div></button>';
  }
  function renderR7Overview() {
    const c = state.data.summary.r7_first_verified_intelligence_object || {};
    const fact = r7Fact();
    const io = r7Io();
    const pending = fact && fact.quality_state || state.data.quality.independent_review_state || 'NOT_PROVEN';
    const metrics =
      metric('Acquisition source', c.sources_attempted, 'One existing statistical agency source', 'sources') +
      metric('Official documents', c.documents_committed, 'One original Istat release', 'documents') +
      metric('Facts with direct Evidence', c.verified_financial_facts, 'Semantic reviewer acceptance pending', 'facts', 'is-warning') +
      metric('Economic Events', c.verified_economic_events, 'statistical_release', 'events') +
      metric('Canonical Intelligence Objects', c.verified_intelligence_objects, 'Core API readback observed', 'intelligence') +
      metric('Deliveries', c.verified_deliveries, 'Consumer API readback observed', 'deliveries');
    const chain = '<div class="pw-baseline-grid">' +
      r7ChainStep('Official Source', c.sources_attempted || 0, 'OBSERVED', 'sources') +
      r7ChainStep('Original Document', c.documents_committed || 0, 'OBSERVED', 'documents') +
      r7ChainStep('Fact', fact ? fact.value + ' ' + (fact.unit || '') : 'NOT AVAILABLE', pending, 'facts') +
      r7ChainStep('Evidence', (state.data.evidence.evidence_items || []).length, 'DIRECT', 'evidence') +
      r7ChainStep('Event', c.verified_economic_events || 0, 'OBSERVED', 'events') +
      r7ChainStep('Intelligence Object', io ? io.io_id : 'NOT AVAILABLE', 'OBSERVED', 'intelligence') +
      r7ChainStep('Delivery', c.verified_deliveries || 0, 'OBSERVED', 'deliveries') +
      '</div>';
    return pageHead('01 / R7 EXECUTIVE VIEW', 'First Intelligence Object',
      'One official Istat release processed by Core. Acquisition, Fact/Evidence, Event, IO and Delivery remain separate acceptance states.',
      'ARCHIVED PROOF SNAPSHOT · ONE DOCUMENT') +
      '<div class="pw-callout is-neutral"><strong>Machine pipeline observed; independent semantic review remains pending.</strong> The Core pipeline selected a direct structural Evidence segment for the annual NIC inflation Fact. This page does not promote that Fact to human-verified intelligence.</div>' +
      '<div class="pw-grid pw-metric-grid">' + metrics + '</div>' +
      panel('CANONICAL PROVENANCE CHAIN', chain) +
      panel('SELECTED FINANCIAL METRIC',
        fact ? '<div class="pw-baseline-value">' + esc(r7FactValue(fact)) + '</div>' +
          '<div class="pw-page-desc">' + esc(fact.entity) + ' · ' + esc(fact.reference_period) +
          ' · Published ' + esc(fact.publication_date) + '</div>' +
          '<div style="margin-top:12px">' + tag(fact.quality_state) + '</div>' +
          '<div class="pw-actions" style="margin-top:12px">' +
          '<button class="pw-action" data-fact="' + esc(fact.fact_id) + '">Inspect Fact and Evidence</button>' +
          '<button class="pw-action" data-io="' + esc(io && io.io_id || '') + '">Inspect Canonical IO</button></div>'
          : empty('NO FACT IN THIS SNAPSHOT', null, 'The Core export contains no Fact row.', 'NOT_PROVEN'));
  }
  function renderR7Sources() {
    const rows = r7Rows('sources').map(x => row([
      '<span class="pw-mono">' + esc(x.candidate_id) + '</span>',
      esc(x.institution || 'NOT AVAILABLE'),
      esc(x.institution_id || 'NOT AVAILABLE'),
      esc(x.source_class || 'NOT AVAILABLE'),
      esc(x.domain || 'NOT AVAILABLE'),
      tag(x.qualification_status || x.terminal_state),
      '<a class="pw-table-link" href="' + esc(x.official_endpoint || '') +
        '" target="_blank" rel="noopener noreferrer">OPEN FEED ↗</a>'
    ]));
    return pageHead('02 / SOURCE REGISTRY', 'Source Universe',
      'Only the existing src-istat registry record is represented in the R7 proof scope. No source expansion was performed.',
      '1 EXISTING SOURCE') +
      table(['Source ID','Institution','Institution ID','Source Class','Official Domain','Qualification','Endpoint'], rows,
        'The R7 Core export has no source record.');
  }
  function renderR7Acquisition() {
    const run = r7Rows('runs')[0] || {};
    const ex = state.data.manifest;
    const api = run.api_readback || {};
    return pageHead('03 / ACQUISITION LEDGER', 'Acquisition',
      'A single existing RSS source and a single selected document URL. Representation changes caused by request instrumentation are tracked separately from the stable semantic Fact.',
      'ONE SOURCE · ONE DOCUMENT') +
      panel('BOUNDED EXECUTION',
        keyValue('Source ID', 'src-istat') +
        keyValue('Run ID', ex.run_id) +
        keyValue('Execution ID', ex.execution_id) +
        keyValue('Core commit', ex.core_commit) +
        keyValue('Run status', run.status) +
        keyValue('Sources configured / attempted / qualified',
          [run.sources_configured,run.sources_attempted,run.sources_qualified].join(' / ')) +
        keyValue('Documents committed', run.documents_committed) +
        keyValue('Canonical IO / Deliveries',
          [run.intelligence_objects,run.deliveries].join(' / ')) +
        keyValue('API readback state', api.io_id || 'NOT AVAILABLE')) +
      panel('SCOPE GUARDRAILS',
        '<div class="pw-callout is-neutral">No R4 replay, batch acquisition, new source registration, production Store write or live deployment is represented in this R7 snapshot.</div>');
  }
  function renderR7Documents() {
    const docs = r7Rows('documents');
    const selected = r7Document();
    const rows = docs.map(d => row([
      '<button class="pw-table-link pw-mono" data-document="' + esc(d.document_id) + '">' + esc(d.document_id) + '</button>',
      esc(d.title || 'NOT AVAILABLE'),
      esc(d.institution || d.source_id || 'NOT AVAILABLE'),
      esc(d.publication_date || 'NOT AVAILABLE'),
      tag(d.qualification_status || 'OBSERVED'),
      '<span class="pw-mono">' + esc((d.content_sha256 || '').slice(0,16)) + '…</span>'
    ]));
    const detail = selected ? panel('ORIGINAL DOCUMENT DETAIL',
      keyValue('Title', selected.title) +
      keyValue('Publisher', selected.institution) +
      keyValue('Source ID', selected.source_id) +
      keyValue('Publication Date', selected.publication_date) +
      keyValue('Canonical URL', selected.canonical_url) +
      keyValue('Content Type', selected.content_type) +
      keyValue('Reuse Licence', selected.reuse_license) +
      keyValue('Original SHA-256', selected.content_sha256) +
      keyValue('Fact reference period', (r7Fact() || {}).reference_period) +
      '<div class="pw-actions" style="margin-top:12px">' + r7SourceLink(selected) +
      '<button class="pw-action" data-route="facts">Open extracted Fact</button></div>')
      : empty('NO DOCUMENT', null, 'No document record is present.', 'NOT_PROVEN');
    return pageHead('04 / DOCUMENT LEDGER', 'Official Documents',
      'The original Istat publication is retained in the isolated Core Proof Store. The published period and source publication date are kept distinct.',
      docs.length + ' DOCUMENT') +
      detail + table(['Document ID','Title','Publisher','Publication Date','Qualification','Original SHA-256'], rows,
        'No document row was exported by Core.');
  }
  function renderR7Facts() {
    const facts = r7Rows('facts');
    const selected = r7Fact();
    const rows = facts.map(f => row([
      '<button class="pw-table-link pw-mono" data-fact="' + esc(f.fact_id) + '">' + esc(f.fact_id) + '</button>',
      esc(f.metric),
      '<strong>' + esc(f.value) + '</strong> ' + esc(f.unit || ''),
      esc(f.entity || 'NOT AVAILABLE'),
      esc(f.reference_period || 'NOT AVAILABLE'),
      tag(f.quality_state || 'NOT_PROVEN')
    ]));
    let detail = '';
    if (selected) {
      const ev = r7EvidenceForFact(selected);
      detail = panel('CANONICAL FACT DETAIL',
        keyValue('Metric', selected.metric) +
        keyValue('Normalized Value', selected.value) +
        keyValue('Raw Value', selected.raw_value) +
        keyValue('Unit', selected.unit) +
        keyValue('Currency', selected.currency || 'NOT APPLICABLE') +
        keyValue('Entity', selected.entity) +
        keyValue('Reference Period', selected.reference_period) +
        keyValue('Publication Date', selected.publication_date) +
        keyValue('Source / Document', selected.source_id + ' / ' + selected.document_id) +
        keyValue('Fact ID / Version', selected.fact_id + ' / ' + selected.fact_version) +
        keyValue('Evidence ID', selected.evidence_id) +
        keyValue('Pattern ID / Version', selected.pattern_id + ' / ' + selected.pattern_version) +
        keyValue('Extraction Version', selected.extraction_version) +
        keyValue('Evidence records', ev.length) +
        '<div style="margin-top:12px">' + tag(selected.quality_state || 'NOT_PROVEN') + '</div>' +
        '<div class="pw-actions" style="margin-top:12px">' +
        '<button class="pw-action" data-route="evidence">Inspect supporting Evidence</button>' +
        '<button class="pw-action" data-route="intelligence">Inspect linked IO</button></div>');
    }
    return pageHead('05 / FACT LEDGER', 'Financial Facts',
      'The annual inflation Fact is an observed Core extraction with direct Evidence selected. Independent human semantic acceptance is still pending.',
      facts.length + ' FACT') + detail +
      table(['Fact ID','Metric','Value / Unit','Entity','Reference Period','Quality State'], rows,
        'No Fact rows were produced by Core.');
  }
  function renderR7Evidence() {
    const evidence = state.data.evidence.evidence_items || [];
    const fact = r7Fact();
    const doc = r7Document();
    const selected = evidence.filter(e => !fact || e.event_or_fact_id === fact.fact_id || e.evidence_id === fact.evidence_id);
    const cards = selected.map(e =>
      '<section class="pw-detail" style="margin-bottom:12px">' +
      '<div class="pw-panel-kicker">ORIGINAL STRUCTURAL EVIDENCE · ' + esc(e.segment_type || 'NOT AVAILABLE') + '</div>' +
      '<div style="margin:10px 0">' + tag('DIRECT') + ' ' + tag(state.data.evidence.state || 'OBSERVED') + '</div>' +
      '<blockquote class="pw-evidence-quote">' + esc(e.excerpt || 'NO EXCERPT EXPORTED') + '</blockquote>' +
      '<div class="pw-detail-grid">' +
      '<div><span class="pw-detail-label">Evidence ID</span><div class="pw-detail-value">' + esc(e.evidence_id) + '</div></div>' +
      '<div><span class="pw-detail-label">Fact ID</span><div class="pw-detail-value">' + esc(e.event_or_fact_id) + '</div></div>' +
      '<div><span class="pw-detail-label">Segment ID</span><div class="pw-detail-value">' + esc(e.segment_id) + '</div></div>' +
      '<div><span class="pw-detail-label">Representation ID</span><div class="pw-detail-value">' + esc(e.representation_id) + '</div></div>' +
      '<div><span class="pw-detail-label">Location</span><div class="pw-detail-value">' + esc(e.location) + '</div></div>' +
      '<div><span class="pw-detail-label">Provenance</span><div class="pw-detail-value">' + esc(e.provenance_ref) + '</div></div>' +
      '</div><div class="pw-actions" style="margin-top:12px">' +
      '<button class="pw-action" data-fact="' + esc(e.event_or_fact_id) + '">Back to Fact</button>' +
      (doc ? r7SourceLink(doc) : '') +
      '</div></section>').join('');
    return pageHead('06 / EVIDENCE REVIEW', 'Original Evidence',
      'Evidence excerpt is taken from the selected primary structural segment of the original Istat HTML. The excerpt contains the exact captured value and its annual CPI context.',
      evidence.length + ' EVIDENCE RECORD') +
      '<div class="pw-callout is-neutral">No excerpt was authored in the UI. The text below is carried verbatim from the Core Evidence record.</div>' +
      (cards || empty('NO EVIDENCE', null, 'Core did not export an Evidence segment for the selected Fact.', 'NOT_PROVEN'));
  }
  function renderR7Events() {
    const events = r7Rows('events');
    const rows = events.map(e => row([
      '<span class="pw-mono">' + esc(e.event_id) + '</span>',
      tag(e.event_type),
      esc(e.event_version),
      esc(e.document_id),
      esc((e.fact_version_snapshot || []).map(x => x.fact_id + ':v' + x.fact_version).join(', ')),
      tag(e.status || 'OBSERVED')
    ]));
    return pageHead('07 / EVENT LEDGER', 'Statistical Release Events',
      'The Event is generated by Core Event Detection from the accepted Fact. Document ingestion is not treated as an economic Event.',
      events.length + ' EVENT') +
      table(['Event ID','Event Type','Version','Document ID','Fact Snapshot','State'], rows,
        'No statistical_release Event was exported by Core.');
  }
  function renderR7Intelligence() {
    const io = r7Io();
    if (!io) return pageHead('08 / CANONICAL OUTPUT','Intelligence Objects',
      'Canonical Core Intelligence Objects with original Fact/Evidence/Document/Source provenance.',
      '0 IO') + empty('NO CANONICAL IO', 0, 'Core did not export an Intelligence Object.', 'NOT_PROVEN');
    const links = io.chain || [];
    const link = links[0] || {};
    const fact = link.fact || {};
    const evs = link.evidence || [];
    const doc = link.document || {};
    const source = link.source || {};
    return pageHead('08 / CANONICAL OUTPUT', 'Intelligence Object',
      'This is the canonical IO returned by Core API readback. Its metric semantics are taken from the nested Fact chain, not a UI-authored summary.',
      io.io_id) +
      panel('CANONICAL INTELLIGENCE OBJECT',
        keyValue('IO ID / Version', io.io_id + ' / ' + io.version) +
        keyValue('Headline', io.headline) +
        keyValue('Event Type', io.event_type) +
        keyValue('Event ID / Version', io.event_id + ' / ' + io.event_version) +
        keyValue('Created At', io.created_at) +
        keyValue('Metric', fact.metric) +
        keyValue('Value / Unit', (fact.value || 'NOT AVAILABLE') + ' ' + (fact.unit || '')) +
        keyValue('Entity', fact.entity) +
        keyValue('Reference Period', fact.reference_period) +
        keyValue('Publication Date', fact.publication_date) +
        keyValue('Pattern / Extraction', fact.pattern_id + ' / ' + fact.extraction_version) +
        keyValue('Human Review State', fact.quality_state || 'PENDING_HUMAN_REVIEW') +
        '<div style="margin-top:10px">' + tag(fact.quality_state || 'PENDING_HUMAN_REVIEW') + '</div>') +
      panel('PROVENANCE CHAIN',
        keyValue('Source', source.source_id + ' / ' + source.institution_id) +
        keyValue('Document ID', doc.document_id) +
        keyValue('Canonical Source URL', doc.canonical_url) +
        keyValue('Fact ID', fact.fact_id + ' / v' + fact.fact_version) +
        keyValue('Evidence ID', fact.evidence_id) +
        keyValue('Evidence rows', evs.length) +
        keyValue('Representation ID', link.representation && link.representation.representation_id) +
        keyValue('Content SHA-256', link.representation && link.representation.content_sha256) +
        '<div class="pw-actions" style="margin-top:12px">' +
        '<button class="pw-action" data-fact="' + esc(fact.fact_id || '') + '">Inspect Fact</button>' +
        '<button class="pw-action" data-route="evidence">Inspect Evidence</button>' +
        '<button class="pw-action" data-route="deliveries">Inspect Delivery</button></div>') +
      panel('API READBACK',
        keyValue('API list count', state.data.summary.r7_isolated_benchmark.verified_intelligence_objects) +
        keyValue('Readback', state.data.summary.classification || 'OBSERVED') +
        keyValue('Snapshot kind', state.data.manifest.snapshot_kind));
  }
  function renderR7Deliveries() {
    const deliveries = r7Rows('deliveries');
    const rows = deliveries.map(d => row([
      '<span class="pw-mono">' + esc(d.delivery_id) + '</span>',
      esc(d.intelligence_object_id),
      esc(d.destination),
      tag(d.status),
      esc(d.idempotency_key),
      esc(d.created_at)
    ]));
    return pageHead('09 / CONSUMER DELIVERY', 'Deliveries',
      'Core Delivery record and separate consumer readback status. A ledger entry alone is not treated as external receipt.',
      deliveries.length + ' DELIVERY') +
      panel('CONSUMER READBACK',
        keyValue('Consumer API readback', state.data.deliveries.consumer_readback) +
        keyValue('Delivery state', state.data.deliveries.state)) +
      table(['Delivery ID','IO ID','Destination','Status','Idempotency Key','Created At'], rows,
        'No Delivery record was exported by Core.');
  }
  function renderR7Runs() {
    const run = r7Rows('runs')[0] || {};
    const summary = state.data.summary.r7_first_verified_intelligence_object || {};
    const io = r7Io();
    return pageHead('10 / EXECUTION HISTORY', 'R7 Proof Run',
      'One source, one selected original document, isolated Core Proof Store, bounded rerun and actual Core API readback.',
      run.run_id || 'NOT AVAILABLE') +
      panel('EXECUTION IDENTITY',
        keyValue('Run ID', run.run_id) +
        keyValue('Execution ID', run.execution_id) +
        keyValue('Core Commit', run.core_commit) +
        keyValue('Branch', run.branch) +
        keyValue('Plan', run.plan_id) +
        keyValue('Status', run.status) +
        keyValue('Data Scope', state.data.manifest.data_scope) +
        keyValue('Snapshot Kind', state.data.manifest.snapshot_kind)) +
      panel('IDEMPOTENCY / API',
        keyValue('Fact / Evidence / Event / IO / Delivery counts',
          [summary.verified_financial_facts, state.data.evidence.inventory_rows,
           summary.verified_economic_events, summary.verified_intelligence_objects,
           summary.verified_deliveries].join(' / ')) +
        keyValue('API list IO', io && io.io_id) +
        keyValue('API readback', (run.api_readback || {}).io_id) +
        keyValue('ETag', (run.api_readback || {}).etag) +
        keyValue('If-None-Match', (run.api_readback || {}).if_none_match_status) +
        keyValue('Second-run Delivery created', false));
  }
  function renderR7Quality() {
    const q = state.data.quality || {};
    const raw = q.raw_document_sha256 || {};
    return pageHead('11 / ACCEPTANCE CONTROLS', 'R7 Quality & Integrity',
      'Cryptographic integrity, original Fact/Evidence binding, API readback, idempotency and independent semantic review are displayed as separate claims.',
      'R7 ONE-DOCUMENT PROOF') +
      '<div class="pw-grid pw-metric-grid">' +
      metric('Original document SHA-256', raw.verified, 'One original blob rehashed against Representation', null, raw.state === 'VERIFIED' ? '' : 'is-warning') +
      metric('Direct Evidence', q.direct_evidence, 'Selected primary structural segment', 'evidence') +
      metric('IO API readback', q.api_readback ? 1 : 0, 'ProductionTransportHandler', 'intelligence') +
      metric('Idempotency', q.idempotency ? 1 : 0, 'Semantic Fact/Evidence/IO/Delivery counts stable', 'runs') +
      '</div>' +
      renderVerificationPanel() +
      panel('QUALITY BOUNDARIES',
        keyValue('Raw SHA state', raw.state) +
        keyValue('Raw SHA method', raw.method) +
        keyValue('Independent review', q.independent_review_state) +
        keyValue('Fact quality state', q.quality_state) +
        keyValue('Fixture Facts / Events', q.fixture_facts + ' / ' + q.fixture_events) +
        keyValue('API ETag 304', q.etag_304) +
        keyValue('Idempotency accepted', q.idempotency)) +
      '<div class="pw-callout is-error"><strong>INDEPENDENT HUMAN REVIEW PENDING.</strong> Machine extraction and API delivery have not been promoted to a human-verified intelligence claim.</div>';
  }

  function render() {
    nav.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('is-active',a.dataset.route===state.route));
    state.search = '';
    state.selectedDocument = state.route==='documents' ? state.selectedDocument : null;
    switch(state.route){
      case 'sources': renderSources(); break;
      case 'acquisition': renderAcquisition(); break;
      case 'documents': renderDocuments(); break;
      case 'facts': renderFacts(); break;
      case 'evidence': renderEvidence(); break;
      case 'events': renderEvents(); break;
      case 'intelligence': renderIntelligence(); break;
      case 'deliveries': renderDeliveries(); break;
      case 'runs': renderRuns(); break;
      case 'quality': renderQuality(); break;
      default: state.route='overview'; renderOverview();
    }
  }
  function bindFilter() {
    const input=$('pw-filter'), sort=$('pw-sort'), count=$('pw-row-count');
    const update=()=> {
      state.search=input?.value||'';
      const rows=Array.from(main.querySelectorAll('.pw-table tbody tr'));
      let visible=0;
      rows.forEach(r=>{
        const show=r.textContent.toLowerCase().includes(state.search.toLowerCase());
        r.hidden=!show;if(show)visible++;
      });
      if(count) count.textContent=visible+' / '+rows.length+' ROWS';
    };
    input?.addEventListener('input',update);
    sort?.addEventListener('change',()=>{
      const query = input?.value || '';
      render();
      const newInput = $('pw-filter');
      if (newInput) {
        newInput.value = query;
        newInput.dispatchEvent(new Event('input'));
      }
    });
    update();
  }
  function renderNav(){
    nav.innerHTML=NAV.map((x,i)=>'<a class="pw-nav-link" href="#'+esc(x[0])+'" data-route="'+esc(x[0])+'"><span class="pw-nav-index">'+String(i+1).padStart(2,'0')+'</span><span>'+esc(x[1])+'</span></a>').join('');
  }
  async function loadSnapshot(){
    state.data = null;
    state.verification = null;
    try{
      const fetched = await Promise.all(Object.entries(FILES).map(async ([key,file])=>{
        const response=await fetch('./proof-data/'+file,{
          credentials:'same-origin',
          cache:'no-store'
        });
        if(!response.ok) throw new Error(file+' → HTTP '+response.status);
        return {key,file,bytes:new Uint8Array(await response.arrayBuffer())};
      }));
      const manifestBytes=fetched.find(x=>x.key==='manifest')?.bytes;
      if(!manifestBytes) throw new Error('Proof manifest is missing');
      const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
      const exportFiles=fetched.filter(x=>x.key!=='manifest');
      const exportBytes=new Map(exportFiles.map(x=>[x.file,x.bytes]));
      const expectedFiles=Object.entries(FILES)
        .filter(([key])=>key!=='manifest').map(([,file])=>file);
      if(!globalThis.ROUAAProofIntegrity ||
         typeof globalThis.ROUAAProofIntegrity.verifySnapshot!=='function'){
        throw new Error('Snapshot integrity verifier is unavailable');
      }
      const verification=await globalThis.ROUAAProofIntegrity.verifySnapshot(
        manifest,exportBytes,expectedFiles);
      const payloads={};
      for(const [key,file] of Object.entries(FILES)){
        if(key!=='manifest') payloads[key]=verification.payloads[file];
      }
      state.data={manifest,...payloads};
      state.verification=verification;
      $('pw-snapshot-time').textContent='SNAPSHOT '+dateLabel(manifest.generated_at)+' · '+manifest.data_scope;
      $('pw-source-state').textContent='SNAPSHOT HASHES VERIFIED · SOURCE: '+manifest.verification_state;
      $('pw-source-state').classList.remove('is-error');
      $('pw-source-state').classList.add('is-ready');
      render();
    }catch(error){
      state.data=null;
      state.verification=null;
      $('pw-source-state').textContent='DATA SOURCE UNAVAILABLE';
      $('pw-source-state').classList.remove('is-ready');
      $('pw-source-state').classList.add('is-error');
      main.innerHTML='<div class="pw-unavailable">'+
        '<div class="pw-section-kicker">PROOF SOURCE / INTEGRITY ERROR</div>'+
        '<div class="pw-unavailable-title">DATA SOURCE UNAVAILABLE</div>'+
        '<h1 class="pw-page-title" style="margin:8px 0 12px">Core proof snapshot failed integrity validation.</h1>'+
        '<div class="pw-callout is-error">The workbench will not render a partial or unverified snapshot, and will not substitute mock data. Verify the Core-owned manifest and every declared JSON export, then reload.</div>'+
        '<p class="pw-page-desc">'+esc(error.message||String(error))+'</p>'+
        '<button class="pw-action" id="pw-retry">RETRY</button></div>';
      $('pw-retry')?.addEventListener('click',()=>loadSnapshot());
    }
  }

  renderNav();
  nav.addEventListener('click',event=>{
    const a=event.target.closest('[data-route]');
    if(!a)return;
    event.preventDefault();
    const route=a.dataset.route;
    if(route && NAV.some(x=>x[0]===route)){state.route=route;state.selectedDocument=null;state.candidateFilter='';location.hash=route;render();}
  });
  main.addEventListener('click',event=>{
    const routeButtonEl=event.target.closest('[data-route]');
    if(routeButtonEl && !routeButtonEl.closest('#pw-navigation')){
      const route=routeButtonEl.dataset.route;
      if(route && NAV.some(x=>x[0]===route)){state.route=route;location.hash=route;render();}
      return;
    }
    const docButton=event.target.closest('[data-document]');
    if(docButton){state.selectedDocument=docButton.dataset.document;renderDocuments();return;}
    const candidateButton=event.target.closest('[data-candidate]');
    if(candidateButton){state.route='documents';state.candidateFilter=candidateButton.dataset.candidate;location.hash='documents';renderDocuments();const input=$('pw-filter');if(input){input.value=state.candidateFilter;bindFilter();}return;}
  });
  window.addEventListener('hashchange',()=>{
    const route=location.hash.replace(/^#/,'')||'overview';
    if(NAV.some(x=>x[0]===route)){state.route=route;state.selectedDocument=null;render();}
  });
  state.route=NAV.some(x=>x[0]===location.hash.replace(/^#/,''))?location.hash.replace(/^#/,''):'overview';
  loadSnapshot();
})();
