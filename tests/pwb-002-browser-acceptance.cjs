'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'pwb-002-r8');
const WIDTHS = [1440, 1280, 1024, 768, 390];
const ROUTES = [
  'overview', 'runs', 'sources', 'acquisition', 'documents',
  'representations', 'facts', 'evidence', 'events', 'intelligence',
  'deliveries', 'quality', 'failures', 'provenance', 'runtime',
  'accounting', 'audit', 'search'
];

function readManifest() {
  return JSON.parse(fs.readFileSync(
    path.join(ROOT, 'proof-data', 'proof-manifest.json'), 'utf8'));
}

function recordCheck(report, name, passed, detail) {
  report.interaction_checks[name] = { passed: !!passed, detail: detail || null };
  if (!passed) report.functional_failures.push({ check: name, detail: detail || null });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = readManifest();
  const scope = manifest.data_scope;
  const isR7 = scope === 'R7_FIRST_VERIFIED_INTELLIGENCE_OBJECT';
  const browser = await chromium.launch({ headless: true });
  const report = {
    run_at: new Date().toISOString(),
    data_scope: scope,
    snapshot_kind: manifest.snapshot_kind,
    core_commit: manifest.core_commit,
    routes: [],
    viewports: [],
    console_errors: [],
    page_errors: [],
    overflow_failures: [],
    request_method_violations: [],
    live_api_requests: [],
    functional_failures: [],
    interaction_checks: {},
    integrity_failure: null
  };

  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1
      });
      const page = await context.newPage();
      page.on('console', msg => {
        if (msg.type() === 'error') report.console_errors.push({
          width, route: page.url(), text: msg.text()
        });
      });
      page.on('pageerror', error => report.page_errors.push({
        width, route: page.url(), text: error.message
      }));
      page.on('request', request => {
        if (request.method() !== 'GET') {
          report.request_method_violations.push({
            width, method: request.method(), url: request.url()
          });
        }
        if (/\/production\//i.test(request.url())) {
          report.live_api_requests.push({ width, url: request.url() });
        }
      });

      await page.goto('http://127.0.0.1:4173/proof-workbench.html', {
        waitUntil: 'networkidle'
      });
      await page.locator('#pw-source-state').waitFor();
      await page.waitForFunction(() =>
        document.querySelector('#pw-source-state')?.textContent.includes('HASHES VERIFIED'));
      const banner = await page.locator('#pw-snapshot-banner').innerText();
      if (!banner.includes('R7 VERIFIED PROOF SNAPSHOT — NOT A LIVE FEED') ||
          !banner.includes('Independent semantic review')) {
        throw new Error('Verified snapshot banner or its semantic-review qualification is missing');
      }
      if (!(await page.locator('.pw-scope').innerText()).includes('ARCHIVED')) {
        throw new Error('The Workbench does not disclose ARCHIVED snapshot state');
      }
      if (await page.locator('#pw-global-search').getAttribute('aria-label') !==
          'Search all exported R7 records') {
        throw new Error('Global search is missing its accessible name');
      }
      if (!(await page.locator('#pw-navigation').getAttribute('aria-label'))) {
        throw new Error('Primary navigation is missing its accessible name');
      }

      for (const route of ROUTES) {
        await page.locator('#pw-navigation [data-route="' + route + '"]').click();
        await page.waitForFunction(expected =>
          document.querySelector('#pw-navigation .is-active')?.dataset.route === expected,
          route);
        await page.locator('#pw-main h1').waitFor();
        await page.waitForTimeout(25);
        const overflow = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          body: document.body.scrollWidth
        }));
        if (overflow.scroll > overflow.width + 1 ||
            overflow.body > overflow.width + 1) {
          report.overflow_failures.push({ width, route, ...overflow });
        }
        const screenshot = path.join(OUT, 'R7-' + route + '-' + width + '.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        report.routes.push({ width, route, screenshot: path.relative(ROOT, screenshot) });
      }

      if (width === 1440 && isR7) {
        await page.locator('#pw-navigation [data-route="overview"]').click();
        const overviewText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'provisional_warning',
          overviewText.includes('PROVISIONAL / PRELIMINARY RELEASE') &&
          overviewText.includes('+5.4% NIC annual figure must not be presented as final'));

        await page.locator('#pw-navigation [data-route="documents"]').click();
        const docButton = page.locator('#pw-main [data-document]').first();
        await docButton.waitFor();
        await docButton.click();
        const detail = page.locator('#pw-main .pw-panel').filter({
          hasText: 'ORIGINAL DOCUMENT DETAIL'
        });
        await detail.waitFor();
        const detailText = await detail.innerText();
        recordCheck(report, 'document_detail',
          detailText.includes('Consumer prices (provisional data) — October 2026') &&
          detailText.includes('2026-10-30') &&
          detailText.includes('CC BY 4.0') &&
          detailText.includes('cac41dcabd4c797a5e437e921cbfc3fdb591cffaf0a27218ae0f2cd4ef85f6f8'));

        await page.locator('#pw-navigation [data-route="sources"]').click();
        const filter = page.locator('#pw-filter');
        await filter.fill('not-a-real-source-record');
        const filterResult = await page.locator('#pw-row-count').innerText();
        recordCheck(report, 'source_filter_zero_is_explicit',
          filterResult.trim() === '0 / 1 ROWS', filterResult);

        await page.locator('#pw-navigation [data-route="facts"]').click();
        const factButton = page.locator('#pw-main [data-fact]').first();
        await factButton.waitFor();
        await factButton.click();
        recordCheck(report, 'fact_to_detail',
          (await page.locator('#pw-main').innerText()).includes('fact-25a1a2a5b4a35c10') &&
          (await page.locator('#pw-main').innerText()).includes('5.4'));

        await page.locator('#pw-navigation [data-route="evidence"]').click();
        const evidenceText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'fact_to_evidence',
          evidenceText.includes('evi-72ffc9392eade922') &&
          evidenceText.includes('+5.4% on annual basis'));

        await page.locator('#pw-navigation [data-route="intelligence"]').click();
        const ioText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'io_display',
          ioText.includes('io-a2da4f8ba3df34d6') && ioText.includes('5.4%'));

        await page.locator('#pw-navigation [data-route="deliveries"]').click();
        const deliveryText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'delivery_display',
          deliveryText.includes('dlv-ae75e99cf476897b') &&
          deliveryText.includes('DELIVERED'));

        await page.locator('#pw-navigation [data-route="representations"]').click();
        const representationText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'representation_limits_are_explicit',
          representationText.includes('rep-6da9a5f385c0c0cf') &&
          representationText.includes('RetrievalEvent ledger') &&
          representationText.includes('UNAVAILABLE'));

        await page.locator('#pw-navigation [data-route="failures"]').click();
        const failuresText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'missing_failure_ledger_is_not_zero',
          failuresText.includes('UNAVAILABLE · NOT ZERO') &&
          failuresText.includes('not evidence that the engine had zero failures'));

        await page.locator('#pw-navigation [data-route="runtime"]').click();
        const runtimeText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'runtime_is_snapshot_not_live',
          runtimeText.includes('SNAPSHOT · NOT LIVE') &&
          runtimeText.includes('NOT CHECKED') &&
          runtimeText.includes('NOT SUPPORTED'));

        await page.locator('#pw-navigation [data-route="quality"]').click();
        const qualityText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'semantic_review_stays_pending',
          qualityText.includes('PENDING_HUMAN_REVIEW') &&
          qualityText.includes('INDEPENDENT HUMAN REVIEW PENDING'));

        await page.locator('#pw-navigation [data-route="provenance"]').click();
        const lineageText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'lineage_contains_all_required_ids',
          [
            'src-istat', 'doc-6f4ad50d00c7af64', 'rep-6da9a5f385c0c0cf',
            'fact-25a1a2a5b4a35c10', 'evi-72ffc9392eade922',
            'evt-b5413fb26d1542e9', 'io-a2da4f8ba3df34d6',
            'dlv-ae75e99cf476897b'
          ].every(id => lineageText.includes(id)));

        await page.locator('#pw-navigation [data-route="audit"]').click();
        await page.locator('#pw-raw-file').selectOption('proof-manifest.json');
        const rawText = await page.locator('#pw-main .pw-raw-json').innerText();
        recordCheck(report, 'raw_manifest_is_inspectable',
          rawText.includes('R7_FIRST_VERIFIED_INTELLIGENCE_OBJECT') &&
          rawText.includes('core_commit') &&
          rawText.includes('export_files'));

        const globalSearch = page.locator('#pw-global-search');
        await globalSearch.fill('fact-25a1a2a5b4a35c10');
        let searchText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'global_search_finds_fact',
          searchText.includes('fact-25a1a2a5b4a35c10') &&
          searchText.includes('1 MATCHING RECORDS'));
        await globalSearch.fill('');
        searchText = await page.locator('#pw-main').innerText();
        const nextPage = page.locator('#pw-main [data-search-page="1"]');
        const hasNextPage = await nextPage.count();
        if (hasNextPage) await nextPage.click();
        const pageTwoText = await page.locator('#pw-main').innerText();
        recordCheck(report, 'global_search_pagination',
          hasNextPage === 1 && pageTwoText.includes('Page 2 of') &&
          pageTwoText.includes('records'));

        await page.locator('#pw-search-layer').selectOption('REPRESENTATION');
        const representationFilter = await page.locator('#pw-main').innerText();
        recordCheck(report, 'global_search_layer_filter',
          representationFilter.includes('1 MATCHING RECORDS') &&
          representationFilter.includes('rep-6da9a5f385c0c0cf'));

        await globalSearch.fill('');
        await page.locator('#pw-navigation [data-route="audit"]').click();
        const rawFiles = await page.locator('#pw-raw-file option').count();
        recordCheck(report, 'raw_export_selector_includes_manifest', rawFiles === 11, String(rawFiles));

        await page.locator('#pw-global-search').focus();
        const focusStyle = await page.locator('#pw-global-search').evaluate(el => {
          const style = getComputedStyle(el);
          return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
        });
        recordCheck(report, 'keyboard_focus_is_visible',
          focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth !== '0px', focusStyle);
      }

      await context.close();
      report.viewports.push(width);
    }

    const badContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const badPage = await badContext.newPage();
    await badPage.route('**/proof-data/proof-facts.json', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 'ROUAA_PROOF_CONTRACT_V1',
          data_scope: scope,
          tampered: true
        })
      }));
    await badPage.goto('http://127.0.0.1:4173/proof-workbench.html', {
      waitUntil: 'networkidle'
    });
    await badPage.locator('#pw-source-state').filter({ hasText: 'DATA SOURCE UNAVAILABLE' }).waitFor();
    const failedBanner = await badPage.locator('#pw-snapshot-banner').innerText();
    report.integrity_failure = {
      fail_closed: true,
      unavailable_text: await badPage.locator('#pw-source-state').innerText(),
      banner: failedBanner
    };
    recordCheck(report, 'tamper_fails_closed',
      failedBanner.includes('R7 SNAPSHOT INTEGRITY UNAVAILABLE') &&
      failedBanner.includes('NOT A LIVE FEED'));
    await badPage.screenshot({
      path: path.join(OUT, 'R7-integrity-failure-1440.png'),
      fullPage: true
    });
    await badContext.close();

    report.result = (
      report.console_errors.length === 0 &&
      report.page_errors.length === 0 &&
      report.overflow_failures.length === 0 &&
      report.request_method_violations.length === 0 &&
      report.live_api_requests.length === 0 &&
      report.routes.length === ROUTES.length * WIDTHS.length &&
      report.viewports.length === WIDTHS.length &&
      report.integrity_failure.fail_closed &&
      report.functional_failures.length === 0
    ) ? 'PASS' : 'FAIL';
    fs.writeFileSync(path.join(OUT, 'visual-qa-report.json'),
      JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      result: report.result,
      data_scope: scope,
      routes: report.routes.length,
      expected_routes: ROUTES.length * WIDTHS.length,
      viewports: report.viewports,
      console_errors: report.console_errors.length,
      page_errors: report.page_errors.length,
      overflow_failures: report.overflow_failures.length,
      request_method_violations: report.request_method_violations.length,
      live_api_requests: report.live_api_requests.length,
      functional_failures: report.functional_failures,
      screenshot_dir: OUT
    }, null, 2));
    if (report.result !== 'PASS') process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
