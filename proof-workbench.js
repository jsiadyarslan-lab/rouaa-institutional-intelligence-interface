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
  const state = { data: null, verification: null, route: 'overview', selectedDocument: null, candidateFilter: '', search: '' };
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
    return panel('VERIFICATION BOUNDARIES',
      '<div class="pw-callout is-neutral"><strong>VERIFIED applies only to the mirrored JSON snapshot files.</strong> It does not upgrade the original-document byte checks. The manifest reports those checks as EXECUTOR_REPORTED; this workbench has not independently re-read the 30 original raw blobs.</div>' +
      '<div class="pw-detail-grid" style="margin-top:12px">' +
      cell('Mirrored JSON exports', tag('VERIFIED') + ' · ' + fmtNum(v.verifiedFiles) + '/' + fmtNum(v.totalFiles) + ' SHA-256 + byte length') +
      cell('Manifest verification_state', tag(v.manifestState || 'NOT_PROVEN')) +
      cell('Original-document SHA report', tag(raw.state || 'NOT_PROVEN') + ' · ' + fmtNum(raw.verified) + '/' + fmtNum(raw.checked) + ' reported matches') +
      cell('Independent raw-byte re-read', tag('NOT_PROVEN') + ' · 0 original files re-read here') +
      cell('Manifest source-artifact states', esc(artifactStates)) +
      cell('Snapshot data_scope', esc(v.dataScope || 'NOT PROVEN')) +
      '</div>');
  }

  function renderOverview() {
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
    main.innerHTML=pageHead('09 / CONSUMER DELIVERY','Deliveries',
      'IO creation, delivery record creation, API success and external receipt are different states. This ledger shows only Core delivery records.',
      'READ ONLY')+
      '<div class="pw-callout is-neutral">A successful database write or an IO-shaped JSON object is not proof that an external consumer received the intelligence.</div>'+
      '<div style="height:12px"></div>'+
      empty('NO DELIVERY RECORDS',0,'No canonical Intelligence Object exists in the R4 proof scope, so no Delivery was created and no external consumer receipt is claimed.','NOT_PROVEN');
  }
  function renderRuns() {
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
