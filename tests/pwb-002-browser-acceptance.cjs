'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'pwb-002');
const WIDTHS = [1440, 1280, 1024, 768, 390];
const ROUTES = [
  'overview', 'sources', 'acquisition', 'documents', 'facts',
  'evidence', 'events', 'intelligence', 'deliveries', 'runs', 'quality'
];

function readManifest() {
  return JSON.parse(fs.readFileSync(
    path.join(ROOT, 'proof-data', 'proof-manifest.json'), 'utf8'));
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
    routes: [],
    viewports: [],
    console_errors: [],
    page_errors: [],
    overflow_failures: [],
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

      await page.goto('http://127.0.0.1:4173/proof-workbench.html', {
        waitUntil: 'networkidle'
      });
      await page.locator('#pw-source-state').waitFor();
      await page.waitForFunction(() =>
        document.querySelector('#pw-source-state')?.textContent.includes('HASHES VERIFIED'));
      if (!(await page.locator('.pw-scope').innerText()).includes('ARCHIVED')) {
        throw new Error('The Workbench does not disclose ARCHIVED snapshot state');
      }

      for (const route of ROUTES) {
        await page.locator('#pw-navigation [data-route="' + route + '"]').click();
        await page.waitForFunction(expected =>
          document.querySelector('#pw-navigation .is-active')?.dataset.route === expected,
          route);
        await page.waitForTimeout(50);
        const overflow = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          body: document.body.scrollWidth
        }));
        if (overflow.scroll > overflow.width + 1 ||
            overflow.body > overflow.width + 1) {
          report.overflow_failures.push({ width, route, ...overflow });
        }
        const screenshot = path.join(OUT, scope + '-' + route + '-' + width + '.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        report.routes.push({ width, route, screenshot: path.relative(ROOT, screenshot) });
      }

      if (width === 1440) {
        await page.locator('#pw-navigation [data-route="documents"]').click();
        const docButton = page.locator('#pw-main [data-document]').first();
        if (await docButton.count()) {
          await docButton.click();
          await page.locator('#pw-main .pw-detail').waitFor();
          report.interaction_checks.document_detail = true;
        } else {
          report.interaction_checks.document_detail = false;
        }

        await page.locator('#pw-navigation [data-route="sources"]').click();
        const filter = page.locator('#pw-filter');
        if (await filter.count()) {
          await filter.fill('not-a-real-source-record');
          report.interaction_checks.source_filter = await page.locator('#pw-row-count').innerText();
        } else {
          report.interaction_checks.source_filter = 'NO_FILTER_IN_R7_VIEW';
        }

        if (isR7) {
          await page.locator('#pw-navigation [data-route="facts"]').click();
          const factButton = page.locator('#pw-main [data-fact]').first();
          await factButton.waitFor();
          await factButton.click();
          report.interaction_checks.fact_to_detail =
            (await page.locator('#pw-main').innerText()).includes('5.4');
          await page.locator('#pw-navigation [data-route="evidence"]').click();
          report.interaction_checks.fact_to_evidence =
            (await page.locator('#pw-main').innerText()).includes('+5.4%');
          await page.locator('#pw-navigation [data-route="intelligence"]').click();
          const ioText = await page.locator('#pw-main').innerText();
          report.interaction_checks.io_display =
            ioText.includes('5.4%') && ioText.includes('io-');
          await page.locator('#pw-navigation [data-route="deliveries"]').click();
          report.interaction_checks.delivery_display =
            (await page.locator('#pw-main').innerText()).includes('DELIVERED');
        } else {
          await page.locator('#pw-navigation [data-route="intelligence"]').click();
          report.interaction_checks.zero_io_state =
            (await page.locator('#pw-main').innerText()).includes('NO VERIFIED INTELLIGENCE OBJECTS');
        }
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
    report.integrity_failure = {
      fail_closed: true,
      unavailable_text: await badPage.locator('#pw-source-state').innerText()
    };
    await badPage.screenshot({
      path: path.join(OUT, scope + '-integrity-failure.png'),
      fullPage: true
    });
    await badContext.close();

    report.result = (
      report.console_errors.length === 0 &&
      report.page_errors.length === 0 &&
      report.overflow_failures.length === 0 &&
      report.routes.length === 55 &&
      report.integrity_failure.fail_closed
    ) ? 'PASS' : 'FAIL';
    fs.writeFileSync(path.join(OUT, 'visual-qa-report.json'),
      JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      result: report.result,
      data_scope: scope,
      routes: report.routes.length,
      viewports: report.viewports,
      console_errors: report.console_errors.length,
      page_errors: report.page_errors.length,
      overflow_failures: report.overflow_failures.length,
      interaction_checks: report.interaction_checks,
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
