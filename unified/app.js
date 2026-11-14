'use strict';
/* ROUAA unified institutional UI. Data: Core only (via coreGet). No snapshots, no mock data, no /production/*. */
(function () {
  const $ = (id) => document.getElementById(id);
  const NP = 'Not provided by Core';
  const STATE_TEXT = {
    LIVE_RESPONSE: 'Live response received — contract not production-verified',
    UNDETERMINED_404: '404 on the /core channel — origin not attributable to Core (no upstream-origin marker exists in the current system)',
    UNDETERMINED_RESPONSE: 'Response does not conform to the JSON contract — origin not attributable to Core, nothing verified',
    UNAUTHORIZED: 'Request rejected with 401/403 — credentials required; not attributed to a specific upstream without origin proof',
    TEMPORARY_FAILURE: 'Connection or 5xx failure — retry; not attributable to Core without origin proof, and not a statement about Core capability',
    REJECTED_PATH: 'Request rejected by the UI allow-list',
    /* Reserved states — unreachable by inference until a proven upstream-origin marker contract
       exists (see R2C-ORIGIN-AND-PAGINATION-REPORT.md §2). Kept in the vocabulary on purpose. */
    NOT_FOUND_BY_CORE: 'Core answered 404 for this resource (reserved — requires origin proof)',
    DEGRADED: 'Core reported a degraded store (503) (reserved — requires origin proof)',
    CHANNEL_NOT_PROVISIONED: 'Core read channel (/core) is not provisioned in this deployment (reserved — requires deployment-level evidence, not a response-shape guess)'
  };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function chip(text, cls) { return el('span', 'u-chip ' + (cls || ''), text); }
  function raw(obj) { const d = el('details', 'u-raw'); d.appendChild(el('summary', '', 'Raw response (verbatim)')); d.appendChild(el('pre', '', JSON.stringify(obj, null, 2))); return d; }
  function field(v) { return (v === undefined || v === null || v === '') ? NP : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }

  function header(mod) {
    const h = el('div', 'u-head');
    h.appendChild(el('h1', '', mod.title));
    h.appendChild(chip(mod.cls, 'cls-' + mod.cls));
    const p = el('p', 'u-sub', ROUAA_CLASSIFICATIONS[mod.cls] + (mod.note ? ' ' + mod.note : ''));
    h.appendChild(p);
    if (mod.endpoints.length) h.appendChild(el('p', 'u-ep mono', 'Contract: ' + mod.endpoints.map((e) => 'GET ' + e).join('  ·  ')));
    return h;
  }
  function stateBox(res) {
    const b = el('div', 'u-state st-' + res.state);
    b.appendChild(el('strong', '', res.state));
    b.appendChild(el('span', '', ' — ' + STATE_TEXT[res.state] + (res.status ? ' (HTTP ' + res.status + ')' : '')));
    if (res.detail) b.appendChild(el('span', 'u-detail mono', ' [' + res.detail + ']'));
    if (res.body) b.appendChild(raw(res.body)); /* the raw answer is never hidden on failure states */
    return b;
  }
  function unavailable(mod) {
    const b = el('div', 'u-unavail');
    b.appendChild(el('strong', '', mod.cls === 'BLOCKED_NO_SECURE_PATH' ? 'BLOCKED — no secure verified path' : 'NOT AVAILABLE in the current Core contract'));
    b.appendChild(el('p', '', 'No data is shown for this module and none is simulated. Gap and enabling requirements: CORE-API-GAPS-REGISTER.md.'));
    return b;
  }
  function kv(obj, keys) {
    const t = el('table', 'u-table');
    keys.forEach((k) => { const r = el('tr'); r.appendChild(el('th', 'mono', k)); r.appendChild(el('td', '', field(obj[k]))); t.appendChild(r); });
    return t;
  }
  function wrapTable(t) { const w = el('div', 'u-scroll'); w.appendChild(t); return w; }

  async function overview(mod, box) {
    const [h, m] = await Promise.all([coreGet('/health'), coreGet('/metrics')]);
    [h, m].forEach((r) => { if (r.state !== 'LIVE_RESPONSE') box.appendChild(stateBox(r)); });
    if (h.state === 'LIVE_RESPONSE') { box.appendChild(el('h2', '', 'Core health')); box.appendChild(kv(h.body || {}, ['status'])); box.appendChild(raw(h.body)); }
    if (m.state === 'LIVE_RESPONSE') {
      box.appendChild(el('h2', '', 'Core store counts'));
      box.appendChild(kv(m.body || {}, ['source_count', 'document_count', 'fact_count', 'event_count', 'io_count']));
      box.appendChild(raw(m.body));
    }
  }
  /* Feed pagination state (R2B/R2C) — in-memory only; nothing is persisted anywhere in the browser.
     Cursors come only from Core's own next_cursor (or the previous-page stack), never from user input.
     The stack has no internal cap: navigation history is never silently dropped (R2C §5); it is
     session-scoped and cleared on reload, which is inherent to the documented no-storage policy. */
  let feedCursor = null;
  const feedStack = [];
  function feedNav() { window.dispatchEvent(new Event('hashchange')); }

  async function feed(mod, box) {
    /* R2C §6: Core orders ascending by (derived_at, event_id, event_version) — oldest first.
       The UI never reverses locally: that would corrupt cross-page cursor semantics. */
    box.appendChild(el('p', 'u-sub', 'Order: oldest first — Core canonical ordering by (derived_at, event_id, event_version).'));
    const path = '/v1/intelligence?limit=50' + (feedCursor ? '&cursor=' + encodeURIComponent(feedCursor) : '');
    const r = await coreGet(path);
    if (r.state !== 'LIVE_RESPONSE') {
      box.appendChild(stateBox(r));
      /* R2C §5: a failed page must never strand the analyst — Previous (stack untouched) and
         Retry (same cursor, stack untouched) stay available; the current cursor is not lost. */
      const pages = el('div', 'u-pages');
      if (feedStack.length) {
        const pb = el('button', '', '← Previous page'); pb.type = 'button';
        pb.addEventListener('click', () => { feedCursor = feedStack.pop() || null; feedNav(); });
        pages.appendChild(pb);
      }
      const rb = el('button', '', 'Retry this page'); rb.type = 'button';
      rb.addEventListener('click', () => feedNav());
      pages.appendChild(rb);
      box.appendChild(pages);
      return;
    }
    const body = r.body && typeof r.body === 'object' ? r.body : null;
    const list = body && Array.isArray(body.objects) ? body.objects : null;
    if (!list) { box.appendChild(el('p', 'u-warn', 'Response schema not recognized (no objects[]). Shown verbatim, not interpreted.')); box.appendChild(raw(r.body)); return; }
    /* R2C §4: the four documented continuation cases — completeness is claimed only when
       next_cursor is literally null; an invalid value claims nothing and links nowhere. */
    const hasNextField = !!(body && 'next_cursor' in body);
    const ncv = hasNextField ? body.next_cursor : undefined;
    const next = typeof ncv === 'string' && ncv.length > 0 ? ncv : null;
    const cursorCase = !hasNextField ? 'missing' : (ncv === null ? 'last' : (next ? 'next' : 'invalid'));
    box.appendChild(el('p', 'u-sub', 'Showing ' + list.length + ' record(s) — page limit 50 per Core request.'));
    if (!list.length) { box.appendChild(el('p', '', 'Core returned zero intelligence objects.')); box.appendChild(raw(r.body)); return; }
    const t = el('table', 'u-table'); const hr = el('tr');
    ['io_id', 'headline', 'event_type', 'status', 'created_at'].forEach((k) => hr.appendChild(el('th', 'mono', k))); t.appendChild(hr);
    list.forEach((o) => {
      const tr = el('tr');
      ['io_id', 'headline', 'event_type', 'status', 'created_at'].forEach((k) => {
        const td = el('td');
        if (k === 'io_id' && o.io_id) { const a = el('a', 'mono', String(o.io_id)); a.href = '#/intelligence/' + encodeURIComponent(o.io_id); td.appendChild(a); } else td.textContent = field(o[k]);
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    box.appendChild(wrapTable(t));
    const pages = el('div', 'u-pages');
    if (feedStack.length) {
      const pb = el('button', '', '← Previous page'); pb.type = 'button';
      pb.addEventListener('click', () => { feedCursor = feedStack.pop() || null; feedNav(); });
      pages.appendChild(pb);
    }
    if (cursorCase === 'next') { /* a Next link is built only from a valid non-empty string cursor */
      const nb = el('button', '', 'Next page →'); nb.type = 'button';
      nb.addEventListener('click', () => { feedStack.push(feedCursor); feedCursor = next; feedNav(); });
      pages.appendChild(nb);
    }
    if (pages.childNodes.length) box.appendChild(pages);
    if (cursorCase === 'last') box.appendChild(el('p', 'u-sub', 'Core reports no further pages for this query (next_cursor is null) — no records are silently dropped.'));
    else if (cursorCase === 'missing') box.appendChild(el('p', 'u-warn', 'Continuation field next_cursor is absent from this response — the feed may be showing only the first 50 records; completeness beyond this page cannot be stated from this response.'));
    else if (cursorCase === 'invalid') box.appendChild(el('p', 'u-warn', 'Continuation field next_cursor has an invalid value (neither a non-empty string nor null) — continuation state is unknown; no completeness is claimed and no further-page link is offered. Raw response is shown below.'));
    box.appendChild(raw(r.body));
  }
  async function objectDetail(id, box) {
    box.appendChild(el('h2', 'mono', id));
    const q = encodeURIComponent(id);
    const [d, t] = await Promise.all([coreGet('/v1/intelligence/' + q), coreGet('/v1/intelligence/' + q + '/trace')]);
    box.appendChild(el('h3', '', 'Object')); if (d.state === 'LIVE_RESPONSE') { box.appendChild(kv(d.body || {}, ['io_id', 'event_id', 'event_type', 'event_version', 'status', 'created_at', 'supersedes_io_id'])); box.appendChild(raw(d.body)); } else box.appendChild(stateBox(d));
    box.appendChild(el('h3', '', 'Evidence chain (trace)'));
    if (t.state !== 'LIVE_RESPONSE') { box.appendChild(stateBox(t)); return; }
    const chain = t.body && Array.isArray(t.body.chain) ? t.body.chain : null;
    if (!chain) { box.appendChild(el('p', 'u-warn', 'Trace schema not recognized. Shown verbatim.')); box.appendChild(raw(t.body)); return; }
    chain.forEach((c, i) => {
      const s = el('section', 'u-chain'); s.appendChild(el('h4', '', 'Link ' + (i + 1)));
      const rows = {
        'source': c.source, 'document.canonical_url': c.document && c.document.canonical_url,
        'representation.representation_id': c.representation && c.representation.representation_id,
        'representation.content_sha256': c.representation && c.representation.content_sha256,
        'evidence': c.evidence, 'fact': c.fact
      };
      const tb = el('table', 'u-table'); Object.keys(rows).forEach((k) => { const r = el('tr'); r.appendChild(el('th', 'mono', k)); r.appendChild(el('td', '', field(rows[k]))); tb.appendChild(r); });
      s.appendChild(wrapTable(tb)); box.appendChild(s);
    });
    box.appendChild(raw(t.body));
  }
  async function evidence(mod, box) {
    const f = el('div', 'u-form'); const i = el('input'); i.placeholder = 'io_id'; i.setAttribute('aria-label', 'io_id');
    const b = el('button', '', 'Load trace'); b.type = 'button';
    b.addEventListener('click', () => { const v = i.value.trim(); if (v) location.hash = '#/intelligence/' + encodeURIComponent(v); });
    f.appendChild(i); f.appendChild(b); box.appendChild(f);
    box.appendChild(el('p', 'u-sub', 'Traces are read through the /core read channel; the outcome is shown after loading with honest origin attribution. No response is attributed to Core without origin evidence, and nothing is shown as verified.'));
  }
  const LIVE = { overview, intelligence: feed, evidence };

  async function render() {
    const app = $('app'); app.textContent = '';
    const parts = (location.hash || '#/').replace(/^#\//, '').split('/');
    const key = parts[0] || 'home';
    document.querySelectorAll('#topnav a').forEach((a) => a.classList.toggle('on', a.dataset.key === key || (key === 'home' && a.dataset.key === 'overview')));
    const wrap = el('div', 'u-wrap'); app.appendChild(wrap);
    if (key === 'matrix') return matrix(wrap);
    const mod = ROUAA_MODULES.find((m) => m.key === (key === 'home' ? 'overview' : key) && m.route !== false);
    if (!mod) { wrap.appendChild(el('h1', '', 'Unknown view')); return; }
    if (key === 'intelligence' && parts[1]) {
      const om = ROUAA_MODULES.find((m) => m.key === 'object');
      wrap.appendChild(header(om)); const box = el('div'); wrap.appendChild(box);
      let id; try { id = decodeURIComponent(parts[1]); } catch (e) { box.appendChild(stateBox({ state: 'REJECTED_PATH' })); return; }
      return objectDetail(id, box);
    }
    wrap.appendChild(header(mod)); const box = el('div', 'u-body'); wrap.appendChild(box);
    if (LIVE[mod.key]) { box.appendChild(el('p', 'u-load', 'Reading Core…')); const body = el('div'); await LIVE[mod.key](mod, body); box.textContent = ''; box.appendChild(body); }
    else box.appendChild(unavailable(mod));
  }
  function matrix(wrap) {
    wrap.appendChild(el('h1', '', 'Data-source matrix'));
    wrap.appendChild(el('p', 'u-sub', 'Every module, its Core endpoint and classification. Nothing is LIVE_VERIFIED.'));
    const t = el('table', 'u-table'); const hr = el('tr'); ['Group', 'Module', 'Classification', 'Endpoints'].forEach((h) => hr.appendChild(el('th', '', h))); t.appendChild(hr);
    ROUAA_MODULES.forEach((m) => { const r = el('tr'); [ROUAA_GROUPS[m.group], m.title, m.cls, m.endpoints.join(', ') || '—'].forEach((v) => r.appendChild(el('td', '', v))); t.appendChild(r); });
    ROUAA_QUARANTINED.forEach((q) => { const r = el('tr'); ['Legacy', q.title, 'SNAPSHOT_QUARANTINED', q.path].forEach((v) => r.appendChild(el('td', '', v))); t.appendChild(r); });
    wrap.appendChild(wrapTable(t));
  }
  function buildNav() {
    const nav = $('topnav'); nav.textContent = '';
    Object.keys(ROUAA_GROUPS).forEach((g) => {
      const grp = el('div', 'nav-group'); grp.appendChild(el('span', 'nav-group-title', ROUAA_GROUPS[g]));
      ROUAA_MODULES.filter((m) => m.group === g && m.route !== false).forEach((m) => {
        const a = el('a', m.cls === 'NOT_EXPOSED_BY_CORE' || m.cls === 'BLOCKED_NO_SECURE_PATH' ? 'nav-dim' : '', m.title);
        a.href = '#/' + m.key; a.dataset.key = m.key; grp.appendChild(a);
      });
      nav.appendChild(grp);
    });
    const a = el('a', 'nav-matrix', 'Data-source matrix'); a.href = '#/matrix'; a.dataset.key = 'matrix'; nav.appendChild(a);
  }
  buildNav(); const safeRender = () => render().catch(() => { const a = $('app'); a.textContent = ''; const b = el('div', 'u-wrap'); b.appendChild(stateBox({ state: 'TEMPORARY_FAILURE' })); a.appendChild(b); });
  window.addEventListener('hashchange', safeRender); safeRender();
})();
