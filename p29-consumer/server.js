'use strict';

/**
 * P2.9 — Server-side integration harness for the institutional interface.
 *
 * Order §7 security architecture:
 *  - CORE_API_TOKEN (and the Core URL) live ONLY in this server's env.
 *    They are never sent to, stored in, or referenced by browser code.
 *  - The browser talks same-origin to THIS server only.
 *  - This server proxies a whitelist of GET-only paths to the Core
 *    transport, attaching the Authorization header server-side.
 *  - Every write verb is rejected with 405 before anything else.
 *  - When Core is unreachable, the proxy returns an explicit 503
 *    UNAVAILABLE envelope — the UI then renders its UNAVAILABLE state;
 *    no data is ever fabricated, cached, or substituted.
 *
 * This is an authorized isolated integration harness (order §7): it
 * proves consumption of the real isolated Core API. It is NOT a new
 * production service and must not be deployed.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.P29_CONSUMER_PORT || 4180);
const CORE_URL = process.env.P29_CORE_URL || 'http://127.0.0.1:9110';
const CORE_TOKEN = process.env.P29_CORE_TOKEN || '';   // server-side only
const STATIC_ROOT = __dirname;

// The only Core paths this consumer may read (GET-only, per P2.9 §6).
const PROXY_ALLOW = [
  /^\/v1\/intelligence$/,
  /^\/v1\/intelligence\/[A-Za-z0-9_-]+$/,
  /^\/v1\/intelligence\/[A-Za-z0-9_-]+\/trace$/,
  /^\/v1\/sources\/[A-Za-z0-9_-]+$/,
  /^\/v1\/documents\/[A-Za-z0-9_-]+$/,
  /^\/v1\/representations\/[A-Za-z0-9_-]+$/,
  /^\/v1\/evidence\/[A-Za-z0-9_-]+$/,
  /^\/v1\/facts\/[A-Za-z0-9_-]+$/,
  /^\/v1\/events\/[A-Za-z0-9_-]+$/,
  /^\/v1\/runs\/[A-Za-z0-9_-]+$/,
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, type, body, extraHeaders) {
  res.writeHead(status, Object.assign({
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }, extraHeaders || {}));
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8',
       JSON.stringify(obj), null);
}

function proxyAllowed(pathname) {
  return PROXY_ALLOW.some(rx => rx.test(pathname));
}

async function proxy(req, res, pathname) {
  if (!proxyAllowed(pathname)) {
    return sendJson(res, 404, {
      error: { code: 'NOT_FOUND',
               message: 'path not in the P2.9 consumer read whitelist' } });
  }
  if (!CORE_TOKEN) {
    return sendJson(res, 503, {
      error: { code: 'INTEGRATION_MISCONFIGURED',
               message: 'server-side Core credential is absent; ' +
                        'no request was made; nothing is fabricated' } });
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const upstream = await fetch(CORE_URL + pathname, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + CORE_TOKEN,
                 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (_) { /* keep raw */ }
    if (parsed === null) {
      return sendJson(res, 502, {
        error: { code: 'UPSTREAM_NOT_JSON',
                 message: 'Core response was not valid JSON',
                 status: upstream.status } });
    }
    const headers = {};
    const etag = upstream.headers.get('etag');
    if (etag) headers['ETag'] = etag;
    return send(res, upstream.status,
                 'application/json; charset=utf-8', body, headers);
  } catch (error) {
    return sendJson(res, 503, {
      error: { code: 'CORE_UNAVAILABLE',
               message: 'isolated Core API is unreachable: ' +
                        (error && error.message ? error.message : String(error)),
               hint: 'the interface renders an explicit UNAVAILABLE state; ' +
                     'it never fabricates data' } });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  // Write verbs are rejected first, always (fail closed).
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, {
      error: { code: 'READ_ONLY',
               message: 'the institutional interface can only read' } });
  }

  // API proxy (same-origin; browser never sees the Core token).
  if (pathname.startsWith('/api/')) {
    const corePath = pathname.slice('/api'.length) || '/';
    return proxy(req, res, corePath);
  }

  // Static consumer assets (this harness dir only).
  let file = pathname === '/' ? '/consumer.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(STATIC_ROOT, file);
  if (!abs.startsWith(STATIC_ROOT)) {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND',
      message: 'outside the harness root' } });
  }
  let stat = null;
  try { stat = fs.statSync(abs); } catch (_) { /* not found */ }
  if (!stat || !stat.isFile()) {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND',
      message: 'asset not found: ' + pathname } });
  }
  fs.readFile(abs, (error, data) => {
    if (error) {
      return sendJson(res, 500, { error: { code: 'READ_ERROR',
        message: 'asset could not be read' } });
    }
    const type = MIME[path.extname(abs)] || 'application/octet-stream';
    send(res, 200, type, data);
  });
});

if (!CORE_TOKEN) {
  console.error('[p29-consumer] P29_CORE_TOKEN must be set server-side; refusing to start without it (fail closed)');
  process.exit(2);
}
server.listen(PORT, '127.0.0.1', () => {
  console.log('[p29-consumer] listening on http://127.0.0.1:' + PORT +
              ' (GET-only; Core token held server-side)');
});
