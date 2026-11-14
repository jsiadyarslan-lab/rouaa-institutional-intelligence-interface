'use strict';
/* ROUAA unified institutional UI. Data: Core only (via coreGet). No snapshots, no mock data, no /production/*. */
(function () {
  const $ = (id) => document.getElementById(id);
  const NP = 'Not provided by Core';
  const STATE_TEXT = {
    LIVE_RESPONSE: 'Live response received — contract not production-verified',
    NOT_FOUND_BY_CORE: 'Core answered 404 for this resource',
    UNAUTHORIZED: 'Core rejected the request (unauthorized)',
    DEGRADED: 'Core reported a degraded store (503)',
    CHANNEL_NOT_PROVISIONED: 'Core read channel (/core) is not provisioned in this deployment — nothing was verified',
    TEMPORARY_FAILURE: 'Temporary connection failure — retry; this is not a statement about Core capability',
    REJECTED_PATH: 'Request rejected by the UI allow-list'
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
    if (res.state === 'DEGRADED' && res.body) b.appendChild(raw(res.body));
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
  async function feed(mod, box) {
    const r = await coreGet('/v1/intelligence?limit=50');
    if (r.state !== 'LIVE_RESPONSE') { box.appendChild(stateBox(r)); return; }
    const list = r.body && Array.isArray(r.body.objects) ? r.body.objects : null;
    if (!list) { box.appendChild(el('p', 'u-warn', 'Response schema not recognized (no objects[]). Shown verbatim, not interpreted.')); box.appendChild(raw(r.body)); return; }
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
    box.appendChild(wrapTable(t)); box.appendChild(raw(r.body));
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
  }
  const LIVE = { overview, intelligence: feed, evidence };

  async function render() {
    const app = $('app'); app.textContent = '';
    const parts = (location.hash || '#/').replace(/^#\//, '').split('/');
    const key = parts[0] || 'home';
    document.querySelectorAll('#topnav a').forEach((a) => a.classList.toggle('active', a.dataset.key === key || (key === 'home' && a.dataset.key === 'overview')));
    const wrap = el('div', 'u-wrap'); app.appendChild(wrap);
    if (key === 'matrix') return matrix(wrap);
    const mod = ROUAA_MODULES.find((m) => m.key === (key === 'home' ? 'overview' : key) && m.route !== false);
    if (!mod) { wrap.appendChild(el('h1', '', 'Unknown view')); return; }
    if (key === 'intelligence' && parts[1]) {
      const om = ROUAA_MODULES.find((m) => m.key === 'object');
      wrap.appendChild(header(om)); const box = el('div'); wrap.appendChild(box);
      return objectDetail(decodeURIComponent(parts[1]), box);
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
  buildNav(); window.addEventListener('hashchange', render); render();
})();
