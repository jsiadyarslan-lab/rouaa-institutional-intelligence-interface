'use strict';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('ar', { numberingSystem: 'latn' });
const dates = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC', numberingSystem: 'latn' });
const simple = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeZone: 'UTC', numberingSystem: 'latn' });
const time = (v, day = false) => {
  const date = new Date(v);
  if (!v || !Number.isFinite(date.valueOf())) return '';
  return (day || v.length <= 10) ? simple.format(date) : dates.format(date) + ' UTC';
};
const n = v => v == null ? '—' : number.format(v);
const labelMap = {
  statistical_release: 'إصدار إحصائي', interest_rate_decision: 'قرار فائدة', enforcement_action: 'إجراء رقابي',
  inflation_rate: 'التضخم', unemployment_rate: 'البطالة', gdp_growth: 'النمو الاقتصادي',
  rate_value: 'سعر الفائدة', policy_rate: 'سعر الفائدة', penalty: 'غرامة',
  ACTIVE: 'نشط', SUPERSEDED: 'استُبدل بإصدار أحدث', RETRACTED: 'مسحوب',
  DIRECT_EVIDENCE_SELECTED_PENDING_INDEPENDENT_REVIEW: 'مقتطف مباشر · بانتظار مراجعة مستقلة',
  percent: '%', percentage_points: 'نقطة مئوية',
};
const label = v => Object.hasOwn(labelMap, v) ? labelMap[v] : (v || '');
const configs = {
  outputs: ['أحدث المخرجات', 'اعرف ما الذي نشرته الجهات الرسمية، وما الذي استخرجه المحرك، واقرأ الدليل وراء كل نتيجة.'],
  sources: ['المصادر الرسمية', 'تصفّح الجهات التي أنتج المحرك مخرجات من وثائقها. وجود مصدر في المخزن لا يعني أنه أنتج مخرجًا.'],
  archive: ['الأرشيف', 'اطّلع على لقطات الإثبات السابقة بمعزل عن بيانات الإنتاج.'],
};
let view = 'outputs', page = 1, pages = 1, signedIn = false, haveList = false, haveSources = false, stamp = 0, detailStamp = 0;
let refresh, debounce, statusLoading = false;
const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
function line(values) { return values.filter(Boolean).join(' · '); }
function renderValue(f) {
  if (!f) return '';
  return f.raw || (f.value ? line([f.value + (label(f.unit) === '%' ? '%' : f.unit ? ' ' + label(f.unit) : ''), f.currency]) : '');
}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(76_000),
    headers: { Accept: 'application/json', ...opts.headers } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'UNAVAILABLE'), { status: r.status, data });
  return data;
}
function setBadge(title, tone, explanation = '') {
  $('badge').dataset.tone = tone;
  $('badge').replaceChildren(el('span'), document.createTextNode(title));
  $('freshness').textContent = explanation;
}
function renderFeed(feed) {
  switch (feed?.state) {
    case 'CURRENT': setBadge('متصل بالمحرك', 'good', 'آخر قراءة ناجحة ' + time(feed.capturedAt)); break;
    case 'LAST_GOOD': setBadge('عرض آخر نسخة سليمة', 'warn', line([time(feed.capturedAt), 'القراءة الجديدة متأخرة'])); break;
    default: setBadge('المخرجات غير متاحة', 'bad', feed?.reason === 'CORE_ACCESS_REJECTED' ? 'رفض Core بيانات اعتماد الخادم.' : 'تعذّرت قراءة المخرجات من المحرك.'); break;
  }
}
function renderMetrics(m) {
  if (!m) return;
  $('metrics').hidden = false;
  for (const [k, v] of Object.entries({ outCount: m.outputs, factCount: m.facts, docCount: m.documents, sourceCount: m.sources })) $(k).textContent = n(v);
  $('metricsTime').textContent = (m.stale ? 'آخر إجماليات متاحة · ' : 'إجماليات Core · ') + time(m.measuredAt);
  $('runTime').textContent = m.lastRunAt ? 'آخر تشغيل مسجّل ' + time(m.lastRunAt) : 'وقت آخر تشغيل غير متاح';
}
function empty(host, message) { host.replaceChildren(el('div', message, 'empty')); }
async function checkStatus() {
  if (statusLoading) return;
  statusLoading = true;
  try {
    const result = await api('/api/status');
    renderMetrics(result.metrics);
    const wasIn = signedIn;
    signedIn = result.signedIn;
    $('logout').hidden = !signedIn;
    $('access').hidden = signedIn || view === 'archive';
    $('login').hidden = result.access !== 'CONFIGURED';
    if (signedIn) {
      if (view !== 'archive') renderFeed(result.feed);
      if (!wasIn || view !== 'archive') await loadView();
    } else {
      $('outputs').hidden = $('sources').hidden = true;
      $('details').close();
      haveList = haveSources = false;
      if (result.access === 'CONFIGURED') {
        $('accessTitle').textContent = 'دخول المحلل';
        $('accessDescription').textContent = 'سجّل الدخول لعرض النتائج ومقتطفاتها. إجماليات الإنتاج أعلاه متاحة للقراءة العامة.';
        setBadge('المخرجات تتطلب الدخول', 'neutral');
      } else {
        $('accessTitle').textContent = 'اتصال المخرجات غير مهيّأ';
        $('accessDescription').textContent = 'إن ظهرت إجماليات Core أعلاه فهي صادرة من المحرك. القراءة التفصيلية للنتائج لم تُربط بعد.';
        setBadge('القراءة التفصيلية غير متاحة', 'warn');
      }
    }
  } catch {
    setBadge('تعذّر الاتصال بالواجهة', 'bad');
    if (!signedIn && view !== 'archive') {
      $('access').hidden = false;
      $('login').hidden = true;
      $('accessTitle').textContent = 'الاتصال غير متاح';
      $('accessDescription').textContent = 'سنعيد محاولة الاتصال تلقائيًا.';
    }
  } finally { statusLoading = false; }
}
function selectOptions(node, values, defaultLabel) {
  const current = node.value;
  node.replaceChildren(new Option(defaultLabel, ''), ...values.map(([key, title]) => new Option(title, key)));
  if (current && values.some(x => x[0] === current)) node.value = current;
}
function makeRow(row) {
  const button = el('button', null, 'result');
  button.type = 'button';
  const copy = el('span');
  const title = el('strong', row.title || label(row.type) || 'مخرج بلا عنوان');
  title.dir = 'auto';
  const meta = el('span', line([row.source, time(row.publishedAt, true), label(row.type),
    n(row.factCount) + ' حقائق', row.lead?.hasEvidence ? 'دليل متاح' : 'دليل غير متاح في العرض']), 'meta');
  copy.append(title, meta);
  const value = el('span', renderValue(row.lead) || label(row.status), 'value');
  value.dir = 'auto';
  const arrow = el('span', '‹', 'arrow');
  arrow.setAttribute('aria-hidden', 'true');
  button.append(copy, value, arrow);
  button.onclick = () => showResult(row.id);
  return button;
}
function drawList(data) {
  selectOptions($('source'), data.sources.map(s => [s.id, s.name]), 'كل المصادر');
  selectOptions($('type'), data.types.map(t => [t, label(t)]), 'كل الأنواع');
  $('resultCount').textContent = n(data.count) + ' من ' + n(data.total) + ' نتائج مفهرسة';
  page = data.page; pages = data.pages;
  $('pagination').hidden = pages <= 1;
  $('prev').disabled = page <= 1; $('next').disabled = page >= pages;
  $('pageLabel').textContent = n(page) + ' / ' + n(pages);
  if (data.rows.length) $('results').replaceChildren(...data.rows.map(makeRow));
  else empty($('results'), 'لا توجد مخرجات تطابق البحث والفلاتر.');
}
function drawSources(data) {
  $('sourceTotal').textContent = n(data.sources.length) + ' مصدرًا في نتائج المحرك';
  const rows = data.sources.map(s => {
    const button = el('button', null, 'source-row');
    button.type = 'button';
    const group = el('span');
    group.append(el('strong', s.name), el('span', line([s.country, time(s.lastPublishedAt, true), n(s.documents) + ' وثائق مرتبطة']), 'meta'));
    button.append(group, el('span', n(s.outputs) + ' مخرجات', 'value'), el('span', '‹', 'arrow'));
    button.onclick = () => {
      $('query').value = ''; $('type').value = ''; $('from').value = ''; $('to').value = '';
      if (![...$('source').options].some(o => o.value === s.id)) $('source').add(new Option(s.name, s.id));
      $('source').value = s.id; page = 1; location.hash = '#outputs';
    };
    return button;
  });
  if (rows.length) $('sourceRows').replaceChildren(...rows);
  else empty($('sourceRows'), 'لا يوجد مصدر مرتبط بالمخرجات الحالية.');
}
async function loadView() {
  if (!signedIn || view === 'archive') return;
  const request = ++stamp;
  const onSources = view === 'sources';
  const fields = { page, q: $('query').value, source: $('source').value, type: $('type').value, from: $('from').value, to: $('to').value };
  const path = onSources ? '/api/sources' : '/api/outputs?' + new URLSearchParams(fields);
  try {
    const data = await api(path);
    if (request !== stamp) return;
    renderFeed(data.feed);
    if (onSources) { haveSources = true; drawSources(data); }
    else { haveList = true; drawList(data); }
  } catch (err) {
    if (request !== stamp) return;
    if (err.status === 401) {
      signedIn = false;
      $('outputs').hidden = $('sources').hidden = true;
      $('details').close();
      if (!statusLoading) void checkStatus();
      return;
    }
    if (err.data?.feed) renderFeed(err.data.feed);
    else setBadge('تعذّرت قراءة آخر النتائج', 'warn');
    if (!(onSources ? haveSources : haveList)) empty($(onSources ? 'sourceRows' : 'results'), 'لا يمكن عرض النتائج الآن. ستتم إعادة المحاولة تلقائيًا.');
  }
}
function titleForDetail(text) {
  const h = el('h2', text);
  h.id = 'detailTitle'; h.dir = 'auto';
  return h;
}
function factDetail(f) {
  const item = el('article', null, 'fact');
  item.append(el('h3', label(f.metric) || 'الحقيقة المستخرجة'), el('div', renderValue(f) || 'القيمة غير متاحة', 'value'));
  const entity = el('span', line([f.entity, f.period, time(f.publication, true), label(f.quality)]), 'meta');
  entity.dir = 'auto'; item.append(entity);
  for (const ev of f.evidence) {
    const excerpt = el('blockquote', ev.excerpt); excerpt.dir = 'auto'; item.append(excerpt);
  }
  if (!f.evidence.length) item.append(el('p', 'مقتطف الدليل غير متاح لهذه الحقيقة.', 'missing'));
  if (f.officialUrl) {
    const link = el('a', 'افتح الوثيقة الرسمية ↗');
    link.href = f.officialUrl; link.rel = 'noopener noreferrer'; link.target = '_blank'; item.append(link);
  } else item.append(el('p', 'رابط الوثيقة الرسمية غير متاح.', 'missing'));
  const ids = el('details');
  ids.append(el('summary', 'معرّفات التتبّع'));
  const p = el('p', line([f.documentId, f.factId, ...f.evidence.map(ev => ev.id)])); p.dir = 'ltr'; ids.append(p);
  item.append(ids);
  return item;
}
async function showResult(id) {
  const key = ++detailStamp;
  const d = $('details');
  $('detailBody').replaceChildren(titleForDetail('جارٍ قراءة النتيجة…'));
  if (!d.open) d.showModal();
  try {
    const data = await api('/api/outputs/' + encodeURIComponent(id));
    if (key !== detailStamp || !d.open) return;
    const r = data.output;
    const meta = el('p', line([r.source, time(r.publishedAt, true), label(r.status), r.version && 'الإصدار ' + n(r.version)]), 'meta'); meta.dir = 'auto';
    $('detailBody').replaceChildren(el('p', data.feed.state === 'LAST_GOOD' ? 'من آخر نسخة سليمة' : label(r.type), 'eyebrow'),
      titleForDetail(r.title || 'نتيجة المحرك'), meta, ...r.facts.map(factDetail));
    if (!r.facts.length) $('detailBody').append(el('p', 'لا توجد حقائق مرتبطة بهذا المخرج في الرد.', 'empty'));
  } catch { if (key === detailStamp && d.open) $('detailBody').replaceChildren(titleForDetail('لم نتمكن من فتح هذه النتيجة.')); }
}
function changeView() {
  const next = location.hash.slice(1);
  view = Object.hasOwn(configs, next) ? next : 'outputs';
  stamp++;
  $('title').textContent = configs[view][0]; $('intro').textContent = configs[view][1];
  document.querySelectorAll('nav a[data-view]').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  for (const key of Object.keys(configs)) $(key).hidden = key !== view || (key !== 'archive' && !signedIn);
  if (view === 'archive') {
    $('access').hidden = true;
    setBadge('لقطات محفوظة', 'neutral');
  } else if (signedIn) {
    $('access').hidden = true;
    void loadView();
  } else void checkStatus();
}
$('filters').addEventListener('submit', e => { e.preventDefault(); page = 1; void loadView(); });
$('query').addEventListener('input', () => { clearTimeout(debounce); page = 1; debounce = setTimeout(loadView, 230); });
for (const id of ['source', 'type', 'from', 'to']) $(id).addEventListener('change', () => { page = 1; void loadView(); });
$('clear').onclick = () => { $('filters').reset(); page = 1; void loadView(); };
$('prev').onclick = () => { page = Math.max(1, page - 1); void loadView(); };
$('next').onclick = () => { page = Math.min(pages, page + 1); void loadView(); };
$('login').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('loginError').textContent = '';
  const button = $('login').querySelector('button');
  button.disabled = true;
  const token = $('key').value; $('key').value = '';
  try {
    await api('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    await checkStatus(); changeView();
  } catch (err) {
    $('loginError').textContent = err.status === 401 ? 'المفتاح غير صحيح.' : err.status === 429 ? 'أعد المحاولة بعد دقيقة.' : 'تعذّر تسجيل الدخول.';
  } finally { button.disabled = false; }
});
$('logout').onclick = async () => {
  try { await api('/api/session', { method: 'DELETE' }); } catch { setBadge('تعذر تسجيل الخروج', 'warn'); return; }
  signedIn = haveList = haveSources = false;
  stamp++;
  $('results').replaceChildren(); $('sourceRows').replaceChildren(); $('details').close();
  changeView();
};
window.addEventListener('hashchange', changeView);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkStatus(); });
changeView();
if (view === 'archive') void checkStatus();
refresh = setInterval(() => { if (!document.hidden) void checkStatus(); }, 30_000);
