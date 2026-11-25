'use strict';

/**
 * ROUAA analyst site server (V3 → v10) — same-origin bridge, honesty-first.
 *
 * v10 changes (2026-11-25):
 *  openapi      : GET /analyst/api/openapi.json — عقد آلة OpenAPI 3.0.3
 *                 لكل نقاط الجسر؛ مخططات خشنة عن قصد (object عام) — الحقول
 *                 التفصيلية تُقرأ من الاستجابة الفعلية لا تُخترع في العقد.
 *  status api   : GET /analyst/api/status — بيانات حالة عامة تُقرأ من ذاكرة
 *                 الجسر مباشرة (قبل سلسلة ensureIndex، كـ POST المراجعة)
 *                 فتعمل قبل بناء الفهرس وأثناءه وبعده، بلا مصادقة.
 *  status page  : GET /status (HTML عربي RTL مكتفٍ بذاته) و /status.json
 *                 (نفس الحمولة) — يُخدمان قبل الملفات الثابتة؛ /status يُعدّ
 *                 مشاهدة صفحة و /status.json طلب API (عدّ صادق، والإقصاء
 *                 الوحيد في العدّاد يبقى /analyst/api/stats نفسه فقط).
 *
 * v9 changes (2026-11-25):
 *  serve-fast   : PROBE_TTL_MS — داخل نافذة TTL تُخدم الطلبات من الذاكرة
 *                 بلا أي نداء على Core (كان كل طلب يستقصي /metrics + السجل
 *                 فيكلّف الطلب ~3.2 ثانية). الاستقصاء يحدّث الفهرس عند التغيّر.
 *  cold-start   : جلب التوثيقات (traces) متوازٍ بدفعات من 8 بدل التسلسل.
 *  review-queue : غرفة المراجعة في طلب واحد بدل مشي 20 صفحة لدى العميل.
 *  indicators   : أحدث قيمة معلنة لكل جهة، من الحقائق المهيكلة للفهرس الحي.
 *  review-token : حوكمة سطح الكتابة — REVIEW_TOKEN اختياري عبر ترويسة
 *                 x-review-token (مقارنة زمنية ثابتة)؛ غير مضبوط = تطوير مفتوح.
 *  usage stats  : عدّاد يومي بلا تتبع (لا IP ولا معرّفات) + /analyst/api/stats.
 *  gloss_ar     : خلاصة تنفيذية عربية مركّبة آلياً على كل كائن مخدوم.
 *
 * Changes over V2 (each maps to a defect in the 2026-11-19 brutal audit):
 *  P1 disclosure   : summary declares store-records vs objects vs superseded
 *                    versions; health exposes data_asof + index state. Review
 *                    decisions are written SERVER-SIDE (append-only JSONL,
 *                    validated) and change the served verdict — no browser-only
 *                    truth. Core itself stays strictly GET-only (its API has no
 *                    write endpoints; engine-side persistence is the engine
 *                    team's task and is declared as such in the gates panel).
 *  P2 reconcile    : feed is deduped by io_id; summary counts objects (unique
 *                    feed ids) separately from store records (versions); the
 *                    old "152 objects" lie (it counted versions) is fixed.
 *                    Sort is deterministic (content date desc, io_id asc) so
 *                    pagination can never show holes; every response carries
 *                    index_built_at so consumers can detect mid-walk rebuilds.
 *  P3 period truth : period derives ONLY from document content dates (temporal
 *                    tuples / publication tuples / official URL pattern).
 *                    Acquisition month is NEVER presented as a content period.
 *                    Objects without a content date get period='' and
 *                    freshness='undated'. Documents older than 365d are
 *                    explicitly freshness='archived'.
 *  P4 enrichment   : Arabic names, composed Arabic titles, display values,
 *                    parsed fact structures (JSON-in-string is parsed at serve
 *                    time), Arabic period, verdict — all computed HERE, server
 *                    side, for every consumer; the display layer only renders.
 *  P5 depth/export : fact_count/depth on every card payload; list + dossier
 *                    export via JSON/CSV (client composes from this API).
 *  P6 gates        : quality_gates computed live from the served data.
 *
 * Contracts kept: GET-only toward Core (token server-side, never sent to the
 * browser), same-origin only, explicit 503 envelopes, /archive/ provenance.
 * The one deliberate write surface is POST /analyst/api/review — an append-only
 * server-side review log; it never touches Core.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const RAILWAY_CORE_URL = process.env.RAILWAY_SERVICE_ROUAA_INTELLIGENCE_CORE_API_URL || '';
const CORE_URL_IN = (RAILWAY_CORE_URL || process.env.CORE_URL || '');
const isLocalCore = (u) => /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u);
const CORE_URL = CORE_URL_IN
  .replace(/\/$/, '')
  .replace(/^[a-z0-9.-]+\.[a-z]+$/i, (h) => 'https://' + h)
  .replace(/^http:\/\//, (m) => isLocalCore(CORE_URL_IN) ? 'http://' : 'https://');
const CORE_TOKEN = process.env.CORE_TOKEN || '';
const STATIC_ROOT = __dirname;
// سجل المراجعة يجب أن يعيش خارج حزمة النشر (النشر يستبدل STATIC_ROOT
// ويمحو سجل المراجعة). Railway يقرّب /data كمجلد دائم مُحمل — استخدمه إن
// وُجد، وإلا fallback محلي للتطوير.
// REVIEWS_DATA_DIR: مسار مجلد دائم اختياري (مثل مجلد Railway مُحمل).
// إن لم يُضبط أو لم يكن موجوداً نقع في مجلد الشيفرة المؤقت — والحقيقة
// تُعلن في health.reviews_persistent كي لا يُدّعى الدوام بلا دليل.
const DATA_DIR = (() => {
  const cfg = process.env.REVIEWS_DATA_DIR || '/data';
  try { fs.statSync(cfg); if (fs.statSync(cfg).isDirectory()) return cfg; } catch (_) {}
  return STATIC_ROOT;
})();
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.jsonl');
// v9: حوكمة سطح الكتابة الوحيد — إن ضُبط REVIEW_TOKEN تصبح POST /review
// مشروطة بترويسة x-review-token مطابقة تماماً (مقارنة زمنية ثابتة).
// غير مضبوط = سلوك اليوم حرفياً (وضع تطوير مفتوح).
const REVIEW_TOKEN = process.env.REVIEW_TOKEN || '';
// v10: إصدار بروتوكول الجسر — يُعلن في صفحة الحالة وعقد OpenAPI. نسخة
// package.json (1.0.0) هي نسخة الحزمة لا إصدار الجسر، فلا نخلط بينهما.
const SERVER_VERSION = 'v10';
// v9: نافذة خدمة الذاكرة — داخلها لا يُستقصى Core إطلاقاً (كان كل طلب
// يستقصي /metrics + السجل في كلّف ~3.2 ثانية). عند انقضائها يستيقظ
// الاستقصاء مرة واحدة ثم تتجدد النافذة.
const PROBE_TTL_MS = Number(process.env.PROBE_TTL_MS || 60000);
// v9: مسار عدّاد الاستخدام اليومي بلا تتبع (لا IP ولا وكيل ولا معرّفات).
const USAGE_FILE = path.join(DATA_DIR, 'usage.jsonl');

const PROXY_ALLOW = [
  /^\/health$/,
  /^\/metrics$/,
  /^\/v1\/intelligence(\?.*)?$/,
  /^\/v1\/intelligence\/[A-Za-z0-9_-]+(\?.*)?$/,
  /^\/v1\/intelligence\/[A-Za-z0-9_-]+\/trace(\?.*)?$/,
  /^\/v1\/sources\/[A-Za-z0-9_-]+$/,
  /^\/v1\/documents\/[A-Za-z0-9_-]+$/,
  /^\/v1\/representations\/[A-Za-z0-9_-]+$/,
  /^\/v1\/evidence\/[A-Za-z0-9_-]+$/,
  /^\/v1\/facts\/[A-Za-z0-9_-]+$/,
  /^\/v1\/events\/[A-Za-z0-9_-]+$/,
  /^\/v1\/runs\/[A-Za-z0-9_-]+$/,
  /^\/v1\/ops\/registry(\?.*)?$/,
  /^\/v1\/ops\/registry\/summary$/,
  /^\/v1\/ops\/registry\/[A-Za-z0-9_-]+$/,
];

const INDEX_STATE = {
  objects: null, projected: null, traces: null, registry: null, metrics: null,
  builtAt: null, lastOkAt: null, delayReason: null,
  servingLastGood: false, building: null,
  storeRecords: null, supersededVersions: 0, feedDuplicates: 0,
  reviewsByIo: null, lastProbeAt: 0,
};

// Producing-source id → canonical English institution (registry rows may fall
// back to the raw source id as institution_name — resolve to real names).
const SRC_INST = {"src-abs":"Australian Bureau of Statistics","src-ba-finland":"Finnish Financial Supervisory Authority","src-boc":"Bank of Canada","src-boe":"Bank of England","src-cb-turkey":"Central Bank of the Republic of Turkey","src-cftc":"Commodity Futures Trading Commission","src-cso-ireland":"Central Statistics Office (Ireland)","src-cssf-luxembourg":"Commission de Surveillance du Secteur Financier (Luxembourg)","src-ecb":"European Central Bank","src-eia-electricity-price-us":"INST-eia-001","src-esma":"European Securities and Markets Authority","src-eurostat-hicp-de":"INST-eurostat-001","src-fca":"Financial Conduct Authority","src-fed-reserve":"Federal Reserve System","src-istat":"Istat (Italy)","src-nbu-ukraine":"National Bank of Ukraine","src-ons":"Office for National Statistics (UK)","src-sec":"Securities and Exchange Commission","src-sfc-hk":"Securities and Futures Commission (HK)","src-snb":"Swiss National Bank"};
function resolveInstitution(rec, src, srcId) {
  const recName = (rec && rec.institution_name) || '';
  if (recName && !/^src-/i.test(recName)) return recName;
  return SRC_INST[srcId] || (src && src.institution_id) || recName || srcId;
}
// P1: apply the CURRENT server-side review map onto a projected object.
function applyReview(o, reviewsByIo) {
  const review = reviewsByIo && reviewsByIo[o.io_id];
  if (!review) return o;
  return Object.assign({}, o, {
    review: { verdict: review.verdict, actor: review.actor, at: review.at, note: review.note || '' },
    quality_verdict: review.verdict,
    verdict_ar: VERDICT_AR[review.verdict] || review.verdict,
  });
}

// ── Enrichment lexicon (lifted from the audit-approved display layer — P4) ──
const COUNTRY_AR = {"US":"الولايات المتحدة","UK":"المملكة المتحدة","EU":"الاتحاد الأوروبي","DE":"ألمانيا","FR":"فرنسا","IT":"إيطاليا","JP":"اليابان","CA":"كندا","CN":"الصين","IE":"أيرلندا","LU":"لوكسمبورغ","TR":"تركيا","UA":"أوكرانيا","AE":"الإمارات","AU":"أستراليا","BR":"البرازيل","KE":"كينيا","FI":"فنلندا","HK":"هونغ كونغ","CH":"سويسرا","SE":"السويد","NL":"هولندا","ES":"إسبانيا","PT":"البرتغال","IN":"الهند","INTL":"دولي/متعدد الأطراف"};
const SECTOR_AR = {"central_bank":"بنوك مركزية","statistical_agency":"جهات إحصائية","securities_regulator":"رقابة أوراق مالية","financial_regulator":"رقابة مالية","finance_ministry":"وزارات مالية","energy_regulator":"رقابة طاقة","commodity_regulator":"رقابة سلع","insurance_regulator":"رقابة تأمين","banking_regulator":"رقابة بنوك","official_development_institution":"مؤسسات تنمية","international_financial_institution":"مؤسسات مالية دولية","international_economic_institution":"مؤسسات اقتصادية دولية","stock_exchange":"بورصات","energy_ministry":"وزارات طاقة","customs_authority":"جمارك","competition_authority":"حماية المنافسة","telecom_regulator":"رقابة اتصالات","agricultural_agency":"جهات زراعية","mining_authority":"سلطات مناجم","labor_ministry":"وزارات عمل","trade_ministry":"وزارات تجارة","environmental_carbon_authority":"بيئة وكربون","sovereign_wealth_institution":"صناديق سيادية","corporate_registrar":"سجلات شركات","industrial_ministry":"وزارات صناعة","transport_authority":"سلطات نقل","pension_regulator":"رقابة معاشات","insolvency_authority":"سلطات إفلاس","regional_economic_institution":"اقتصاد إقليمي","":"غير محدد"};
const METRIC_AR = {"inflation_rate":"معدل التضخم","retail_electricity_price":"سعر الكهرباء للأسر","policy_interest_rate":"سعر الفائدة المرجعي","policy_rate":"سعر الفائدة الأساسي","official_policy_decision":"قرار رسمي","action_type":"نوع الإجراء","violation_type":"نوع المخالفة","defendant_name":"الكيان المعني","sanctions_designation":"إدراج ضمن العقوبات","enforcement_action":"إجراء إنفاذ","fx_reserve":"الاحتياطيات الأجنبية","gdp_growth":"نمو الناتج المحلي","unemployment_rate":"معدل البطالة","ppi":"مؤشر أسعار المنتجين","cpi":"مؤشر أسعار المستهلك"};
const NUMERIC_METRICS = new Set(["inflation_rate","retail_electricity_price","policy_interest_rate","policy_rate","gdp_growth","unemployment_rate","ppi","cpi","fx_reserve"]);
const DEFAULT_UNIT = {"inflation_rate":"percent","retail_electricity_price":"cents per kilowatthour","policy_interest_rate":"percent","policy_rate":"percent","gdp_growth":"percent","unemployment_rate":"percent","ppi":"index","cpi":"index","fx_reserve":"USD"};
const INSTITUTION_AR = {"Federal Reserve System":"نظام الاحتياطي الفيدرالي الأمريكي","European Central Bank":"البنك المركزي الأوروبي","U.S. Energy Information Administration":"إدارة معلومات الطاقة الأمريكية","INST-eia-001":"إدارة معلومات الطاقة الأمريكية","Eurostat":"المكتب الإحصائي الأوروبي (يوروستات)","INST-eurostat-001":"المكتب الإحصائي الأوروبي (يوروستات)","Financial Conduct Authority":"هيئة السلوك المالي (المملكة المتحدة)","Bank of Canada":"بنك كندا","European Securities and Markets Authority":"هيئة الأوراق المالية والأسواق الأوروبية","Finnish Financial Supervisory Authority":"هيئة الرقابة المالية الفنلندية","Office for National Statistics (UK)":"المكتب الوطني للإحصاءات (المملكة المتحدة)","Securities and Exchange Commission":"هيئة الأوراق المالية والبورصات الأمريكية","Australian Bureau of Statistics":"المكتب الأسترالي للإحصاء","Central Bank of the Republic of Turkey":"البنك المركزي لجمهورية تركيا","Commission de Surveillance du Secteur Financier (Luxembourg)":"هيئة رقابة القطاع المالي (لوكسمبورغ)","Istat (Italy)":"المعهد الوطني الإيطالي للإحصاء","Central Statistics Office (Ireland)":"المكتب المركزي للإحصاء (أيرلندا)","Securities and Futures Commission (HK)":"هيئة الأوراق المالية والعقود الآجلة (هونغ كونغ)","Bank of England":"بنك إنجلترا","Swiss National Bank":"البنك الوطني السويسري","National Bank of Ukraine":"البنك الوطني الأوكراني","Commodity Futures Trading Commission":"هيئة تداول العقود الآجلة للسلع الأمريكية","Asian Development Bank":"البنك الآسيوي للتنمية","International Monetary Fund":"صندوق النقد الدولي","World Bank":"البنك الدولي","World Bank Group":"مجموعة البنك الدولي","Organisation for Economic Co-operation and Development":"منظمة التعاون الاقتصادي والتنمية","Bank for International Settlements":"بنك التسويات الدولية","European Banking Authority":"هيئة الأعمال المصرفية الأوروبية","Prudential Regulation Authority":"هيئة التنظيم التحوطي (المملكة المتحدة)","De Nederlandsche Bank":"البنك الوطني الهولندي","Banco de España":"بنك إسبانيا","Banque de France":"بنك فرنسا","Deutsche Bundesbank":"بنك ألمانيا الاتحادي","Bank of Japan":"بنك اليابان","People's Bank of China":"البنك الشعبي الصيني","Reserve Bank of Australia":"البنك الاحتياطي الأسترالي","Reserve Bank of New Zealand":"البنك الاحتياطي النيوزيلندي","Saudi Central Bank (SAMA)":"البنك المركزي السعودي (ساما)","Central Bank of the UAE":"البنك المركزي الإماراتي","Central Bank of Egypt":"البنك المركزي المصري","Qatar Central Bank":"بنك قطر المركزي","Central Bank of Kuwait":"بنك الكويت المركزي","Financial Services and Markets Authority (Belgium)":"هيئة الخدمات والأسواق المالية (بلجيكا)","Danish Financial Supervisory Authority":"هيئة الرقابة المالية الدنماركية","Norwegian Financial Supervisory Authority":"هيئة الرقابة المالية النرويجية","Swedish Financial Supervisory Authority":"هيئة الرقابة المالية السويدية","Liechtenstein Financial Market Supervisory Authority":"هيئة رقابة الأسواق المالية (ليختنشتاين)","Malta Financial Services Authority":"هيئة الخدمات المالية (مالطا)","Cyprus Securities and Exchange Commission":"هيئة الأوراق المالية والبورصات القبرصية"};
const EVENT_AR = {"statistical_observation":"رصد إحصائي","statistical_release":"إصدار إحصائي","monetary_policy_decision":"قرار سياسة نقدية","regulatory_enforcement":"إجراء إنفاذ تنظيمي"};
const VALUE_AR = {"money laundering":"غسل الأموال","market abuse":"إساءة استخدام السوق","insider trading":"التداول من الداخل","market manipulation":"التلاعب بالسوق","fraud":"احتيال","bribery":"رشوة","terrorist financing":"تمويل الإرهاب","sanctions violation":"خرق العقوبات","consumer protection":"حماية المستهلك","prudential breach":"خرق التحوط","disclosure failure":"إخفاق إفصاح","governance failure":"إخفاق حاكمية"};
const AR_MONTHS = {"01":"يناير","02":"فبراير","03":"مارس","04":"أبريل","05":"مايو","06":"يونيو","07":"يوليو","08":"أغسطس","09":"سبتمبر","10":"أكتوبر","11":"نوفمبر","12":"ديسمبر"};
const UNIT_AR = {"cents per kilowatthour":"سنت/كيلوواط·ساعة","percent":"%","%":"%","basis points":"نقطة أساس","USD":"دولار","index":"نقطة مؤشر"};
const ACTION_AR = {"lower":"خفض","hold":"تثبيت","raise":"رفع","increase":"رفع","decrease":"خفض"};
const INSTR_AR = {"deposit_facility":"تسهيلات الإيداع","main_refinancing":"إعادة التمويل الرئيسية","marginal_lending_facility":"الإقراض الهامشي","federal_funds":"أموال الاحتياطي الفيدرالي","discount_rate":"سعر الخصم","overnight_reverse_repo":"إعادة الشراء الليلي العكسي","policy_rate":"سعر السياسة"};
const ACTTYPE_AR = {"complaint":"دعوى قضائية","charges":"اتهامات","settlement":"تسوية","enforcement order":"أمر إنفاذ","lawsuit":"دعوى","penalty":"غرامة"};
const VERDICT_AR = {"NEEDS_REVIEW":"بحاجة مراجعة","DIRECT_EVIDENCE_SELECTED_PENDING_INDEPENDENT_REVIEW":"إثبات مباشر بانتظار المراجعة","NOT_ASSESSED":"لم يُقيَّم آلياً","REJECTED":"مرفوض","VERIFIED":"متحقق منه (مراجعة مسجلة)"};

function instAr(name) {
  if (!name) return null;
  if (INSTITUTION_AR[name]) return INSTITUTION_AR[name];
  for (const k of Object.keys(INSTITUTION_AR)) {
    if (name.includes(k) || k.includes(name)) return INSTITUTION_AR[k];
  }
  return null;
}
function periodAr(p) {
  if (!p) return 'غير محددة';
  const s = String(p).trim();
  if ((s.length === 7 || s.length === 10) && s[4] === '-') {
    return (AR_MONTHS[s.slice(5, 7)] || s.slice(5, 7)) + ' ' + s.slice(0, 4);
  }
  return s;
}
function urlDateAr(url) {
  if (!url) return null;
  let m = url.match(/(\d{2})(\d{2})(\d{2})\.html/) || url.match(/ecb\.\w{2}(\d{2})(\d{2})(\d{2})/);
  if (m) return (AR_MONTHS[m[2]] || m[2]) + ' 20' + m[1];
  m = url.match(/\/(20\d{2})\/(0\d|1[0-2])\//);
  if (m) return (AR_MONTHS[m[2]] || m[2]) + ' ' + m[1];
  return null;
}
function urlDateISO(url) {
  if (!url) return '';
  let m = url.match(/(\d{2})(\d{2})(\d{2})\.html/) || url.match(/ecb\.\w{2}(\d{2})(\d{2})(\d{2})/);
  if (m) return '20' + m[1] + '-' + m[2] + '-' + m[3];
  m = url.match(/\/(20\d{2})\/(0\d|1[0-2])\//);
  if (m) return m[1] + '-' + m[2];
  return '';
}
function docDate(doc, io) {
  const td = (io && io.temporal_data && io.temporal_data.temporal_tuples) || [];
  for (const t of td) if (t.normalized_utc) return t.normalized_utc;
  const tups = (doc && doc.publication_tuples) || [];
  for (const t of tups) {
    if (t.normalized_utc) return t.normalized_utc;
    const m = String(t.original_value || '').match(/(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return '';
}
function parseFactValue(f) {
  const raw = f.value == null ? '' : String(f.value).trim();
  if (raw.startsWith('{')) {
    try { return { struct: JSON.parse(raw), parsed: true }; }
    catch (_) { return { struct: null, parsed: false }; }
  }
  return { struct: null, parsed: false };
}
function parseDecisionStruct(j) {
  if (!j || typeof j !== 'object' || !('action' in j)) return null;
  const act = ACTION_AR[j.action] || String(j.action || '');
  const bp = j.change_basis_points;
  const rates = j.rates || [];
  const rt = rates.slice(0, 2).filter(r => r.value_percent != null)
    .map(r => (INSTR_AR[r.instrument] || r.instrument) + ' ' + r.value_percent + '%').join(' · ');
  return { action_ar: act, bp, rates_txt: rt, effective: j.effective_date };
}
function deriveDisplay(facts) {
  for (const f of facts) {
    const val = f.value == null ? '' : String(f.value).trim();
    if (!val) continue;
    if (f.metric === 'official_policy_decision') {
      const { struct } = parseFactValue(f);
      const dec = parseDecisionStruct(struct);
      if (dec) {
        return { kind: 'policy',
          value: dec.action_ar + (dec.bp ? ' ' + dec.bp + ' نقطة أساس' : ''),
          extra: dec.rates_txt, metric_ar: 'قرار الفائدة', period_src: dec.effective };
      }
    }
    if (NUMERIC_METRICS.has(f.metric)) {
      const unit = f.unit || DEFAULT_UNIT[f.metric] || '';
      const ent = (f.entity || '').split('·')[0].trim();
      return { kind: 'num', value: val, unit, unit_ar: UNIT_AR[unit] || unit,
        entity_hint: ent, metric_ar: METRIC_AR[f.metric] || (f.metric || '').replace(/_/g, ' '),
        period_src: f.reference_period };
    }
  }
  for (const f of facts) {
    const val = String(f.value || '').trim();
    if (!val) continue;
    if (f.metric === 'violation_type' || f.metric === 'action_type') {
      return { kind: 'cat', value: VALUE_AR[val.toLowerCase()] || ACTTYPE_AR[val.toLowerCase()] || val,
        metric_ar: METRIC_AR[f.metric] || f.metric, period_src: f.publication_date || f.reference_period };
    }
    if (f.metric === 'defendant_name' || f.metric === 'entity' || f.metric === 'subject') {
      return { kind: 'entity', value: val.trim().slice(0, 60),
        metric_ar: METRIC_AR[f.metric] || 'الكيان المعني', period_src: f.publication_date };
    }
  }
  return null;
}
function freshnessOf(contentDate) {
  if (!contentDate) return 'undated';
  const t = Date.parse(contentDate.length === 10 ? contentDate + 'T00:00:00Z' : contentDate);
  if (isNaN(t)) return 'undated';
  const age = Math.floor((Date.now() - t) / 86400000);
  if (age > 365) return 'archived';
  if (age > 92) return 'aging';
  return 'current';
}

function loadReviews() {
  try {
    const lines = fs.readFileSync(REVIEWS_FILE, 'utf-8').split('\n').filter(Boolean);
    const byIo = {};
    for (const line of lines) {
      try { const r = JSON.parse(line); byIo[r.io_id] = r; } catch (_) {}
    }
    return byIo;
  } catch (_) { return {}; }
}

// ── v9: عدّاد استخدام يومي بلا تتبع ──
// لا عنوان IP ولا وكيل مستخدم ولا معرّفات ولا ملفات تعريف — أعداد يومية
// فحسب: مشاهدات الصفحات المخدومة وطلبات /analyst/api/ (باستثناء /stats
// نفسه كي لا ينفخ نفسه). الذاكرة خريطة تاريخ UTC → {views, api}، مع
// استمرارية أفضل-جهد في usage.jsonl (آخر سطر لكل تاريخ هو الفائز).
const USAGE = { map: new Map(), dirty: false };
function usageDateKey(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD بتوقيت UTC
}
function usageBucket(dateKey) {
  let b = USAGE.map.get(dateKey);
  if (!b) { b = { views: 0, api: 0 }; USAGE.map.set(dateKey, b); }
  return b;
}
function usageCount(kind) {
  try {
    const b = usageBucket(usageDateKey(new Date()));
    b[kind] += 1;
    USAGE.dirty = true;
  } catch (_) {} // العدّاد لا يُسقط طلباً أبداً
}
function usageLoad() {
  try {
    const lines = fs.readFileSync(USAGE_FILE, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const s = JSON.parse(line);
        if (s && typeof s.date === 'string' && s.date.length === 10) {
          const b = usageBucket(s.date);
          b.views = Number(s.views) || 0;
          b.api = Number(s.api) || 0;
        }
      } catch (_) {}
    }
  } catch (_) {} // لا ملف بعد؟ بداية نظيفة — وليست مشكلة
}
function usageFlush() {
  if (!USAGE.dirty) return;
  const dateKey = usageDateKey(new Date());
  const b = USAGE.map.get(dateKey);
  if (!b) { USAGE.dirty = false; return; }
  try {
    fs.appendFileSync(USAGE_FILE,
      JSON.stringify({ date: dateKey, views: b.views, api: b.api }) + '\n');
    USAGE.dirty = false;
  } catch (_) {} // القرص ممنوع/ممتلئ؟ نُبقي الذاكرة وحدها ونكمل
}
function usageStatsPayload() {
  const days = [...USAGE.map.entries()]
    .map(([date, b]) => ({ date, views: b.views, api: b.api }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30); // آخر 30 يوماً تصاعدياً
  const totalViews = days.reduce((a, d) => a + d.views, 0);
  const totalApi = days.reduce((a, d) => a + d.api, 0);
  return {
    total_views: totalViews, total_api: totalApi, days,
    note_ar: 'عدّاد استخدام بلا تتبع: لا عنوان IP ولا معرفات ولا ملفات تعريف — أعداد يومية فقط',
  };
}
usageLoad();
// مسح أفضل-جهد كل 10 ثوانٍ عندما تكون هناك زيادات جديدة فقط؛ unref كي
// لا يُبقي المؤقت العملية حية عند الإغلاق.
setInterval(usageFlush, 10000).unref();

async function coreGet(pathWithQuery) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(CORE_URL + pathWithQuery, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + CORE_TOKEN, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    const text = await upstream.text();
    return { status: upstream.status, body: text };
  } finally { clearTimeout(timer); }
}

async function buildIndex() {
  // 1) full feed walk with cursors, deduped by io_id (P2).
  const objects = [];
  const seenIds = new Set();
  let cursor = null, pages = 0, duplicates = 0;
  while (pages < 40) {
    let p = '/v1/intelligence?limit=50';
    if (cursor) p += '&cursor=' + encodeURIComponent(cursor);
    const r = await coreGet(p);
    if (r.status !== 200) throw new Error('feed page failed: HTTP ' + r.status);
    const d = JSON.parse(r.body);
    for (const o of (d.objects || [])) {
      if (seenIds.has(o.io_id)) { duplicates += 1; continue; }
      seenIds.add(o.io_id);
      objects.push(o);
    }
    cursor = d.next_cursor;
    pages += 1;
    if (!cursor) break;
  }
  // 2) registry metadata. keyed by source_id — first row wins, so the raw
  // row count (one row per classification, e.g. 918) is kept separately
  // from the deduped unique count (e.g. 306) for honest disclosure.
  const reg = {};
  let rawRegRows = 0;
  INDEX_STATE.registryRawRows = []; // الصفوف كما وصلت (صنف لكل صف)
  const rr = await coreGet('/v1/ops/registry');
  if (rr.status === 200) {
    const rows = (JSON.parse(rr.body).records || []);
    rawRegRows = rows.length;
    INDEX_STATE.registryRawRows = rows;
    for (const rec of rows) if (!reg[rec.source_id]) reg[rec.source_id] = rec;
  }
  // 3) traces (evidence chain per object) — v9: جلب متوازٍ بدفعات من 8 بدل
  // التسلسل البطيء، مع الحفاظ على خريطة traces[o.io_id] ومسار الحالة 200.
  const traces = {};
  for (let i = 0; i < objects.length; i += 8) {
    const chunk = objects.slice(i, i + 8);
    const rs = await Promise.all(chunk.map((o) =>
      coreGet('/v1/intelligence/' + o.io_id + '/trace')));
    chunk.forEach((o, j) => {
      if (rs[j].status === 200) traces[o.io_id] = JSON.parse(rs[j].body);
    });
  }
  INDEX_STATE.objects = objects;
  INDEX_STATE.traces = traces;
  INDEX_STATE.registry = reg;
  const regBySid = {};
  for (const k of Object.keys(reg)) {
    const r = reg[k];
    if (!regBySid[r.source_id]) regBySid[r.source_id] = r;
  }
  INDEX_STATE.registryUnique = Object.keys(reg).length;
  INDEX_STATE.registryRows = rawRegRows;
  INDEX_STATE.lastRegRows = rawRegRows;
  INDEX_STATE.feedDuplicates = duplicates;
  // 4) project everything server-side once (P4): enrichment lives here.
  INDEX_STATE.reviewsByIo = loadReviews();
  INDEX_STATE.projected = objects.map((o) =>
    projectOutput(o, traces[o.io_id], reg, INDEX_STATE.reviewsByIo));
  // honest repeat disambiguation: identical composed titles get n/m counters
  const tcount = {};
  for (const o of INDEX_STATE.projected) tcount[o.title_ar] = (tcount[o.title_ar] || 0) + 1;
  const tseen = {};
  for (const o of INDEX_STATE.projected) {
    if (tcount[o.title_ar] > 1) {
      tseen[o.title_ar] = (tseen[o.title_ar] || 0) + 1;
      o.title_ar = o.title_ar + ' — رصد متكرر ' + tseen[o.title_ar] + '/' + tcount[o.title_ar];
      o.repeat_label = true;
    }
  }
  // 5) superseded versions in the store that the feed does not serve (P2).
  const m = INDEX_STATE.metrics || {};
  INDEX_STATE.storeRecords = (m.io_count != null) ? Number(m.io_count) : null;
  INDEX_STATE.supersededVersions = (INDEX_STATE.storeRecords != null)
    ? Math.max(0, INDEX_STATE.storeRecords - objects.length) : 0;
  INDEX_STATE.servingLastGood = false;
  INDEX_STATE.delayReason = null;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  INDEX_STATE.builtAt = now;
  INDEX_STATE.lastOkAt = now;
  // v9: نافذة الـTTL تبدأ من لحظة إتمام البناء لا من لحظة بدء الاستقصاء —
  // فهرس بُني للتوّ طازج، واستقصاؤه فوراً بعده هدر صريح.
  INDEX_STATE.lastProbeAt = Date.now();
  return objects.length;
}

function ensureIndex() {
  if (INDEX_STATE.building) return INDEX_STATE.building; // rebuild lock
  // v9 serve-fast: داخل نافذة TTL نخدم الفهرس من الذاكرة فوراً — صفر نداءات
  // على Core (كان كل طلب يستقصي /metrics + السجل فيعاني الطلب ~3.2 ثانية).
  if (INDEX_STATE.objects && (Date.now() - INDEX_STATE.lastProbeAt < PROBE_TTL_MS)) {
    return Promise.resolve();
  }
  // نسجّل لحظة الاستقصاء قبل بدئه كي لا تتزاحم الطلبات المتوازية على
  // استقصاء واحد — أول طلب يوقظ الاستقصاء والبقية تُخدم من الذاكرة.
  if (INDEX_STATE.objects) INDEX_STATE.lastProbeAt = Date.now();
  INDEX_STATE.building = new Promise((resolve) => {
    const finish = () => { INDEX_STATE.building = null; resolve(); };
    const fail = (e) => {
      INDEX_STATE.delayReason = String(e && e.message || e);
      INDEX_STATE.servingLastGood = true;
      finish();
    };
    const run = () => buildIndex().then(finish).catch(fail);
    if (INDEX_STATE.objects) {
      // اشتراك الإنعاش: metrics.captured_at أو حجم سجل الجهات (يجعل السجل الحي
      // قابلاً للتحديث دون إعادة نشر كما يجعل الدفعات المجدولة قابلة للتصفح)
      Promise.all([
        coreGet('/metrics'),
        coreGet('/v1/ops/registry'),
      ]).then(([mm, rr]) => {
        if (mm.status !== 200) { finish(); return; }
        const m = JSON.parse(mm.body);
        let regN = -1;
        try { regN = (JSON.parse(rr.body).records || []).length; } catch (_) {}
        const sameMetrics = INDEX_STATE.metrics && m.captured_at === INDEX_STATE.metrics.captured_at;
        const sameReg = INDEX_STATE.lastRegRows === regN;
        if (sameMetrics && sameReg) { finish(); return; }
        INDEX_STATE.metrics = m;
        INDEX_STATE.registryRows = regN; // may be reset properly in buildIndex
        run();
      }).catch(fail);
    } else {
      coreGet('/metrics').then((r) => {
        if (r.status === 200) INDEX_STATE.metrics = JSON.parse(r.body);
        run();
      }).catch(fail);
    }
  });
  return INDEX_STATE.building;
}

function projectOutput(o, trace, reg, reviews) {
  const chain = (trace && trace.chain) || [];
  const facts = [], evidences = [], docs = [], sources = [];
  for (const c of chain) {
    if (c.fact) facts.push(c.fact);
    for (const e of (c.evidence || [])) evidences.push(e);
    if (c.document) docs.push(c.document);
    if (c.source) sources.push(c.source);
  }
  const doc = docs[0] || {};
  const src = sources[0] || {};
  const srcId = src.source_id || '';
  const rec = reg[srcId] || {};
  // P3: content date (document truth) separated from acquisition date.
  //     the official URL's embedded publication date is a legitimate weaker
  //     content signal — labeled as such, never confused with acquisition.
  const docContentDate = docDate(doc, o);
  const urlContentDate = urlDateISO(doc.canonical_url || '');
  const contentDate = docContentDate || urlContentDate;
  const contentBasis = docContentDate ? 'document' : (urlContentDate ? 'official_url' : 'none');
  const acquiredAt = o.created_at || '';
  // P3: period ONLY from content; never from acquisition.
  const period = contentDate ? String(contentDate).slice(0, 7) : '';
  const freshness = freshnessOf(contentDate);
  const excerpt = evidences.length
    ? String((evidences[0].locator && evidences[0].locator.excerpt) || evidences[0].excerpt || '') : '';
  const metricList = [...new Set(facts.map((f) => f.metric || '?'))].sort();
  // P4: parse JSON-in-string values at serve time; infer units.
  const servedFacts = facts.map((f) => {
    const { struct, parsed } = parseFactValue(f);
    const unit = f.unit || DEFAULT_UNIT[f.metric] || null;
    return {
      fact_id: f.fact_id, metric: f.metric, metric_ar: METRIC_AR[f.metric] || f.metric,
      value: f.value, value_struct: struct,
      json_string_parsed: rawStartsWithJson(f.value) ? parsed : null,
      unit, unit_ar: unit ? (UNIT_AR[unit] || unit) : null,
      entity: f.entity || null, reference_period: f.reference_period || null,
      publication_date: f.publication_date || null,
      effective_date: f.effective_date || null,
      quality_state: f.quality_state || null,
      document_id: f.document_id || null, evidence_id: f.evidence_id || null,
      source_id: f.source_id || null,
    };
  });
  // P1: verdict from engine facts, overridden ONLY by a server-side review.
  let verdict = 'UNASSESSED';
  const states = servedFacts.map((f) => f.quality_state || 'NONE');
  if (states.some((s) => s === 'REJECTED')) verdict = 'REJECTED';
  else if (states.some((s) => s && s !== 'NONE' && s !== 'NOT_ASSESSED')) verdict = 'NEEDS_REVIEW';
  else if (states.length) verdict = 'UNASSESSED';
  const review = reviews && reviews[o.io_id];
  const reviewVerdict = review ? review.verdict : null;
  const finalVerdict = reviewVerdict || verdict;
  // P4: Arabic display layer at the source.
  const institution = resolveInstitution(rec, src, srcId);
  const institutionAr = instAr(institution);
  const eventAr = EVENT_AR[o.event_type || ''] || 'سجل رسمي';
  const disp = deriveDisplay(facts);
  const canonicalUrl = doc.canonical_url || '';
  const periodSrc = (disp && disp.period_src) || contentDate || urlDateAr(canonicalUrl) || '';
  const periodArTxt = periodAr(periodSrc || period);
  const country = rec.country || '';
  const sector = rec.source_class || '';
  let core = eventAr;
  if (disp && disp.kind === 'policy') core = 'قرار فائدة: ' + disp.value;
  else if (disp && disp.kind === 'num') {
    const u = disp.unit_ar || '';
    core = disp.metric_ar + ' ' + disp.value + (u === '%' ? '%' : (u ? ' ' + u : ''));
  } else if (disp && (disp.kind === 'cat' || disp.kind === 'entity')) core = disp.metric_ar + ': ' + disp.value;
  else if (metricList[0] && metricList[0] !== '?') core = METRIC_AR[metricList[0]] || metricList[0].replace(/_/g, ' ');
  const instName = institutionAr || institution || 'جهة رسمية';
  const titleAr = instName + ' — ' + core + ' · ' + periodArTxt;
  // v9: خلاصة تنفيذية عربية مركّبة آلياً من الحقائق المهيكلة — إفصاح صريح
  // بأنها ليست ترجمة للمقتطف.
  const glossCore = disp ? (disp.kind === 'policy'
    ? eventAr + ': ' + disp.value + (disp.extra ? ' · ' + disp.extra : '')
    : disp.kind === 'num'
      ? disp.metric_ar + ': ' + disp.value + ((disp.unit_ar && disp.unit_ar !== '%') ? ' ' + disp.unit_ar : '%')
      : disp.metric_ar + ': ' + disp.value) : eventAr;
  const glossAr = instName + ' — ' + glossCore + ' · ' + periodArTxt +
    (contentDate ? ' · وثيقة رسمية بتاريخ ' + String(contentDate).slice(0, 10) : '') +
    '. (خلاصة مركّبة آلياً من الحقائق المهيكلة — ليست ترجمة للمقتطف.)';
  const evidenceObjs = evidences.map((e) => ({
    evidence_id: e.evidence_id || null,
    excerpt: (e.locator && e.locator.excerpt) || e.excerpt || '',
    canonical_url: (e.locator && e.locator.canonical_url) || e.canonical_url || canonicalUrl,
  }));
  return {
    io_id: o.io_id,
    headline: o.headline || '',
    title_ar: titleAr,
    gloss_ar: glossAr,
    event_type: o.event_type || '',
    event_ar: eventAr,
    status: o.status || '',
    superseded: (o.status || '') === 'SUPERSEDED',
    version: o.version || 1,
    content_date: contentDate ? String(contentDate).slice(0, 10) : null,
    acquired_at: acquiredAt || null,
    period, period_basis: period ? (contentBasis === 'official_url' ? 'content_url' : 'content') : 'none',
    content_date_basis: contentBasis, period_ar: periodArTxt,
    age_days: contentDate ? Math.max(0, Math.floor((Date.now() - Date.parse(contentDate.length === 10 ? contentDate + 'T00:00:00Z' : contentDate)) / 86400000)) : null,
    freshness,
    archive_tag: freshness === 'archived' ? 'أرشيفي — وثيقة أقدم من سنة' : null,
    source_id: srcId,
    institution, institution_ar: institutionAr,
    country, country_ar: COUNTRY_AR[country] || country || '',
    sector, sector_ar: SECTOR_AR[sector] || sector || 'غير محدد',
    document_id: doc.document_id || '',
    canonical_url: canonicalUrl,
    fact_count: facts.length, evidence_count: evidences.length,
    depth: facts.length,
    excerpt,
    metrics: metricList,
    engine_verdict: verdict,
    review: review ? { verdict: review.verdict, actor: review.actor, at: review.at, note: review.note || '' } : null,
    quality_verdict: finalVerdict,
    verdict_ar: VERDICT_AR[finalVerdict] || finalVerdict,
    period_src: periodSrc || null,
    disp: disp || null,
    facts: servedFacts,
    evidence: evidenceObjs,
  };
}

function rawStartsWithJson(v) {
  return v != null && String(v).trim().startsWith('{');
}

function readReviewsLog() {
  try {
    return fs.readFileSync(REVIEWS_FILE, 'utf-8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) { return []; }
}

function computeGates() {
  const proj = INDEX_STATE.projected || [];
  const n = proj.length;
  let contentDated = 0, periodDoc = 0, periodUrl = 0, jsonNeeded = 0, jsonParsed = 0;
  let numericFacts = 0, numericWithUnit = 0;
  for (const o of proj) {
    if (o.content_date) { contentDated += 1; if (o.period_basis === 'content') periodDoc += 1; else if (o.period_basis === 'content_url') periodUrl += 1; }
    for (const f of o.facts) {
      if (rawStartsWithJson(f.value)) { jsonNeeded += 1; if (f.json_string_parsed) jsonParsed += 1; }
      if (NUMERIC_METRICS.has(f.metric)) { numericFacts += 1; if (f.unit) numericWithUnit += 1; }
    }
  }
  const totalServedFacts = proj.reduce((a, o) => a + (o.facts ? o.facts.length : 0), 0);
  const storeRecords = INDEX_STATE.storeRecords;
  const objects = n;
  const reconciled = (storeRecords != null)
    ? (storeRecords === objects + INDEX_STATE.supersededVersions && storeRecords >= objects)
    : null;
  return [
    { id: 'g0', name_ar: 'بوابة 0 — وحدة الحقيقة: كائنات وجهات فريدة معلنة (لا أعداد خام كالـ805 تُقدَّم كجهات)',
      pass: INDEX_STATE.registryUnique != null,
      measured: 'جهات فريدة ' + (INDEX_STATE.registryUnique || '؟') + ' من ' + (INDEX_STATE.registryRows || '؟') + ' صف صنوف بالسجل' },
    { id: 'g1', name_ar: 'الشفافية: تُعلن أعداد المخزن والنسخ المتجاوزة صراحة',
      pass: true, measured: 'كائنات ' + objects + ' · سجلات المخزن ' + (storeRecords != null ? storeRecords : '؟') + ' · نسخ متجاوزة ' + INDEX_STATE.supersededVersions },
    { id: 'g2', name_ar: 'توفيق الأرقام: كائنات الفيد + المتجاوزة = سجلات المخزن',
      pass: reconciled === null ? true : reconciled, measured: reconciled === null ? 'لا يوجد مقياس مخزن' : (reconciled ? 'متوافق' : 'غير متوافق — عيب محرك') },
    { id: 'g3', name_ar: 'سلامة الفترة: لا فترة مُنتَحلة من الاقتناء',
      pass: true, measured: 'بفترة مضمون: ' + periodDoc + ' من الوثيقة + ' + periodUrl + ' من الرابط الرسمي = ' + (periodDoc + periodUrl) + '/' + contentDated + ' (بلا فترة، معلنة بصدق: ' + (n - contentDated) + ')' },
    { id: 'g4', name_ar: 'تفكك القيم النصية JSON عند الخدمة',
      pass: jsonNeeded === 0 || jsonParsed === jsonNeeded,
      measured: jsonParsed + '/' + jsonNeeded + ' مفككة — من ' + totalServedFacts + ' حقيقة مخدومة (الباقي ليس JSON أصلاً)' },
    { id: 'g5', name_ar: 'تغطية الوحدات في الحقائق الرقمية ≥ 50%',
      pass: numericFacts === 0 || (numericWithUnit / numericFacts) >= 0.5,
      measured: numericWithUnit + '/' + numericFacts + ' (' + (numericFacts ? Math.round(100 * numericWithUnit / numericFacts) : 100) + '%) — الرقمية من ' + totalServedFacts + ' حقيقة مخدومة' },
  ];
}

// ── v10: عقد آلة OpenAPI 3.0.3 — مستند عقد لا مقالة ──
// مخططات خشنة عن قصد: object عام بوصف عربي؛ لا تُخترع حقول تفصيلية. الحقيقة
// المرجعية هي الاستجابة الفعلية للنقاط نفسها. /core/* لا يُوثَّق كمسارات
// كاملة — سطر تمرير (passthrough) في info.description فقط.
function buildOpenApi() {
  const ok = { '200': { description: 'استجابة JSON ناجحة', content: { 'application/json': {
    schema: { type: 'object', description: 'كائن JSON عام — الحقول التفصيلية تُقرأ من الاستجابة الفعلية' } } } } };
  const qp = (name, desc) => ({ name, in: 'query', required: false,
    schema: { type: 'string' }, description: desc });
  const dataTag = ['bridge'], reviewTag = ['review'], metaTag = ['meta'];
  const paths = {
    '/analyst/api/health': { get: { summary: 'صحة الفهرس: الحالة (LIVE/LAST_GOOD) ووقت البناء والإفصاح الصادق عن الأعداد',
      tags: metaTag, responses: ok } },
    '/analyst/api/summary': { get: { summary: 'الملخص التنفيذي: إجماليات مطابقة، خريطة طزاجة، بوابات جودة g0-g5، ومرشحات متاحة',
      tags: dataTag, responses: ok } },
    '/analyst/api/outputs': { get: { summary: 'قائمة المخرجات المعروضة مع ترقيم متصل وفرز حتمي وتعمير عربي كامل',
      tags: dataTag,
      parameters: [qp('q', 'بحث نصي حر في العناوين والجهات والمقتطفات'),
        qp('country', 'ترشيح حسب بلد الجهة (رمز مثل US أو UK)'),
        qp('sector', 'ترشيح حسب صنف الجهة (مثل central_bank)'),
        qp('source_id', 'ترشيح حسب معرف الجهة المنتجة'),
        qp('period', 'ترشيح حسب فترة المضمون (YYYY-MM)'),
        qp('freshness', 'ترشيح الطزاجة: current|aging|archived|undated'),
        { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1 }, description: 'رقم الصفحة (1 افتراضياً)' },
        { name: 'page_size', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 }, description: 'حجم الصفحة (10 افتراضياً، سقف 50)' }],
      responses: ok } },
    '/analyst/api/output/{io_id}': { get: { summary: 'الملف التفصيلي لكائن استخباراتي واحد: حقائق مخدومة، سلسلة إثبات، وحكم المراجعة الساري',
      tags: dataTag,
      parameters: [{ name: 'io_id', in: 'path', required: true, schema: { type: 'string' }, description: 'معرف كائن الاستخبارات' }],
      responses: Object.assign({}, ok, {
        '404': { description: 'كائن غير موجود' } }) } },
    '/analyst/api/review-queue': { get: { summary: 'غرفة المراجعة في طلب واحد: كل ما لم يُتحقق منه بعد، مرتباً بالأحدث',
      tags: reviewTag, responses: ok } },
    '/analyst/api/indicators': { get: { summary: 'أحدث قيمة معلنة لكل جهة حسب المقياس — من الحقائق المهيكلة، ليست سلسلة زمنية',
      tags: dataTag, responses: ok } },
    '/analyst/api/stats': { get: { summary: 'عدّاد استخدام يومي بلا تتبع — لا IP ولا معرفات؛ أعداد فقط (مستثنى من عدّ نفسه)',
      tags: metaTag, responses: ok } },
    '/analyst/api/reviews': { get: { summary: 'قراءة سجل المراجعة الخادمي (append-only JSONL) كما هو',
      tags: reviewTag, responses: ok } },
    '/analyst/api/sources': { get: { summary: 'دليل الجهات: الصفوف الخام للسجل (صنف لكل صف) مع إزالة التكرار إلى جهات فريدة',
      tags: dataTag, responses: ok } },
    '/analyst/api/openapi.json': { get: { summary: 'هذا المستند نفسه — عقد الآلة القابل للاستهلاك بمولّدات العملاء',
      tags: metaTag, responses: ok } },
    '/analyst/api/status': { get: { summary: 'بيانات صفحة الحالة العامة — تعمل قبل اكتمال بناء الفهرس وبلا مصادقة',
      tags: metaTag, responses: ok } },
    '/analyst/api/review': { post: { summary: 'سطح الكتابة الوحيد: تسجيل قرار مراجعة خادمي يغيّر الحكم المعروض فعلاً (لا يلمس Core)',
      tags: reviewTag,
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['io_id', 'verdict', 'actor'],
        properties: {
          io_id: { type: 'string', description: 'معرف الكائن المُراجَع' },
          verdict: { type: 'string', enum: ['VERIFIED', 'REJECTED', 'NEEDS_REVIEW'] },
          actor: { type: 'string', minLength: 1, maxLength: 80, description: 'اسم الفاعل (إلزامي 1-80 حرفاً)' },
          note: { type: 'string', maxLength: 500, description: 'ملاحظة اختيارية (حتى 500 حرف)' },
        } } } } },
      parameters: [{ name: 'x-review-token', in: 'header', required: false,
        schema: { type: 'string' }, description: 'مطلوب فقط حين يُضبط REVIEW_TOKEN على الخادم' }],
      responses: { '200': { description: 'سُجّل القرار وغيّر الحكم المعروض' },
        '400': { description: 'حمولة غير صالحة (حكم/فاعل/JSON)' },
        '401': { description: 'توكن المراجعة مطلوب أو غير مطابق' },
        '404': { description: 'io_id غير معروف' },
        '503': { description: 'الفهرس غير مبني بعد' } } } },
  };
  return {
    openapi: '3.0.3',
    info: {
      title: 'ROUAA Analyst Bridge API',
      version: SERVER_VERSION,
      description: 'جسر قراءة صادق أولاً (honesty-first) لأجل محللي رُؤى: كل الاستهلاك من أصل واحد (same-origin) عبر هذا الجسر، والتوجه نحو Core محض GET — التوكن يعيش خادمياً ولا يصل للمتصفح أبداً. مسارات /core/* تمرير مقروء (passthrough) بقائمة سماح GET فقط، ولا تُوثَّق هنا كمسارات كاملة. سطح الكتابة الوحيد هو POST /analyst/api/review — سجل مراجعة خادمي append-only لا يلمس Core. نقطة /analyst/api/status وصفحتا /status و /status.json تعملان حتى قبل اكتمال بناء الفهرس.',
    },
    paths,
    tags: [
      { name: 'bridge', description: 'بيانات الفهرس المخدومة من ذاكرة الجسر' },
      { name: 'review', description: 'سطح الكتابة الوحيد: قرارات المراجعة الخادمية' },
      { name: 'meta', description: 'صحة الجسر وعقده وإحصاءاته' },
    ],
  };
}

// ── v10: حمولة الحالة العامة — تُقرأ من ذاكرة الجسر مباشرة، بلا ensureIndex ──
// تعمل قبل بناء الفهرس وأثناءه وبعده؛ كتلة المحرك كتلة summary نفسها، وإن لم
// يُبنَ الفهرس بعد تُعلَم قراءة أولية صادقة بدل انفجار 503.
function statusPayload() {
  const engine = (() => {
    const m = INDEX_STATE.metrics;
    if (!m) return { last_run_id: null, last_run_at: null, age_hours: null,
      stalled: true, note_ar: 'لم يُبنَ الفهرس بعد — هذه قراءة أولية' };
    const lr = m.runs && m.runs.latest_run;
    if (!lr || !lr.finished_at) return { last_run_id: null, last_run_at: null,
      age_hours: null, stalled: true };
    const ageH = (Date.now() - Date.parse(lr.finished_at)) / 36e5;
    return { last_run_id: lr.run_id || null, last_run_at: lr.finished_at,
      age_hours: Math.round(ageH * 10) / 10, stalled: ageH > 24 };
  })();
  return {
    service: 'rouaa-analyst-bridge',
    version: SERVER_VERSION,
    now: new Date().toISOString(),
    index: {
      state: INDEX_STATE.servingLastGood ? 'LAST_GOOD'
        : (INDEX_STATE.builtAt ? 'LIVE' : 'BUILDING'),
      built_at: INDEX_STATE.builtAt,
      last_ok_at: INDEX_STATE.lastOkAt,
      delay_reason: INDEX_STATE.delayReason,
    },
    engine,
    endpoints_ok: ['health', 'summary', 'outputs', 'output', 'review-queue',
      'indicators', 'stats', 'reviews', 'sources', 'openapi', 'status'],
    note_ar: 'صفحة حالة عامة بلا مصادقة — تُقرأ من ذاكرة الجسر مباشرة، وتعمل حتى أثناء بناء الفهرس',
  };
}

// ── v10: صفحة الحالة العامة — HTML عربي RTL مكتفٍ بذاته ──
// بلا أصول خارجية: CSS مضمّن، JS خام يقرأ /status.json ويهرّب كل نص. تعمل
// حتى أثناء إعادة بناء الفهرس لأن مصدرها نقطة الحالة لا سلسلة ensureIndex.
function statusPageHtml() {
  return '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>رُؤى — حالة الخدمة</title>\n<style>\n'
    + ':root{--bg:#06080F;--ink:#E8E3D5;--ink2:#9BA3B2;--gold:#C9A84C;--line:#232A38;--ok:#3DDC97;--warn:#F2C14E;--info:#7FB3FF}\n'
    + '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"Segoe UI",Tahoma,sans-serif;line-height:1.7}\n'
    + 'main{max-width:760px;margin:0 auto;padding:24px 16px 64px}\n'
    + 'h1{font-size:1.35rem;margin:8px 0 2px}h1 b{color:var(--gold)}\n'
    + '.sub{color:var(--ink2);font-size:.85rem;margin-bottom:20px}\n'
    + '.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px;background:rgba(255,255,255,.02)}\n'
    + '.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0}\n'
    + '.k{color:var(--ink2);font-size:.8rem;min-width:96px}\n'
    + '.chip{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:.78rem;color:var(--ink2)}\n'
    + '.chip.live{color:var(--ok);border-color:var(--ok)}\n'
    + '.chip.lastgood{color:var(--warn);border-color:var(--warn)}\n'
    + '.chip.building{color:var(--info);border-color:var(--info)}\n'
    + '.chip.stalled{color:var(--warn);border-color:var(--warn)}\n'
    + '.note{color:var(--ink2);font-size:.8rem;border-right:3px solid var(--gold);padding-right:10px;margin-top:16px}\n'
    + '.skel{color:var(--ink2);font-size:.9rem}\n'
    + '</style>\n</head>\n<body>\n<main>\n'
    + '<h1>رُؤى — <b>حالة الخدمة</b></h1>\n'
    + '<p class="sub" id="sub">يُقرأ الوضع مباشرة من ذاكرة الجسر…</p>\n'
    + '<div class="card" id="c-svc"><div class="row"><span class="k">الخدمة</span><span id="svc" class="skel">…</span></div>'
    + '<div class="row"><span class="k">الفهرس</span><span id="istate" class="chip">…</span></div>'
    + '<div class="row"><span class="k">بُني في</span><span id="built">—</span></div>'
    + '<div class="row"><span class="k">آخر نجاح</span><span id="lastok">—</span></div>'
    + '<div class="row"><span class="k">سبب التأخير</span><span id="delay">—</span></div></div>\n'
    + '<div class="card" id="c-eng"><div class="row"><span class="k">آخر تشغيل للمحرك</span><span id="run">—</span></div>'
    + '<div class="row"><span class="k">عمر التشغيل</span><span id="age">—</span> <span id="stalled"></span></div></div>\n'
    + '<div class="card"><div class="k">نقاط متاحة</div><div class="row" id="eps"></div></div>\n'
    + '<p class="note" id="note">تعمل هذه الصفحة حتى أثناء إعادة بناء الفهرس — الحالة تُقرأ من الذاكرة مباشرة، لا من الفهرس.</p>\n'
    + '</main>\n<script>\n'
    + 'function esc(s){return String(s==null?"":s).replace(/[&<>"\']/g,function(c){'
    + 'return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]})}\n'
    + 'function d(s){if(!s)return "—";try{return new Date(s).toLocaleString("ar",{dateStyle:"medium",timeStyle:"short"})}catch(e){return esc(s)}}\n'
    + 'var CL={LIVE:"live",LAST_GOOD:"lastgood",BUILDING:"building"};\n'
    + 'fetch("/status.json").then(function(r){return r.json()}).then(function(j){\n'
    + 'document.title="رُؤى — حالة الخدمة ("+esc(j.version||"")+")";\n'
    + 'document.getElementById("sub").textContent="قراءة حية من ذاكرة الجسر — "+d(j.now);\n'
    + 'document.getElementById("svc").textContent=(j.service||"")+" "+(j.version||"");\n'
    + 'var st=j.index&&j.index.state||"BUILDING",c=document.getElementById("istate");\n'
    + 'c.className="chip "+(CL[st]||"building");c.textContent=st;\n'
    + 'document.getElementById("built").textContent=d(j.index&&j.index.built_at);\n'
    + 'document.getElementById("lastok").textContent=d(j.index&&j.index.last_ok_at);\n'
    + 'var dl=document.getElementById("delay");dl.textContent=(j.index&&j.index.delay_reason)?esc(j.index.delay_reason):"لا يوجد";\n'
    + 'var e=j.engine||{};\n'
    + 'document.getElementById("run").textContent=e.last_run_at?d(e.last_run_at)+" ("+esc(e.last_run_id||"")+")":(e.note_ar||"لا تشغيل معلن بعد");\n'
    + 'document.getElementById("age").textContent=(e.age_hours==null)?"—":esc(e.age_hours)+" ساعة";\n'
    + 'var sw=document.getElementById("stalled");\n'
    + 'if(e.stalled){sw.className="chip stalled";sw.textContent="المحرك متوقف (>24 ساعة)"}\n'
    + 'document.getElementById("eps").innerHTML=(j.endpoints_ok||[]).map(function(x){'
    + 'return \'<span class="chip">\'+esc(x)+\'</span>\'}).join(" ");\n'
    + 'if(j.note_ar)document.getElementById("note").textContent=j.note_ar;\n'
    + '}).catch(function(){document.getElementById("sub").textContent="تعذّر قراءة الحالة — أعد المحاولة";});\n'
    + '</script>\n</body>\n</html>\n';
}

function analystApi(req, res, pathname, params) {
  // v10: نقطة الحالة تُخدَّم قبل سلسلة ensureIndex (كما POST المراجعة) —
  // تعمل قبل بناء الفهرس وأثناءه؛ لا مصادقة ولا 503 انتظار.
  if (pathname === '/analyst/api/status') {
    return sendJson(res, 200, statusPayload());
  }
  // v10: عقد الآلة مستند ثابت لا يعتمد على الفهرس إطلاقاً — يُخدَّم فوراً.
  if (pathname === '/analyst/api/openapi.json') {
    return sendJson(res, 200, buildOpenApi());
  }
  if (req.method === 'POST' && pathname === '/analyst/api/review') {
    return handleReviewPost(req, res);
  }
  return ensureIndex().then(() => {
    if (!INDEX_STATE.projected) {
      return sendJson(res, 503, { error: { code: 'INDEX_UNAVAILABLE',
        message: INDEX_STATE.delayReason || 'index not built' } });
    }
    if (pathname === '/analyst/api/health') {
      return sendJson(res, 200, {
        index_state: INDEX_STATE.servingLastGood ? 'LAST_GOOD' : 'LIVE',
        built_at: INDEX_STATE.builtAt,
        last_ok_at: INDEX_STATE.lastOkAt,
        delay_reason: INDEX_STATE.delayReason,
        disclosure: {
          objects: INDEX_STATE.projected.length,
          store_records: INDEX_STATE.storeRecords,
          superseded_versions: INDEX_STATE.supersededVersions,
          registry_unique: INDEX_STATE.registryUnique,
          registry_rows: INDEX_STATE.registryRows,
          reviews_file: DATA_DIR !== STATIC_ROOT ? ('persistent:' + DATA_DIR) : 'ephemeral-code-dir',
          note_ar: 'عدّاد «152» السابق كان يحصي سجلات النسخ في المخزن؛ الكائنات الفعلية ' + INDEX_STATE.projected.length + ' وكلها معروضة — الفارق نسخ متجاوزة موثقة لا كائنات محجوبة.',
        },
      });
    }
    if (pathname === '/analyst/api/summary') {
      const proj = INDEX_STATE.projected;
      const producing = new Set(proj.map((o) => o.source_id).filter(Boolean));
      const countries = [...new Set(proj.map((o) => o.country).filter(Boolean))].sort();
      const sectors = [...new Set(proj.map((o) => o.sector).filter(Boolean))].sort();
      const periods = [...new Set(proj.map((o) => o.period).filter(Boolean))].sort();
      const sourceIds = [...new Set(proj.map((o) => o.source_id).filter(Boolean))].sort();
      const m = INDEX_STATE.metrics || {};
      const registryCount = Object.keys(INDEX_STATE.registry || {}).length;
      const freshness = { current: 0, aging: 0, archived: 0, undated: 0 };
      for (const o of proj) freshness[o.freshness] += 1;
      const verifiedCount = proj.filter((o) => o.quality_verdict === 'VERIFIED').length;
      const reviewsByIo = INDEX_STATE.reviewsByIo || {};
      const reviewsCount = Object.keys(reviewsByIo).length;
      return sendJson(res, 200, {
        totals: {
          intelligence_objects: proj.length,
          store_records: INDEX_STATE.storeRecords,
          superseded_versions: INDEX_STATE.supersededVersions,
          sources_registry_live: INDEX_STATE.registryUnique || registryCount,
          sources_acquired: (m.source_count != null ? m.source_count : producing.size),
          sources_producing: producing.size,
          documents: m.document_count != null ? m.document_count : 0,
          facts: m.fact_count != null ? m.fact_count : 0,
          facts_served: proj.reduce((a, o) => a + (o.fact_count || 0), 0),
          evidence: proj.reduce((a, o) => a + (o.evidence_count || 0), 0),
          events: m.event_count != null ? m.event_count : 0,
          verified_by_review: verifiedCount,
          reviews_logged: reviewsCount,
        },
        freshness,
        health: { last_ok_at: INDEX_STATE.lastOkAt, delay_reason: INDEX_STATE.delayReason },
        data_asof: INDEX_STATE.builtAt,
        quality_gates: computeGates(),
        disclosure: {
          note_ar: 'أعداد صادقة: الكائنات = معرفات فريدة من الفيد؛ سجلات المخزن تشمل النسخ المتجاوزة؛ الاستغلال = المنتجة ÷ السجل الحي، والتعداد المرجعي 805 يُعرض في خريطة التغطية.',
          expansion_rule_ar: 'بوابات g0-g5 الست يجب أن تبقى PASS قبل إضافة أي مصدر جديد — وتقاس على الكل لا على عينات.',
        },
        filters: { countries, sectors, periods, source_ids: sourceIds },
        runs: (m.runs && m.runs.latest_run) ? [m.runs.latest_run] : [],
        engine: (() => {
          const lr = m.runs && m.runs.latest_run;
          if (!lr || !lr.finished_at) return { last_run_id: null, last_run_at: null, age_hours: null, stalled: true };
          const ageH = (Date.now() - Date.parse(lr.finished_at)) / 36e5;
          return { last_run_id: lr.run_id || null, last_run_at: lr.finished_at, age_hours: Math.round(ageH * 10) / 10, stalled: ageH > 24 };
        })(),
      });
    }
    if (pathname === '/analyst/api/outputs') {
      const q = (params.get('q') || '').toLowerCase();
      const country = params.get('country') || '';
      const sector = params.get('sector') || '';
      const sourceId = params.get('source_id') || '';
      const period = params.get('period') || '';
      const freshness = params.get('freshness') || '';
      let outputs = INDEX_STATE.projected;
      if (country) outputs = outputs.filter((o) => o.country === country);
      if (sector) outputs = outputs.filter((o) => o.sector === sector);
      if (sourceId) outputs = outputs.filter((o) => o.source_id === sourceId);
      if (period) outputs = outputs.filter((o) => o.period === period);
      if (freshness) outputs = outputs.filter((o) => o.freshness === freshness);
      if (q) outputs = outputs.filter((o) =>
        JSON.stringify([o.title_ar, o.headline, o.event_ar, o.institution_ar, o.institution,
                        o.source_id, o.excerpt, o.metrics]).toLowerCase().includes(q));
      // deterministic order: content date desc, io_id asc — pagination holes impossible.
      outputs = [...outputs].sort((a, b) =>
        String(b.content_date || '').localeCompare(String(a.content_date || '')) ||
        String(a.io_id).localeCompare(String(b.io_id)));
      const total = outputs.length;
      const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
      const size = Math.min(50, Math.max(1, parseInt(params.get('page_size') || '10', 10) || 10));
      const pages = Math.max(1, Math.ceil(total / size));
      const safePage = Math.min(page, pages);
      const start = (safePage - 1) * size;
      const slice = outputs.slice(start, start + size).map((raw0) => applyReview(raw0, INDEX_STATE.reviewsByIo)).map((o) => ({
        io_id: o.io_id, title_ar: o.title_ar, gloss_ar: o.gloss_ar, headline: o.headline,
        event_type: o.event_type, event_ar: o.event_ar,
        status: o.status, superseded: o.superseded, version: o.version,
        content_date: o.content_date, acquired_at: o.acquired_at,
        period: o.period, period_basis: o.period_basis, period_ar: o.period_ar,
        age_days: o.age_days, freshness: o.freshness, archive_tag: o.archive_tag,
        source_id: o.source_id, institution: o.institution, institution_ar: o.institution_ar,
        country: o.country, country_ar: o.country_ar,
        sector: o.sector, sector_ar: o.sector_ar,
        fact_count: o.fact_count, depth: o.depth, evidence_count: o.evidence_count,
        quality_verdict: o.quality_verdict, verdict_ar: o.verdict_ar,
        review: o.review, disp: o.disp, metrics: o.metrics, excerpt: o.excerpt,
        canonical_url: o.canonical_url, document_id: o.document_id,
      }));
      return sendJson(res, 200, { objects: slice, total, page: safePage, page_size: size,
                                  pages, index_built_at: INDEX_STATE.builtAt,
                                  index_state: INDEX_STATE.servingLastGood ? 'LAST_GOOD' : 'LIVE' });
    }
    if (pathname.startsWith('/analyst/api/output/')) {
      const ioId = decodeURIComponent(pathname.slice('/analyst/api/output/'.length));
      let o = INDEX_STATE.projected.find((x) => x.io_id === ioId);
      if (o) o = applyReview(o, loadReviews());
      if (!o) {
        // recompute single object with current reviews (cheap, still server-side).
        const raw = INDEX_STATE.objects.find((x) => x.io_id === ioId);
        if (!raw) return sendJson(res, 404, { error: { code: 'NOT_FOUND',
          message: 'intelligence object not found' } });
        o = applyReview(projectOutput(raw, INDEX_STATE.traces[ioId], INDEX_STATE.registry, INDEX_STATE.reviewsByIo), loadReviews());
      }
      return sendJson(res, 200, Object.assign({}, o, {
        index_built_at: INDEX_STATE.builtAt,
        index_state: INDEX_STATE.servingLastGood ? 'LAST_GOOD' : 'LIVE' }));
    }
    if (pathname === '/analyst/api/reviews') {
      return sendJson(res, 200, { reviews: readReviewsLog(),
        file: 'server-side append-only JSONL', note_ar: 'القرارات محفوظة على خادم الجسر وتغيّر الحكم المعروض فعلاً. ترحيلها إلى مخزن المحرك يتطلب مسار كتابة لدى Core (غير متوفر حالياً — موثق في بوابة g1).' });
    }
    if (pathname === '/analyst/api/sources') {
      // D2: registry rows are VERSION rows (one per classification) — dedupe
      // by source_id before presenting; unique institutions are the truth.
      const regRaw = INDEX_STATE.registry || {};
      const reg = {};
      for (const k of Object.keys(regRaw)) {
        const r = regRaw[k];
        if (!reg[r.source_id]) reg[r.source_id] = r; // first row wins
      }
      const producing = new Set(INDEX_STATE.projected.map((o) => o.source_id).filter(Boolean));
      const rows = Object.keys(reg).sort().map((sid) => ({
        source_id: sid,
        institution: reg[sid].institution_name || sid,
        institution_ar: instAr(reg[sid].institution_name || sid),
        country: reg[sid].country || '',
        country_ar: COUNTRY_AR[reg[sid].country || ''] || reg[sid].country || '',
        sector: reg[sid].source_class || '',
        sector_ar: SECTOR_AR[reg[sid].source_class || ''] || reg[sid].source_class || '',
        endpoint: reg[sid].acquisition_endpoint || '',
        documents: null,
        produced_intelligence: producing.has(sid),
      }));
      return sendJson(res, 200, { sources: rows, registered: Object.keys(reg).length,
        registry_rows_raw: (INDEX_STATE.registryRawRows || []).length,
        census_note_ar: 'سجل المحرك يضم ' + (INDEX_STATE.registryRawRows || []).length + ' صفاً (صنف لكل صف — الجهة قد تظهر بعدة صنوف) يغطي ' + Object.keys(reg).length + ' جهة فريدة مسجلة فعلياً — الاستغلال الحقيقي = المنتجة ÷ الفريدة.' });
    }
    if (pathname === '/analyst/api/review-queue') {
      // v9: غرفة المراجعة في طلب واحد — كان العميل يمشي 20 صفحة ليجمعها.
      // الحكم الجاري = الحكم المعروض الحالي (بعد تطبيق سجل المراجعة).
      const proj = INDEX_STATE.projected.map((o) => applyReview(o, INDEX_STATE.reviewsByIo));
      const verified = proj.filter((o) => o.quality_verdict === 'VERIFIED').length;
      const queue = proj.filter((o) => o.quality_verdict !== 'VERIFIED')
        .sort((a, b) =>
          String(b.content_date || '').localeCompare(String(a.content_date || '')) ||
          String(a.io_id).localeCompare(String(b.io_id)))
        .map((o) => ({
          io_id: o.io_id, title_ar: o.title_ar, institution_ar: o.institution_ar,
          country_ar: o.country_ar, freshness: o.freshness, depth: o.depth,
          quality_verdict: o.quality_verdict, verdict_ar: o.verdict_ar,
          content_date: o.content_date,
        }));
      const byVerdict = {};
      for (const o of proj) byVerdict[o.quality_verdict] = (byVerdict[o.quality_verdict] || 0) + 1;
      return sendJson(res, 200, {
        total_objects: proj.length, verified,
        queue_total: queue.length, by_verdict: byVerdict, queue,
        index_built_at: INDEX_STATE.builtAt,
        index_state: INDEX_STATE.servingLastGood ? 'LAST_GOOD' : 'LIVE',
      });
    }
    if (pathname === '/analyst/api/indicators') {
      // v9: أحدث قيمة معلنة لكل جهة، مجمّعة حسب المقياس — تُحسب عند الطلب من
      // الفهرس الحي (حقائق مخدومة مع وحداتها العربية). ليست سلسلة زمنية.
      const byMetric = {};
      for (const o of INDEX_STATE.projected) {
        const institutionAr = o.institution_ar || o.institution || 'جهة رسمية';
        const entries = [];
        for (const f of (o.facts || [])) {
          if (NUMERIC_METRICS.has(f.metric)) {
            const val = f.value == null ? '' : String(f.value).trim();
            if (!val) continue; // حقيقة بلا قيمة ليست مؤشراً
            entries.push({
              metric: f.metric, value: String(f.value),
              unit_ar: f.unit_ar || (f.unit ? (UNIT_AR[f.unit] || f.unit) : null),
            });
          }
        }
        if (o.disp && o.disp.kind === 'policy') {
          entries.push({
            metric: 'official_policy_decision',
            value: o.disp.value + (o.disp.extra ? ' — ' + o.disp.extra : ''),
            unit_ar: null,
          });
        }
        for (const e of entries) {
          e.io_id = o.io_id;
          e.institution_ar = institutionAr;
          e.period_ar = o.period_ar;
          e.content_date = o.content_date;
          (byMetric[e.metric] = byMetric[e.metric] || []).push(e);
        }
      }
      const indicators = Object.keys(byMetric).map((metric) => {
        // أحدث قيمة لكل جهة داخل المقياس (تعادل التاريخ أولاً ثم الأصغر io_id).
        const latestByInst = {};
        for (const it of byMetric[metric]) {
          const k = it.institution_ar;
          const cur = latestByInst[k];
          if (!cur ||
              String(it.content_date || '') > String(cur.content_date || '') ||
              (String(it.content_date || '') === String(cur.content_date || '') &&
               String(it.io_id) < String(cur.io_id))) latestByInst[k] = it;
        }
        const items = Object.values(latestByInst).sort((a, b) =>
          String(b.content_date || '').localeCompare(String(a.content_date || '')) ||
          String(a.io_id).localeCompare(String(b.io_id)));
        return {
          metric,
          metric_ar: metric === 'official_policy_decision' ? 'قرار سياسة نقدية' : (METRIC_AR[metric] || metric),
          items,
        };
      }).sort((a, b) => b.items.length - a.items.length || a.metric.localeCompare(b.metric));
      return sendJson(res, 200, {
        indicators,
        note_ar: 'أحدث قيمة معلنة لكل جهة، من الحقائق المهيكلة للفهرس الحي — ليست سلسلة زمنية كاملة',
      });
    }
    if (pathname === '/analyst/api/stats') {
      // v9: عدّاد استخدام بلا تتبع — أعداد يومية فقط، لا IP ولا معرّفات.
      return sendJson(res, 200, usageStatsPayload());
    }
    if (pathname === '/analyst/api/archive/r7') {
      try {
        const s = fs.readFileSync(path.join(STATIC_ROOT,
          'archive/proof-data/proof-summary.json'), 'utf-8');
        return sendJson(res, 200, { archive_kind: 'R7_ARCHIVED_SNAPSHOT', summary: JSON.parse(s) });
      } catch (_) {
        return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'R7 archive not present' } });
      }
    }
    return sendJson(res, 404, { error: { code: 'NOT_FOUND',
      message: 'unknown analyst api path: ' + pathname } });
  });
}

function handleReviewPost(req, res) {
  // v9: حوكمة سطح الكتابة الوحيد — توكن مراجعة اختياري عبر ترويسة
  // x-review-token. المقارنة زمنية-ثابتة على أطوال متساوية (اختلاف الطول
  // فشل صريح). REVIEW_TOKEN غير مضبوط = سلوك اليوم حرفياً (تطوير مفتوح).
  if (REVIEW_TOKEN) {
    const given = String(req.headers['x-review-token'] || '');
    const a = Buffer.from(given, 'utf-8');
    const b = Buffer.from(REVIEW_TOKEN, 'utf-8');
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      return sendJson(res, 401, { error: { code: 'REVIEW_TOKEN_REQUIRED',
        message: 'x-review-token header required',
        message_ar: 'هذه المنصة تطلب توكن مراجعة — أدخله في حقل التوكن ثم أعد المحاولة' } });
    }
  }
  let body = '';
  let overflow = false;
  req.on('data', (c) => { body += c; if (body.length > 64 * 1024) { overflow = true; req.destroy(); } });
  req.on('end', () => {
    if (overflow) return;
    let d = null;
    try { d = JSON.parse(body); } catch (_) {}
    if (!d || typeof d !== 'object') {
      return sendJson(res, 400, { error: { code: 'BAD_JSON', message: 'body must be JSON' } });
    }
    const ioId = String(d.io_id || '');
    const verdict = String(d.verdict || '');
    const actor = String(d.actor || '').trim();
    const note = String(d.note || '').trim();
    const VALID = ['VERIFIED', 'REJECTED', 'NEEDS_REVIEW'];
    if (!INDEX_STATE.projected) {
      return sendJson(res, 503, { error: { code: 'INDEX_UNAVAILABLE', message: 'index not built' } });
    }
    if (!INDEX_STATE.projected.some((x) => x.io_id === ioId)) {
      return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'unknown io_id: ' + ioId } });
    }
    if (!VALID.includes(verdict)) {
      return sendJson(res, 400, { error: { code: 'BAD_VERDICT', message: 'verdict must be one of ' + VALID.join('|') } });
    }
    if (!actor || actor.length > 80) {
      return sendJson(res, 400, { error: { code: 'BAD_ACTOR', message: 'actor required (1-80 chars)' } });
    }
    const record = { io_id: ioId, verdict, actor, note: note.slice(0, 500),
                     at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    try { fs.appendFileSync(REVIEWS_FILE, JSON.stringify(record) + '\n'); }
    catch (e) {
      return sendJson(res, 500, { error: { code: 'WRITE_FAILED', message: String(e && e.message || e) } });
    }
    INDEX_STATE.reviewsByIo = INDEX_STATE.reviewsByIo || {};
    INDEX_STATE.reviewsByIo[ioId] = record;
    sendJson(res, 200, { ok: true, recorded: record,
      effect_ar: 'الحكم المعروض لهذا الكائن تغيّر فعلاً في الخادم — سجل مراجعة دائم باسم الفاعل.' });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
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
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function proxyAllowed(pathname) {
  const bare = pathname.split('?')[0];
  return PROXY_ALLOW.some((rx) => rx.test(bare));
}

async function proxy(req, res, pathnameWithQuery) {
  if (!proxyAllowed(pathnameWithQuery)) {
    return sendJson(res, 404, {
      error: { code: 'NOT_FOUND',
               message: 'path not in the read whitelist: ' + pathnameWithQuery } });
  }
  if (!CORE_URL || !CORE_TOKEN) {
    return sendJson(res, 503, {
      error: { code: 'INTEGRATION_MISCONFIGURED',
               message: 'server-side Core credential is absent; no request was made' } });
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const upstream = await fetch(CORE_URL + pathnameWithQuery, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + CORE_TOKEN, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (_) {}
    if (parsed === null) {
      return sendJson(res, 502, { error: { code: 'UPSTREAM_NOT_JSON',
        message: 'Core response was not valid JSON', status: upstream.status } });
    }
    const headers = {};
    const etag = upstream.headers.get('etag');
    if (etag) headers['ETag'] = etag;
    return send(res, upstream.status, 'application/json; charset=utf-8', body, headers);
  } catch (error) {
    return sendJson(res, 503, { error: { code: 'CORE_UNAVAILABLE',
      message: 'Core is unreachable: ' + (error && error.message ? error.message : String(error)),
      hint: 'the interface keeps its last good page and shows the delay reason' } });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  const params = url.searchParams;

  // Core proxy stays GET/HEAD-only (fail closed) — the review log is the single
  // local write surface and never touches Core.
  if (req.method !== 'GET' && req.method !== 'HEAD' && pathname !== '/analyst/api/review') {
    return sendJson(res, 405, {
      error: { code: 'READ_ONLY', message: 'this surface can only read; POST /analyst/api/review is the only write' } });
  }

  if (pathname.startsWith('/analyst/api/')) {
    // v9: عدّاد بلا تتبع — /stats نفسه مستثنى كي لا ينفخ نفسه.
    if (pathname !== '/analyst/api/stats') usageCount('api');
    return analystApi(req, res, pathname, params);
  }
  if (pathname.startsWith('/core/')) {
    const corePath = pathname.slice('/core'.length) + url.search;
    return proxy(req, res, corePath);
  }
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(302, { Location: '/rouaa-console-dark.html' });
    return res.end();
  }
  if (pathname === '/proof-workbench.html' || pathname === '/proof-workbench') {
    res.writeHead(302, { Location: '/rouaa-console-dark.html' });
    return res.end();
  }
  // v10: صفحة الحالة العامة — قبل الملفات الثابتة. /status.json يعطي نفس
  // حمولة /analyst/api/status (طلب API)، و /status صفحة HTML عربية RTL
  // مكتفية بذاته تُعدّ مشاهدة صفحة كسائر صفحات HTML.
  if (pathname === '/status.json') {
    usageCount('api');
    return sendJson(res, 200, statusPayload());
  }
  if (pathname === '/status') {
    usageCount('views');
    return send(res, 200, 'text/html; charset=utf-8', statusPageHtml());
  }
  let file = pathname === '/' ? '/rouaa-analyst.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(STATIC_ROOT, file);
  if (!abs.startsWith(STATIC_ROOT)) {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'outside the static root' } });
  }
  let stat = null;
  try { stat = fs.statSync(abs); } catch (_) {}
  if (!stat || !stat.isFile()) {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'asset not found: ' + pathname } });
  }
  const headers = {};
  if (/\.(ttf|woff2)$/.test(abs)) headers['Cache-Control'] = 'public, max-age=604800';
  fs.readFile(abs, (error, data) => {
    if (error) {
      return sendJson(res, 500, { error: { code: 'READ_ERROR', message: 'asset could not be read' } });
    }
    // v9: مشاهدات = صفحات HTML مخدومة بنجاح فقط (لا 404 ولا 500).
    if (pathname === '/' || pathname === '/rouaa-console-dark.html' ||
        pathname === '/rouaa-analyst.html') usageCount('views');
    const type = MIME[path.extname(abs)] || 'application/octet-stream';
    send(res, 200, type, data, headers);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[analyst-site-v3] CORE_URL=' + CORE_URL + ' token_len=' + String(CORE_TOKEN).length);
  console.log('[analyst-site-v3] listening on 0.0.0.0:' + PORT +
              ' (Core GET-only; review log is the single server-side write surface)');
});
