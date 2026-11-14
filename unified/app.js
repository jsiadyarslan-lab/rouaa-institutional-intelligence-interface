'use strict';
/* ROUAA unified institutional UI. Data: Core only (via coreGet). No snapshots, no mock data, no /production/*.
   R2D trust boundary: with no verified upstream-origin attestation, EVERY 2xx payload arrives as
   UNVERIFIED_UPSTREAM_RESPONSE. No view renders such a payload as Core data — no "Core health",
   no "Core store counts", no Intelligence Feed table, no trace chain. Each live view shows the
   UPSTREAM ORIGIN UNVERIFIED banner (R2D wording, verbatim) and keeps the raw payload only inside
   a collapsed diagnostics section that states its origin is unverified. Pagination behaviour
   (R2B/R2C) is preserved under the banner and driven by the pure logic in feed-pagination.js. */
(function () {
  const $ = (id) => document.getElementById(id);
  const NP = 'Not provided by Core';
  const STATE_TEXT = {
    UNVERIFIED_UPSTREAM_RESPONSE: 'An HTTP response was received from the /core route, but its upstream source has not been verified. The payload is retained for diagnostics only and is not presented as trusted ROUAA Core intelligence.',
    UNDETERMINED_404: '404 on the /core channel — origin not attributable to Core (no upstream-origin marker exists in the current system)',
    UNDETERMINED_RESPONSE: 'Response does not conform to the JSON contract — origin not attributable to Core, nothing verified',
    UNAUTHORIZED: 'Request rejected with 401/403 — credentials required; not attributed to a specific upstream without origin proof',
    TEMPORARY_FAILURE: 'Connection or 5xx failure — retry; not attributable to Core without origin proof, and not a statement about Core capability',
    REJECTED_PATH: 'Request rejected by the UI allow-list',
    /* Reserved states — unreachable until a proven upstream-origin attestation contract exists
       (CORE-PROXY-ORIGIN-ATTESTATION; see R2D-UPSTREAM-TRUST-BOUNDARY-REPORT.md). */
    LIVE_RESPONSE: 'Live Core response with verified origin (reserved — requires the origin attestation contract)',
    NOT_FOUND_BY_CORE: 'Core answered 404 for this resource (reserved — requires origin proof)',
    DEGRADED: 'Core reported a degraded store (503) (reserved — requires origin proof)',
    CHANNEL_NOT_PROVISIONED: 'Core read channel (/core) is not provisioned in this deployment (reserved — requires deployment-level evidence, not a response-shape guess)'
  };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function chip(text, cls) { return el('span', 'u-chip ' + (cls || ''), text); }
  function rawDiag(obj) { /* collapsed diagnostics-only section; the label states the origin is unverified */
    const d = el('details', 'u-raw');
    d.appendChild(el('summary', '', 'Raw response (diagnostics only — upstream origin unverified)'));
    d.appendChild(el('pre', '', JSON.stringify(obj, null, 2)));
    return d;
  }
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
  /* R2D §4: the banner shown whenever an HTTP answer arrived but its origin is unverified —
     the exact wording required by the order. Payload rendering happens only below it, inside
     the diagnostics section, never as interpreted Core data. */
  function unverifiedBanner(res) {
    const b = el('div', 'u-state st-UNVERIFIED_UPSTREAM_RESPONSE');
    b.appendChild(el('strong', '', 'UPSTREAM ORIGIN UNVERIFIED'));
    b.appendChild(el('span', '', ' — ' + STATE_TEXT.UNVERIFIED_UPSTREAM_RESPONSE + (res.status ? ' (HTTP ' + res.status + ')' : '')));
    return b;
  }
  function stateBox(res) {
    const b = el('div', 'u-state st-' + res.state);
    b.appendChild(el('strong', '', res.state));
    b.appendChild(el('span', '', ' — ' + STATE_TEXT[res.state] + (res.status ? ' (HTTP ' + res.status + ')' : '')));
    if (res.detail) b.appendChild(el('span', 'u-detail mono', ' [' + res.detail + ']'));
    if (res.body) b.appendChild(rawDiag(res.body));
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
    /* R2D: a 2xx answer proves arrival, not origin — the banner is shown once for the view and
       each payload is kept only in the diagnostics section. No "Core health", no store counts. */
    const unverified = [h, m].filter((r) => r.state === 'UNVERIFIED_UPSTREAM_RESPONSE');
    if (unverified.length) {
      box.appendChild(unverifiedBanner(unverified[0]));
      box.appendChild(el('p', 'u-warn', 'The /health and /metrics payloads below were received over the /core route, but no verified evidence ties them to ROUAA Core. They are not shown as Core health or as Core store counts, and none of their figures is adopted by this interface.'));
      unverified.forEach((r) => { box.appendChild(rawDiag(r.body)); });
    }
    [h, m].forEach((r) => { if (r.state !== 'UNVERIFIED_UPSTREAM_RESPONSE') box.appendChild(stateBox(r)); });
  }
  /* Feed pagination state (R2B/R2C/R2D) — presentation logic lives in feed-pagination.js;
     in-memory only; nothing is persisted anywhere in the browser. Cursors come only from the
     payload's own next_cursor (or the previous-page stack), never from user input. */
  const pager = createFeedPager();
  function feedNav() { window.dispatchEvent(new Event('hashchange')); }

  async function feed(mod, box) {
    /* R2C §6: Core orders ascending by (derived_at, event_id, event_version) — oldest first.
       The UI never reverses locally: that would corrupt cross-page cursor semantics. */
    box.appendChild(el('p', 'u-sub', 'Order (per the documented contract): oldest first — Core canonical ordering by (derived_at, event_id, event_version).'));
    const path = '/v1/intelligence?limit=50' + (pager.current ? '&cursor=' + encodeURIComponent(pager.current) : '');
    const r = await coreGet(path);
    if (r.state !== 'UNVERIFIED_UPSTREAM_RESPONSE') {
      box.appendChild(stateBox(r));
      /* R2C §5: a failed page must never strand the analyst — Previous (stack untouched) and
         Retry (same cursor, stack untouched) stay available; the current cursor is not lost. */
      const pages = el('div', 'u-pages');
      if (pager.canPrevious) {
        const pb = el('button', '', '← Previous page'); pb.type = 'button';
        pb.addEventListener('click', () => { pager.goPrevious(); feedNav(); });
        pages.appendChild(pb);
      }
      const rb = el('button', '', 'Retry this page'); rb.type = 'button';
      rb.addEventListener('click', () => feedNav());
      pages.appendChild(rb);
      box.appendChild(pages);
      return;
    }
    /* R2D: the payload arrived but its origin is unverified — banner first, payload only in the
       collapsed diagnostics section; no records are rendered as Intelligence Objects. */
    box.appendChild(unverifiedBanner(r));
    const body = r.body && typeof r.body === 'object' ? r.body : null;
    const list = body && Array.isArray(body.objects) ? body.objects : null;
    if (!list) {
      box.appendChild(el('p', 'u-warn', 'The response does not match the documented {objects, next_cursor} shape. It is retained in the diagnostics section below, verbatim and uninterpreted.'));
      box.appendChild(rawDiag(r.body));
      return;
    }
    const cursorInfo = classifyNextCursor(body);
    const cursorCase = cursorInfo.case;
    const next = cursorInfo.next;
    const countNote = list.length + ' object(s) are present in the unverified payload — they are NOT rendered as Intelligence Objects and none of their fields is adopted.';
    box.appendChild(el('p', 'u-warn', countNote));
    /* R2C §4 (preserved under the banner): the four documented continuation cases — a Next link
       is built only from a valid non-empty string cursor; completeness is claimed only for a
       literal null; an invalid value claims nothing and links nowhere. */
    const pages = el('div', 'u-pages');
    if (pager.canPrevious) {
      const pb = el('button', '', '← Previous page'); pb.type = 'button';
      pb.addEventListener('click', () => { pager.goPrevious(); feedNav(); });
      pages.appendChild(pb);
    }
    if (cursorCase === 'next') {
      const nb = el('button', '', 'Next page →'); nb.type = 'button';
      nb.addEventListener('click', () => { pager.goNext(next); feedNav(); });
      pages.appendChild(nb);
    }
    if (pages.childNodes.length) box.appendChild(pages);
    if (cursorCase === 'last') box.appendChild(el('p', 'u-sub', 'The payload reports no further pages (next_cursor is null). No records are silently dropped from the diagnostics payload.'));
    else if (cursorCase === 'missing') box.appendChild(el('p', 'u-warn', 'Continuation field next_cursor is absent from this payload — pagination state beyond this page cannot be stated from it.'));
    else if (cursorCase === 'invalid') box.appendChild(el('p', 'u-warn', 'Continuation field next_cursor has an invalid value (neither a non-empty string nor null) — continuation state is unknown; no completeness is claimed and no further-page link is offered.'));
    box.appendChild(rawDiag(r.body));
  }
  async function objectDetail(id, box) {
    box.appendChild(el('h2', 'mono', id));
    const q = encodeURIComponent(id);
    const [d, t] = await Promise.all([coreGet('/v1/intelligence/' + q), coreGet('/v1/intelligence/' + q + '/trace')]);
    box.appendChild(el('h3', '', 'Object'));
    if (d.state === 'UNVERIFIED_UPSTREAM_RESPONSE') {
      /* R2D: the object payload is not rendered as Core intelligence — banner + diagnostics only. */
      box.appendChild(unverifiedBanner(d));
      box.appendChild(el('p', 'u-warn', 'The object payload below was received over the /core route, but no verified evidence ties it to ROUAA Core. Its fields are not rendered as institutional intelligence.'));
      box.appendChild(rawDiag(d.body));
    } else box.appendChild(stateBox(d));
    box.appendChild(el('h3', '', 'Evidence chain (trace)'));
    if (t.state !== 'UNVERIFIED_UPSTREAM_RESPONSE') { box.appendChild(stateBox(t)); return; }
    /* R2D: a trace-shaped payload is not an evidence chain from Core — banner + diagnostics only. */
    box.appendChild(unverifiedBanner(t));
    box.appendChild(el('p', 'u-warn', 'A trace-shaped payload was received over the /core route, but no verified evidence ties it to ROUAA Core. It is not rendered as a verified evidence chain: its source/document/representation/evidence/fact fields remain unverified payload content.'));
    box.appendChild(rawDiag(t.body));
  }
  async function evidence(mod, box) {
    const f = el('div', 'u-form'); const i = el('input'); i.placeholder = 'io_id'; i.setAttribute('aria-label', 'io_id');
    const b = el('button', '', 'Load trace'); b.type = 'button';
    b.addEventListener('click', () => { const v = i.value.trim(); if (v) location.hash = '#/intelligence/' + encodeURIComponent(v); });
    f.appendChild(i); f.appendChild(b); box.appendChild(f);
    box.appendChild(el('p', 'u-sub', 'Traces are requested through the /core read channel. Until a verified origin attestation exists, any answer is shown as an unverified upstream payload (diagnostics only) — never as a Core-verified evidence chain, and nothing is shown as verified.'));
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
    if (LIVE[mod.key]) { box.appendChild(el('p', 'u-load', 'Reading the /core channel…')); const body = el('div'); await LIVE[mod.key](mod, body); box.textContent = ''; box.appendChild(body); }
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
