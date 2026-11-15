'use strict';

const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, extname } = require('node:path');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const CORE = new URL(process.env.ROUAA_CORE_URL ||
  'https://rouaa-intelligence-core-api-production.up.railway.app');
if (!['https:', 'http:'].includes(CORE.protocol) || CORE.username || CORE.password ||
    CORE.pathname !== '/' || CORE.search || CORE.hash) throw new Error('ROUAA_CORE_URL must be a Core origin');
const CORE_TOKEN = process.env.CORE_API_TOKEN || '';
const ANALYST_TOKEN = process.env.ROUAA_ANALYST_TOKEN || '';
const SESSION_SECONDS = 8 * 3600;
const SESSION_KEY = CORE_TOKEN && ANALYST_TOKEN.length >= 16 && CORE_TOKEN !== ANALYST_TOKEN
  ? createHmac('sha256', CORE_TOKEN).update('rouaa-analyst-session-v1\0' + ANALYST_TOKEN).digest() : null;
const REFRESH_MS = 45_000;
const STALE_MS = 5 * 60_000;
let index = null;
let pending = null;
let lastAttempt = 0;
let reason = null;
let metrics = null;
let metricsPending = null;
let metricsAttempt = 0;
let metricsFailed = false;
let loginFailures = { since: 0, count: 0 };
const number = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
const string = (s, max = 800) => typeof s === 'string' ? s.slice(0, max) : '';
const scalar = s => typeof s === 'number' && Number.isFinite(s) ? String(s) : string(s);
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const validId = s => typeof s === 'string' && idPattern.test(s) ? s : '';
const date = s => typeof s === 'string' && /^\d{4}-\d{2}(?:-\d{2}(?:T[^ ]+)?|)$/.test(s) && Number.isFinite(Date.parse(s)) ? s : '';
const plainDate = s => date(s).slice(0, 10);
function officialURL(raw) {
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : '';
  } catch { return ''; }
}
function send(req, res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
function json(req, res, status, body, extra) {
  send(req, res, status, 'application/json; charset=utf-8', JSON.stringify(body), extra);
}
function eq(a, b) {
  const digest = s => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
function sign(exp) {
  return createHmac('sha256', SESSION_KEY).update(exp).digest('base64url');
}
function hasSession(req) {
  if (!SESSION_KEY) return false;
  const cookie = /(?:^|;\s*)rouaa_session=(\d{10})\.([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '');
  return Boolean(cookie && Number(cookie[1]) > Date.now() / 1000 && eq(sign(cookie[1]), cookie[2]));
}
function cookie(req, value, lifetime) {
  const secure = process.env.RAILWAY_ENVIRONMENT_ID || req.socket.encrypted;
  return 'rouaa_session=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + lifetime + (secure ? '; Secure' : '');
}

class CoreError extends Error {
  constructor(code) { super(code); this.code = code; }
}
async function core(path, { token = false, signal } = {}) {
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(7_000)]) : AbortSignal.timeout(7_000);
  const response = await fetch(new URL(path, CORE), {
    redirect: 'error', signal: abort, cache: 'no-store',
    headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + CORE_TOKEN } : {}) },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new CoreError(response.status === 401 || response.status === 403
      ? 'CORE_ACCESS_REJECTED' : 'CORE_READ_FAILED');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > (token ? 12_000_000 : 500_000)) throw new CoreError('CORE_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function shape(row) {
  if (!row || !validId(row.io_id) || !Array.isArray(row.chain)) throw new CoreError('CORE_CONTRACT_INVALID');
  const facts = row.chain.map(link => {
    const f = link?.fact || {};
    const source = link?.source || {};
    const doc = link?.document || {};
    const evidence = Array.isArray(link?.evidence) ? link.evidence : [link?.evidence].filter(Boolean);
    return {
      factId: validId(f.fact_id), metric: string(f.metric, 150), entity: string(f.entity, 500),
      raw: scalar(f.raw_value), value: scalar(f.value), unit: string(f.unit, 80),
      currency: string(f.currency, 25), quality: string(f.quality_state, 180),
      period: string(f.reference_period, 100), publication: plainDate(f.publication_date),
      sourceId: validId(source.source_id || f.source_id), source: string(source.institution_name, 220),
      country: string(source.country || source.jurisdiction, 110), documentId: validId(doc.document_id || f.document_id),
      officialUrl: officialURL(doc.canonical_url), documentTitle: string(doc.title, 500),
      evidence: evidence.map(e => ({ id: validId(e?.evidence_id), excerpt: string(e?.excerpt, 3000) }))
        .filter(e => e.excerpt),
    };
  });
  const usable = facts.filter(f => f.factId || f.metric);
  const dated = usable.find(f => f.publication);
  const first = usable.find(f => f.evidence.length && f.officialUrl) || usable[0] || {};
  return {
    id: row.io_id, title: string(row.headline, 700), type: string(row.event_type, 180),
    status: string(row.status, 100), version: number(row.version ?? row.event_version),
    createdAt: date(row.created_at),
    publishedAt: date(row.temporal_data?.publication_time) || dated?.publication || '',
    source: first.source || first.sourceId || '', period: first.period || '',
    facts: usable,
  };
}
async function refreshIndex() {
  if (!SESSION_KEY) return;
  if (pending) return pending;
  if (Date.now() - lastAttempt < REFRESH_MS) return;
  lastAttempt = Date.now();
  pending = (async () => {
    try {
      const signal = AbortSignal.timeout(65_000);
      const rows = new Map(), cursors = new Set();
      let payloadWeight = 0;
      let cursor = '';
      for (;;) {
        const q = new URLSearchParams({ limit: '40' });
        if (cursor) q.set('cursor', cursor);
        const raw = await core('/v1/intelligence?' + q, { token: true, signal });
        if (!raw || !Array.isArray(raw.objects) || raw.objects.length > 40 ||
            !(raw.next_cursor == null || typeof raw.next_cursor === 'string')) throw new CoreError('CORE_CONTRACT_INVALID');
        for (const item of raw.objects) {
          const output = shape(item);
          payloadWeight += Buffer.byteLength(JSON.stringify(output));
          if (payloadWeight > 48_000_000) throw new CoreError('INDEX_CAPACITY_REACHED');
          rows.set(output.id, output);
          if (rows.size > 25_000) throw new CoreError('INDEX_CAPACITY_REACHED');
        }
        cursor = raw.next_cursor;
        if (!cursor) break;
        if (cursor.length > 1024 || cursors.has(cursor) || raw.objects.length === 0) throw new CoreError('CORE_CURSOR_INVALID');
        cursors.add(cursor);
      }
      const sorted = [...rows.values()].sort((a, b) =>
        (Date.parse(b.publishedAt || b.createdAt) || 0) - (Date.parse(a.publishedAt || a.createdAt) || 0)
        || b.id.localeCompare(a.id));
      const sources = new Map();
      for (const row of sorted) {
        const seen = new Set();
        for (const f of row.facts) {
          if (!f.sourceId) continue;
          const entry = sources.get(f.sourceId) || { id: f.sourceId, name: f.source || f.sourceId,
            country: f.country, outputs: 0, documents: new Set(), lastPublishedAt: '' };
          if (!seen.has(f.sourceId)) entry.outputs++;
          seen.add(f.sourceId);
          if (f.documentId) entry.documents.add(f.documentId);
          const pub = f.publication || row.publishedAt;
          if (pub > entry.lastPublishedAt) entry.lastPublishedAt = pub;
          sources.set(f.sourceId, entry);
        }
      }
      index = { rows, sorted, sources: [...sources.values()].map(s => ({ ...s,
        documents: s.documents.size })).sort((a, b) => b.outputs - a.outputs || a.name.localeCompare(b.name)),
        capturedAt: new Date().toISOString() };
      reason = null;
    } catch (e) {
      reason = e instanceof CoreError ? e.code : 'CORE_UNREACHABLE';
      console.warn('[rouaa] index refresh:', reason);
    } finally { pending = null; }
  })();
  return pending;
}
function status() {
  if (!SESSION_KEY) return { state: 'UNAVAILABLE', reason: 'CONNECTION_NOT_CONFIGURED' };
  if (reason) return { state: index ? 'LAST_GOOD' : 'UNAVAILABLE', reason, capturedAt: index?.capturedAt };
  if (!index) return { state: 'UNAVAILABLE', reason: 'INDEX_LOADING' };
  return { state: Date.now() - Date.parse(index.capturedAt) > STALE_MS ? 'LAST_GOOD' : 'CURRENT',
    capturedAt: index.capturedAt };
}
async function refreshMetrics() {
  if (metricsPending) return metricsPending;
  if (Date.now() - metricsAttempt < REFRESH_MS) return;
  metricsAttempt = Date.now();
  metricsPending = (async () => {
    try {
      const r = await core('/metrics');
      const latest = r?.runs?.latest_run;
      const counts = {
        outputs: number(r?.io_count), facts: number(r?.fact_count),
        documents: number(r?.document_count), sources: number(r?.source_count),
      };
      if (Object.values(counts).includes(null) || !date(r?.captured_at)) throw new Error();
      metrics = { ...counts, measuredAt: date(r.captured_at), lastRunAt: date(latest?.finished_at),
        attemptedSources: number(latest?.counters?.attempted_source_count),
        successfulSources: number(latest?.counters?.successful_source_count) };
      metricsFailed = false;
    } catch { metricsFailed = true; } finally { metricsPending = null; }
  })();
  return metricsPending;
}
function searchText(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/[_-]/g, ' ');
}
const arabic = {
  inflation_rate: 'التضخم أسعار المستهلك', unemployment_rate: 'البطالة',
  gdp_growth: 'الناتج المحلي النمو', policy_rate: 'الفائدة', rate_value: 'الفائدة',
  statistical_release: 'إصدار إحصائي', enforcement_action: 'إجراء رقابي عقوبة',
  interest_rate_decision: 'قرار الفائدة', penalty: 'غرامة عقوبة',
};
function filtered(q, rows) {
  const terms = searchText((q.get('q') || '').slice(0, 160)).trim().split(/\s+/).filter(Boolean);
  const source = q.get('source') || '';
  const type = q.get('type') || '';
  const from = plainDate(q.get('from'));
  const to = plainDate(q.get('to'));
  return rows.filter(r => {
    if (source && !r.facts.some(f => f.sourceId === source)) return false;
    if (type && type !== r.type) return false;
    const pub = plainDate(r.publishedAt);
    if ((from && (!pub || pub < from)) || (to && (!pub || pub > to))) return false;
    if (!terms.length) return true;
    const values = [r.id, r.title, r.type, arabic[r.type], r.source, ...r.facts.flatMap(f =>
      [f.entity, f.metric, arabic[f.metric], f.source, f.country, f.period, f.raw, f.documentTitle])];
    const haystack = searchText(values.join(' '));
    return terms.every(term => haystack.includes(term));
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
function staticFile(path) {
  if (['/', '/index.html', '/proof-workbench.html'].includes(path)) return 'analyst/index.html';
  if (path === '/archive-r7.html') return 'proof-workbench.html';
  if (['/analyst/app.js', '/analyst/style.css', '/brand-tokens.css',
    '/proof-workbench.js', '/proof-workbench-integrity.js', '/proof-workbench.css'].includes(path)) return path.slice(1);
  if (/^\/proof-data\/proof-(?:summary|manifest|facts|evidence|documents|events|sources|runs|quality|deliveries|intelligence-objects)\.json$/.test(path)) return path.slice(1);
  return null;
}
const SECURITY = { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    if (p === '/api/session' && req.method === 'POST') {
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return json(req, res, 403, { error: 'ORIGIN_DENIED' });
      if (!SESSION_KEY) return json(req, res, 503, { error: 'CONNECTION_NOT_CONFIGURED' });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(req, res, 415, { error: 'INVALID_LOGIN' });
      if (Date.now() - loginFailures.since >= 60_000) loginFailures = { since: Date.now(), count: 0 };
      if (loginFailures.count >= 15) return json(req, res, 429, { error: 'RETRY_LATER' });
      let data = '';
      for await (const chunk of req) {
        data += chunk;
        if (data.length > 4096) return json(req, res, 413, { error: 'INVALID_LOGIN' });
      }
      let token = '';
      try { token = JSON.parse(data)?.token; } catch { /* Invalid input. */ }
      if (typeof token !== 'string' || !eq(token, ANALYST_TOKEN)) {
        loginFailures.count++;
        return json(req, res, 401, { error: 'INVALID_ANALYST_KEY' });
      }
      const exp = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
      return json(req, res, 200, { signedIn: true }, { 'Set-Cookie': cookie(req, exp + '.' + sign(exp), SESSION_SECONDS) });
    }
    if (p === '/api/session' && req.method === 'DELETE') {
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return json(req, res, 403, { error: 'ORIGIN_DENIED' });
      return json(req, res, 200, { signedIn: false }, { 'Set-Cookie': cookie(req, '', 0) });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(req, res, 405, { error: 'READ_ONLY' }, { Allow: 'GET, HEAD' });
    if (p === '/ready') {
      if (process.env.ROUAA_REQUIRE_CORE === '1') {
        if (!index) await refreshIndex();
        if (!index) return json(req, res, 503, { status: 'not_ready' });
      }
      return json(req, res, 200, { status: 'ready' });
    }
    if (p === '/api/status') {
      if (!metrics) await refreshMetrics();
      else void refreshMetrics();
      const signedIn = hasSession(req);
      return json(req, res, 200, { signedIn, access: SESSION_KEY ? 'CONFIGURED' : 'NOT_CONFIGURED',
        feed: signedIn ? status() : null, metrics: metrics && { ...metrics, stale: metricsFailed || Date.now() - Date.parse(metrics.measuredAt) > STALE_MS } });
    }
    if (['/api/outputs', '/api/sources'].includes(p) || /^\/api\/outputs\/[A-Za-z0-9_-]{1,128}$/.test(p)) {
      if (!hasSession(req)) return json(req, res, SESSION_KEY ? 401 : 503,
        { error: SESSION_KEY ? 'SIGN_IN_REQUIRED' : 'CONNECTION_NOT_CONFIGURED' });
      if (!index) await refreshIndex();
      else void refreshIndex();
      if (!index) return json(req, res, 503, { feed: status(), error: status().reason });
      const feed = status();
      if (p === '/api/sources') return json(req, res, 200, { feed, sources: index.sources });
      if (p !== '/api/outputs') {
        const row = index.rows.get(p.slice('/api/outputs/'.length));
        return json(req, res, row ? 200 : 404, row ? { feed, output: row } : { error: 'OUTPUT_NOT_FOUND' });
      }
      const matches = filtered(u.searchParams, index.sorted);
      const pages = Math.max(1, Math.ceil(matches.length / 12));
      const requested = Math.floor(Number(u.searchParams.get('page')) || 1);
      const page = Math.min(pages, Math.max(1, requested));
      const rows = matches.slice((page - 1) * 12, page * 12).map(r => {
        const { facts, ...summary } = r;
        const f = facts.find(x => x.evidence.length && x.officialUrl) || facts[0];
        return { ...summary, factCount: facts.length, lead: f && {
          metric: f.metric, raw: f.raw, value: f.value, unit: f.unit, currency: f.currency, quality: f.quality,
          hasEvidence: Boolean(f.evidence.length && f.officialUrl),
        } };
      });
      return json(req, res, 200, { feed, rows, page, pages, count: matches.length, total: index.rows.size,
        types: [...new Set(index.sorted.map(r => r.type))].filter(Boolean).sort(),
        sources: index.sources.map(({ id, name }) => ({ id, name })) });
    }
    const file = staticFile(p);
    if (!file) return json(req, res, 404, { error: 'NOT_FOUND' });
    const data = await readFile(join(__dirname, '..', file));
    return send(req, res, 200, MIME[extname(file)], data, SECURITY);
  } catch (e) {
    if (!res.headersSent) json(req, res, e.code === 'ENOENT' ? 404 : 500, { error: 'UNAVAILABLE' });
    else res.end();
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('[rouaa] analyst server ready to accept connections');
  void refreshIndex();
  void refreshMetrics();
});
setInterval(() => { void refreshIndex(); void refreshMetrics(); }, REFRESH_MS).unref();
