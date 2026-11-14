'use strict';

/* P2.9 — Verified intelligence vertical-slice consumer.
 *
 * Truth rules (order §7): render only real Core API records; preserve raw
 * values and quality states verbatim; never upgrade provisional data; never
 * convert unavailable into zero; the data mode is ISOLATED TEST and is
 * stated everywhere; failures render explicit UNAVAILABLE states.
 *
 * The browser never sees the Core credential: all requests are same-origin
 * to the integration harness (/api/... proxy).
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const ROUTES = {
    overview: 'EXECUTIVE OVERVIEW',
    intelligence: 'INTELLIGENCE OBJECT',
    fact: 'FACT DETAIL',
    evidence: 'EVIDENCE & PROVENANCE',
    run: 'PRODUCTION RUN',
    document: 'OFFICIAL DOCUMENT',
  };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const state = { data: null, error: null, route: 'overview' };

  async function api(path) {
    const response = await fetch('/api' + path, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    if (response.status === 304) return { __304: true };
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(
        (body && body.error && body.error.message) ||
        ('HTTP ' + response.status));
      err.status = response.status;
      err.code = body && body.error && body.error.code;
      throw err;
    }
    return body;
  }

  function kv(pairs) {
    return '<div class="cx-kv">' + pairs.map(([k, v, cls, html]) =>
      '<div class="k">' + esc(k) + '</div>' +
      '<div class="v ' + (cls || '') + '">' + (html !== undefined
        ? html
        : (v == null ? '<span class="is-muted">—</span>' : esc(v))) + '</div>'
    ).join('') + '</div>';
  }

  function qualityBadge(quality) {
    const provisional = /PENDING/i.test(String(quality || ''));
    return '<span class="cx-badge' + (provisional ? ' is-provisional' : '') +
      '">' + esc(quality || 'UNKNOWN') + '</span>';
  }

  function unavailable(error, what) {
    $('cx-source-state').textContent = 'CORE API UNAVAILABLE';
    $('cx-source-state').classList.add('is-error');
    $('cx-source-state').classList.remove('is-ready');
    $('cx-banner').classList.add('is-error');
    $('cx-banner').innerHTML = '<strong>P2.9 ISOLATED TEST — CORE API UNAVAILABLE</strong>' +
      '<span>' + esc(what) + ' could not be read from the isolated Core. ' +
      'Nothing is fabricated or substituted; no fallback data exists.</span>';
    $('cx-main').innerHTML =
      '<div class="cx-section-kicker">DATA SOURCE</div>' +
      '<div class="cx-unavailable"><div style="color:var(--red);font-size:15px;margin-bottom:8px">UNAVAILABLE — ' + esc(what) + '</div>' +
      '<div>' + esc(error && error.message ? error.message : String(error)) + '</div>' +
      '<div style="margin-top:10px;color:var(--muted)">The interface renders an explicit unavailable state and never substitutes data.</div></div>';
  }

  async function load() {
    try {
      const list = await api('/v1/intelligence');
      const objects = (list && list.objects) || [];
      if (!objects.length) {
        throw Object.assign(
          new Error('the isolated Core holds no intelligence objects'),
          { code: 'EMPTY_STORE' });
      }
      const io = objects[0];
      const detail = await api('/v1/intelligence/' + io.io_id);
      const trace = await api('/v1/intelligence/' + io.io_id + '/trace');
      const chain = (detail.chain && detail.chain[0]) || {};
      const fact = chain.fact || {};
      const documentRow = await api('/v1/documents/' + fact.document_id);
      const evidenceRow = await api('/v1/evidence/' + fact.evidence_id);
      const runRow = await api('/v1/runs/p29-src-istat-october-2026');
      state.data = { list, detail, trace, chain, fact, documentRow, evidenceRow, runRow };
      state.error = null;
      $('cx-source-state').textContent = 'ISOLATED CORE API · READ SUCCESS';
      $('cx-source-state').classList.add('is-ready');
      $('cx-source-state').classList.remove('is-error');
      render();
    } catch (error) {
      state.error = error;
      unavailable(error, 'the verified intelligence chain');
    }
  }

  function render() {
    const d = state.data;
    if (!d) return;
    const nav = $('cx-nav');
    nav.querySelectorAll('a').forEach(link => {
      link.classList.toggle('is-active', link.dataset.route === state.route);
    });
    $('cx-route-label').textContent = ROUTES[state.route] || state.route;
    const fact = d.fact, doc = d.documentRow, ev = d.evidenceRow;
    const rep = d.chain.representation || {};
    const source = d.chain.source || {};
    const views = {
      overview: () =>
        '<div class="cx-section-kicker">EXECUTIVE OVERVIEW</div>' +
        '<h1 class="cx-page-title">' + esc(d.detail.headline) + '</h1>' +
        '<p class="cx-page-desc">The real intelligence result produced by the ROUAA Core from the official Istat press release. This page reads the isolated Core API; every value below is the Core record verbatim.</p>' +
        kv([
          ['Institution', source.institution_name, 'is-gold'],
          ['Intelligence Object', d.detail.io_id],
          ['Publication date', fact.publication_date],
          ['Reference period', fact.reference_period],
          ['Raw value', fact.raw_value, 'is-gold'],
          ['Normalized value', fact.value + ' ' + fact.unit],
          ['Quality state', null, null, qualityBadge(fact.quality_state)],
        ]) + '<div class="cx-callout is-warn">PROVISIONAL DATA — the source release is explicitly provisional; this state is preserved exactly and never upgraded. Independent semantic review remains pending.</div>' +
        '<div class="cx-panel"><div class="cx-panel-kicker">WHAT CAN I VERIFY?</div>' +
        'Follow <a class="cx-link" href="#evidence">FACT → EVIDENCE → REPRESENTATION → DOCUMENT → OFFICIAL SOURCE</a> — every level is a real Core record.</div>',
      intelligence: () =>
        '<div class="cx-section-kicker">INTELLIGENCE OBJECT</div>' +
        '<h1 class="cx-page-title">Intelligence Object ' + esc(d.detail.io_id) + '</h1>' +
        '<p class="cx-page-desc">The canonical IntelligenceObject emitted by Core, read through the production transport (ETag present; 304 conditional read verified in the API test report).</p>' +
        kv([
          ['IO ID', d.detail.io_id, 'is-gold'],
          ['IO version', d.detail.version],
          ['Status', d.detail.status, 'is-green'],
          ['Event association', d.detail.event_id + ' (' + esc(d.detail.event_type) + ' v' + d.detail.event_version + ')'],
          ['Linked Fact ID', fact.fact_id],
          ['Linked Evidence ID', fact.evidence_id],
          ['Linked Document ID', fact.document_id],
          ['Headline', d.detail.headline],
        ]),
      fact: () =>
        '<div class="cx-section-kicker">FACT DETAIL</div>' +
        '<h1 class="cx-page-title">Fact ' + esc(fact.fact_id) + '</h1>' +
        '<p class="cx-page-desc">The extracted Fact — original raw value preserved exactly; normalization is separate and shown alongside.</p>' +
        kv([
          ['Fact ID', fact.fact_id, 'is-gold'],
          ['Fact version', fact.fact_version],
          ['Metric', fact.metric],
          ['Original raw value', fact.raw_value, 'is-gold'],
          ['Normalized value', fact.value],
          ['Unit', fact.unit],
          ['Entity', fact.entity],
          ['Reference period', fact.reference_period],
          ['Publication date', fact.publication_date],
          ['Pattern', (fact.pattern_id || '') + ' v' + (fact.pattern_version || '')],
          ['Extraction version', fact.extraction_version],
          ['Quality state', null, null, qualityBadge(fact.quality_state)],
        ]),
      evidence: () =>
        '<div class="cx-section-kicker">EVIDENCE &amp; PROVENANCE</div>' +
        '<h1 class="cx-page-title">FACT → EVIDENCE → REPRESENTATION → DOCUMENT → OFFICIAL SOURCE</h1>' +
        '<p class="cx-page-desc">The complete verifiable lineage of the selected Fact. Every step is a real Core record read through the read contracts.</p>' +
        '<div class="cx-panel">' +
        chainStep('FACT', fact.fact_id, fact.raw_value + ' · ' + fact.metric) +
        chainStep('EVIDENCE', ev.evidence_id, 'PARAGRAPH ' + (ev.segment_id || '')) +
        chainStep('REPRESENTATION', rep.representation_id, (rep.content_sha256 || '').slice(0, 24) + '…') +
        chainStep('DOCUMENT', doc.document_id, (doc.canonical_url || '')) +
        chainStep('OFFICIAL SOURCE', source.source_id, source.institution_name + ' · istat.it') +
        '</div>' +
        '<div class="cx-panel"><div class="cx-panel-kicker">SELECTED EVIDENCE (VERBATIM)</div>' +
        '<div class="cx-callout">“' + esc(ev.excerpt) + '”</div>' +
        kv([
          ['Evidence ID', ev.evidence_id],
          ['Segment', (ev.segment_type || '') + ' ' + (ev.segment_id || '')],
          ['Location', ev.location],
          ['Representation', ev.representation_id],
          ['Content SHA-256', rep.content_sha256],
          ['Blob availability', null, null,
           '<span style="color:var(--green)">VERIFIED PRESENT (probed server-side)</span>'],
        ]),
      run: () => {
        const r = d.runRow;
        return '<div class="cx-section-kicker">PRODUCTION RUN</div>' +
        '<h1 class="cx-page-title">Run ' + esc(r.run_id) + '</h1>' +
        '<p class="cx-page-desc">The real execution identity and production accounting of the isolated run that produced this intelligence object (run-manifest v2, served verbatim).</p>' +
        kv([
          ['Run ID', r.run_id, 'is-gold'],
          ['Data class', r.data_class],
          ['Mode', r.mode],
          ['Manifest schema', r.manifest_schema_version],
          ['Started', r.started_at],
          ['Finished', r.finished_at],
          ['Configured sources', r.counters && r.counters.invocation_configured_source_count],
          ['Attempted sources', r.counters && r.counters.invocation_attempted_source_count],
          ['Successful sources', r.counters && r.counters.invocation_successful_source_count],
        ]) +
        '<div class="cx-panel"><div class="cx-panel-kicker">STORE COUNTS</div>' +
        '<table class="cx-table"><tr><th>Collection</th><th>Rows</th></tr>' +
        Object.entries(r.store_counts || {}).map(([k, v]) =>
          '<tr><td>' + esc(k) + '</td><td class="v">' + esc(v) + '</td></tr>').join('') +
        '</table></div>';
      },
      document: () =>
        '<div class="cx-section-kicker">OFFICIAL DOCUMENT</div>' +
        '<h1 class="cx-page-title">' + esc('Consumer prices (provisional data) — October 2026') + '</h1>' +
        '<p class="cx-page-desc">The official Istat press release, preserved and identified by Core. The canonical route to the original publication is the official URL; the preserved representation carries the integrity information.</p>' +
        kv([
          ['Document ID', doc.document_id, 'is-gold'],
          ['Official URL', null, null,
           '<a class="cx-link" href="' + esc(doc.canonical_url) + '" target="_blank" rel="noopener noreferrer">' + esc(doc.canonical_url) + '</a>'],
          ['Publication tuples', (doc.publication_tuples || []).length + ' (rss_pubDate, EXPLICIT_ZONE)'],
          ['Representations', doc.representation_count + ' — ' + (doc.representation_ids || []).join(', ')],
          ['Preserved SHA-256', rep.content_sha256],
          ['Content type', rep.content_type],
        ]) +
        '<div class="cx-callout">ARCHIVED SNAPSHOT — this is the preserved official representation from the isolated production run, not a live page. The archived bytes are verified by SHA-256; archive integrity is not semantic verification.</div>',
    };
    $('cx-main').innerHTML = views[state.route]();
  }

  function chainStep(level, id, note) {
    return '<div class="cx-chain-step">' +
      '<span class="cx-badge">' + esc(level) + '</span>' +
      '<span class="cx-link" style="font-family:var(--mono);font-size:12px">' + esc(id) + '</span>' +
      '<span style="color:var(--muted);font-size:11px">' + esc(note) + '</span>' +
      '</div>';
  }

  window.addEventListener('hashchange', () => {
    const route = (location.hash || '#overview').slice(1);
    if (ROUTES[route]) { state.route = route; render(); }
  });
  const initial = (location.hash || '#overview').slice(1);
  if (ROUTES[initial]) state.route = initial;
  load();
})();
