/* رؤى — واجهة المحلل: التفاعل كله فوق فهرس الخادم (بحث/فلاتر/ترقيم خادمية) */
"use strict";

const state = { view: "outputs", page: 1, pageSize: 10, summary: null,
                filters: null, q: "", flt: {country:"", sector:"", source:"", period:""} };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtTime = (iso) => iso ? iso.replace("T"," ").replace("Z"," UTC") : "غير متوفر";

async function api(path) {
  const r = await fetch(path, {credentials: "same-origin", cache: "no-store"});
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

/* ---------- navigation ---------- */
document.querySelectorAll(".navlink").forEach(a => a.addEventListener("click", (e) => {
  e.preventDefault();
  state.view = a.dataset.view;
  document.querySelectorAll(".navlink").forEach(x =>
    x.classList.toggle("active", x === a));
  document.querySelectorAll(".view").forEach(v =>
    v.hidden = (v.id !== "view-" + state.view));
  if (state.view === "sources") loadSources();
  if (state.view === "archive") loadArchive();
  if (state.view === "ops") loadOps();
}));

/* ---------- summary (header + filters) ---------- */
async function loadSummary() {
  const s = await api("/analyst/api/summary");
  state.summary = s; state.filters = s.filters;
  const t = s.totals;
  $("headData").innerHTML =
    `آخر بيانات: <b>${fmtTime(s.health.last_ok_at)}</b>` +
    (s.health.delay_reason ? ` · متأخر — السبب: ${esc(s.health.delay_reason)}` : "") +
    `<br>${t.intelligence_objects} مخرجًا · ${t.facts} حقيقة · ${t.documents} وثيقة · ${t.sources_acquired} مصدرًا`;
  const fill = (id, key, label) => {
    const sel = $(id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">${label}</option>` +
      s.filters[key].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if (s.filters[key].includes(cur)) sel.value = cur;
  };
  fill("f-country", "countries", "كل البلدان");
  fill("f-sector", "sectors", "كل القطاعات");
  fill("f-source", "source_ids", "كل المصادر");
  fill("f-period", "periods", "كل الفترات");
}

/* ---------- outputs (server-side search/filter/pagination) ---------- */
async function loadOutputs() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.flt.country) p.set("country", state.flt.country);
  if (state.flt.sector) p.set("sector", state.flt.sector);
  if (state.flt.source) p.set("source_id", state.flt.source);
  if (state.flt.period) p.set("period", state.flt.period);
  p.set("page", state.page); p.set("page_size", state.pageSize);
  const d = await api("/analyst/api/outputs?" + p.toString());
  $("resultsline").textContent =
    `النتائج ${d.total === 0 ? 0 : ((d.page-1)*d.page_size+1)}–${Math.min(d.page*d.page_size, d.total)} من ${d.total} · صفحة ${d.page} من ${d.pages}`;
  $("results").innerHTML = d.objects.map(cardOf).join("") ||
    '<div class="resultsline">لا نتائج لهذه الفلاتر.</div>';
  document.querySelectorAll(".card").forEach(c =>
    c.addEventListener("click", () => openEvidence(c.dataset.io)));
  const pg = $("pager");
  pg.innerHTML = "";
  const mk = (label, page, dis) => {
    const b = document.createElement("button");
    b.textContent = label; b.disabled = dis;
    b.addEventListener("click", () => { state.page = page; loadOutputs(); });
    pg.appendChild(b);
  };
  mk("السابق", d.page - 1, d.page <= 1);
  const span = document.createElement("span");
  span.textContent = `${d.page} / ${d.pages}`;
  pg.appendChild(span);
  mk("التالي", d.page + 1, d.page >= d.pages);
}

function cardOf(o) {
  /* النتيجة تبدأ بالمعلومة وما تغيّر، ثم المصدر والفترة وتاريخ النشر وحالة الإصدار */
  const changed = o.status && o.status !== "ACTIVE"
    ? `<span class="card-changed">التغيّر: ${esc(o.status)}${o.version ? " · إصدار v" + esc(o.version) : ""}</span>` : "";
  return `
  <article class="card" data-io="${esc(o.io_id)}">
    <div class="card-top">
      <span class="card-headline">${esc(o.headline || "مخرج استخباراتي")}</span>
      <span class="chip">${esc(o.event_type)}</span>
      ${o.period ? `<span class="chip">فترة ${esc(o.period)}</span>` : ""}
    </div>
    <div class="card-what">${o.metrics.map(m => `<b>${esc(m)}</b>`).join(" · ")}
      — ${o.fact_count} حقيقة مدعومة بأدلة (${o.evidence_count})</div>
    ${changed}
    <div class="card-meta">
      <span class="m">المصدر: <b>${esc(o.institution)}</b> (${esc(o.source_id)})</span>
      <span class="m">البلد: <b>${esc(o.country || "—")}</b></span>
      <span class="m">القطاع: <b>${esc(o.sector || "—")}</b></span>
      <span class="m">نُشر: <b>${fmtTime(o.created_at)}</b></span>
      <span class="m">الحالة: <b>${esc(o.status || "—")}</b></span>
    </div>
  </article>`;
}

/* ---------- evidence panel ---------- */
async function openEvidence(ioId) {
  const o = await api("/analyst/api/output/" + encodeURIComponent(ioId));
  $("pv-title").textContent = o.headline || ioId;
  $("pv-kicker").textContent = "الدليل — " + ioId;
  $("pv-body").innerHTML = `
    <div class="card-meta" style="margin-bottom:12px">
      <span class="m">المصدر: <b>${esc(o.institution)}</b></span>
      <span class="m">البلد: <b>${esc(o.country || "—")}</b></span>
      <span class="m">القطاع: <b>${esc(o.sector || "—")}</b></span>
      <span class="m">الفترة: <b>${esc(o.period || "—")}</b></span>
      <span class="m">النشر: <b>${fmtTime(o.created_at)}</b></span>
      <span class="m">الحالة: <b>${esc(o.status || "—")}</b></span>
    </div>
    ${o.facts.map((f, i) => `
      <div class="factrow">
        <div class="metric">${esc(f.metric || "مقياس")}</div>
        <div class="val">${esc(f.value ?? f.raw_value ?? "—")}</div>
        ${o.excerpt && i === 0 ? `<div class="excerpt">…${esc(o.excerpt)}…</div>` : ""}
      </div>`).join("")}
    <div class="docline">الوثيقة الرسمية:
      ${o.canonical_url
        ? `<a href="${esc(o.canonical_url)}" target="_blank" rel="noopener noreferrer">${esc(o.canonical_url)}</a>`
        : "غير متوفرة لهذا المخرج"}
      ${o.document_id ? ` · <span class="mono">${esc(o.document_id)}</span>` : ""}
    </div>`;
  $("evidencePanel").showModal();
}
$("pv-close").addEventListener("click", () => $("evidencePanel").close());

/* ---------- sources (تقدم حقيقي مفصول: مسجّل/مجلوب/منتِج) ---------- */
async function loadSources() {
  const d = await api("/analyst/api/sources");
  const s = state.summary;
  const reg = 805, unq = 306;  /* من سجل المصادر الرسمي (source_registry) */
  const acq = s ? s.totals.sources_acquired : 0;
  const prod = s ? s.totals.sources_producing : 0;
  $("progress-real").innerHTML = `
    <b class="hl">مسجّل:</b> ${reg} سجلًا (${unq} مصدرًا فريدًا) ·
    <b class="hl">جُلب منه:</b> ${acq} · <b class="hl">أنتج استخبارات:</b> ${prod}
    — الهدف: 2,000 مصدر ناجح الاقتناء · مليونا وثيقة فريدة`;
  $("sourcesbody").innerHTML = `
    <table class="src">
      <tr><th>المصدر</th><th>المؤسسة</th><th>البلد</th><th>القطاع</th>
          <th>وثائق</th><th>أنتج استخبارات</th></tr>
      ${d.sources.map(x => `
        <tr><td class="mono">${esc(x.source_id)}</td>
            <td>${esc(x.institution)}</td>
            <td>${esc(x.country || "—")}</td>
            <td>${esc(x.sector || "—")}</td>
            <td>${x.documents}</td>
            <td class="${x.produced_intelligence ? "tag-ok" : "tag-no"}">
              ${x.produced_intelligence ? "نعم" : "لا"}</td></tr>`).join("")}
    </table>`;
}

/* ---------- archive (R7 منقول إلى هنا — ليس الواجهة الرئيسية) ---------- */
async function loadArchive() {
  let html = "";
  try {
    const a = await api("/analyst/api/archive/r7");
    const s = a.summary || {};
    html = `
    <div class="factrow">
      <div class="metric">لقطة R7 المؤرشفة (منقولة من الواجهة الرئيسية القديمة)</div>
      <div class="val">نطاق: ${esc(s.data_scope || "—")}</div>
      <div class="docline">توليد: ${fmtTime(s.generated_at)} · نوع اللقطة: ${esc(s.snapshot_kind || "—")}
        · run: <span class="mono">${esc(s.run_id || "—")}</span></div>
    </div>`;
  } catch { html = '<div class="resultsline">أرشيف R7 غير متوفر.</div>'; }
  $("archivebody").innerHTML = html +
    '<div class="resultsline">الأرشيف التاريخي الرسمي يتوسع مع كل دفعة جلب مكتملة — انظر «المخرجات» و«المصادر».</div>';
}

/* ---------- operator space (سجلات التشغيل — منفصلة عن واجهة المحلل) ---------- */
async function loadOps() {
  const s = state.summary;
  const runs = s ? s.runs : [];
  const t = s ? s.totals : {};
  const docTarget = t.documents ? Math.min(100, (t.documents / 2000000) * 100) : 0;
  const srcTarget = t.sources_acquired ? Math.min(100, (t.sources_acquired / 2000) * 100) : 0;
  $("opsbody").innerHTML = `
    <div class="funnel">
      <div class="f"><small>مصادر مسجّلة (سجل رسمي)</small><b>805</b></div>
      <div class="f"><small>جُلب منها فعليًا</small><b>${t.sources_acquired ?? "—"}</b></div>
      <div class="f"><small>أنتجت استخبارات</small><b>${t.sources_producing ?? "—"}</b></div>
      <div class="f"><small>حقائق / مخرجات</small><b>${t.facts ?? "—"} / ${t.intelligence_objects ?? "—"}</b></div>
    </div>
    <div class="target">هدف المصادر (2,000 ناجح اقتناء):
      <div class="bar"><i style="width:${srcTarget.toFixed(3)}%"></i></div></div>
    <div class="target">هدف الوثائق (مليونا فريدة):
      <div class="bar"><i style="width:${docTarget.toFixed(4)}%"></i></div></div>
    <h4 style="margin:16px 0 6px">سجلات التشغيل</h4>
    ${runs.map(r => `
      <div class="runline"><span class="runid">${esc(r.run_id)}</span>
        <span>${fmtTime(r.finished_at)}</span>
        <span>${esc(r.data_class || "")} · ${esc(r.mode || "")}</span>
        <span>مصادر: ${r.counters?.invocation_successful_source_count ?? "—"}/${r.counters?.invocation_attempted_source_count ?? "—"} ناجحة</span>
        <span>فشل: ${r.counters?.invocation_failed_source_count ?? "—"}</span></div>`).join("")}
    <div class="blocker">العائق الفعلي للوصول إلى الأهداف على الرابط الحي: قراءة كامل مخزن Core
      تتطلب <b>CORE_TOKEN/CORE_API_TOKEN</b> على جسر الواجهة (مسارات P29 المحمية — 401)،
      والنشر على الرابط يتطلب <b>RAILWAY_API_TOKEN</b> أو ربط الخدمات بمستودع.
      الاثنان بيد المالك — كل ما عداهما مشغّل ومُثبت.</div>`;
}

/* ---------- toolbar wiring ---------- */
$("apply").addEventListener("click", () => {
  state.q = $("q").value.trim();
  state.flt = { country: $("f-country").value, sector: $("f-sector").value,
                source: $("f-source").value, period: $("f-period").value };
  state.page = 1;
  loadOutputs();
});
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("apply").click();
});

/* ---------- boot ---------- */
(async function boot() {
  await loadSummary();
  await loadOutputs();
  setInterval(loadSummary, 60000);  /* وقت آخر بيانات يتحدث تلقائيًا */
})();
