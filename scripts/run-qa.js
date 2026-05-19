import { chromium, devices } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { SITES } from './sites.js';
import { measureLCP, lcpStatus, findBrokenImages } from './helpers.js';

const RUN_TIMESTAMP = new Date().toISOString();
const RUN_DATE = RUN_TIMESTAMP.slice(0, 10);

const BANNER_PHRASES = [
  'certified renewed devices',
  'inspected by experts',
  'up to 70% cheaper than new',
];
const EMPTY_STATE_PHRASE = 'no products found';
const IMPOSSIBLE_FILTER_QS = '?filter.v.price.gte=999999999';
const SORT_ASC_QS = '?sort_by=price-ascending';
const SEARCH_QUERY = 'Samsung';

async function main() {
  const browser = await chromium.launch();
  const siteReports = [];

  for (const site of SITES) {
    console.log(`\n=== Testing ${site.name} (${site.region}) ===`);
    try {
      const report = await testSite(browser, site);
      siteReports.push(report);
      console.log(`  ${report.summary.pass} pass, ${report.summary.warning} warn, ${report.summary.fail} fail`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      siteReports.push({
        id: site.id,
        name: site.name,
        error: err.message,
        summary: { total: 0, pass: 0, warning: 0, fail: 1, passRate: 0, status: 'fail' },
        checks: [],
      });
    }
  }

  await browser.close();

  const report = {
    date: RUN_DATE,
    timestamp: RUN_TIMESTAMP,
    sites: siteReports,
  };

  if (!existsSync('reports')) mkdirSync('reports');
  const filepath = `reports/${RUN_DATE}.json`;
  writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${filepath}`);
}

async function testSite(browser, site) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const checks = [];

  const failedImageRequests = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && response.request().resourceType() === 'image') {
      failedImageRequests.push({ url: response.url(), status: response.status() });
    }
  });

  await runHomepageChecks(page, site, checks);
  await runPLPChecks(page, site, checks);

  checks.push({
    id: 'image-network-ok',
    category: 'visual',
    description: 'All image network requests returned 2xx/3xx across this session',
    status: failedImageRequests.length === 0 ? 'pass' : 'warning',
    details: { failedCount: failedImageRequests.length, samples: failedImageRequests.slice(0, 5) },
  });

  await context.close();
  return summarize(site, checks);
}

async function runHomepageChecks(page, site, checks) {
  let response;
  let lcpMs = 0;
  try {
    const result = await measureLCP(page, site.baseUrl);
    response = result.response;
    lcpMs = result.lcpMs;
  } catch (err) {
    checks.push({
      id: 'homepage-loads',
      category: 'functional',
      description: 'Homepage loads with 2xx response',
      status: 'fail',
      details: { error: err.message },
    });
    checks.push({
      id: 'homepage-lcp',
      category: 'performance',
      description: 'Homepage LCP (Largest Contentful Paint) under thresholds',
      status: 'fail',
      details: { error: err.message },
    });
    return;
  }

  checks.push({
    id: 'homepage-loads',
    category: 'functional',
    description: 'Homepage loads with 2xx response',
    status: response.status() < 400 ? 'pass' : 'fail',
    details: { status: response.status() },
  });

  checks.push({
    id: 'homepage-lcp',
    category: 'performance',
    description: 'Homepage LCP under thresholds (pass <2.5s, warn 2.5-4s, fail >4s)',
    status: lcpStatus(lcpMs),
    details: {
      lcpMs,
      thresholds: { passUnderMs: 2500, warnUnderMs: 4000 },
    },
  });

  const pageText = (await page.textContent('body').catch(() => '')) || '';
  const foundSymbol = site.currency.symbols.find((sym) => pageText.includes(sym));
  checks.push({
    id: 'currency-present',
    category: 'localization',
    description: `Currency ${site.currency.code} appears on homepage`,
    status: foundSymbol ? 'pass' : 'fail',
    details: { expectedSymbols: site.currency.symbols, foundSymbol: foundSymbol ?? null },
  });

  const brokenImages = await findBrokenImages(page);
  checks.push({
    id: 'broken-images',
    category: 'visual',
    description: 'No broken images on homepage (naturalWidth === 0, ignoring data:/empty/base-url srcs, after lazy-load scroll)',
    status: brokenImages.length === 0 ? 'pass' : brokenImages.length <= 2 ? 'warning' : 'fail',
    details: { count: brokenImages.length, sampleUrls: brokenImages.slice(0, 5) },
  });
}

async function runPLPChecks(page, site, checks) {
  const plpBase = site.baseUrl + site.plpPath;
  let defaultOrder = [];

  // Banner sub-text + BNPL logos + default product order (one navigation).
  try {
    await page.goto(plpBase, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const bodyText = ((await page.textContent('body').catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const missingPhrases = BANNER_PHRASES.filter((p) => !bodyText.includes(p));
    checks.push({
      id: 'plp-banner-text',
      category: 'content',
      description: 'PLP banner sub-text "Certified renewed devices - Inspected by Experts - Up to 70% cheaper than new" present',
      status: missingPhrases.length === 0 ? 'pass' : 'fail',
      details: { url: plpBase, expectedPhrases: BANNER_PHRASES, missingPhrases },
    });

    const foundProviders = await page.evaluate((providers) => {
      const text = (document.body.innerText || '').toLowerCase();
      const imgInfo = Array.from(document.images)
        .map((i) => `${i.alt || ''} ${i.src || ''}`.toLowerCase())
        .join(' ');
      const haystack = text + ' ' + imgInfo;
      return providers.filter((p) => haystack.includes(p.toLowerCase()));
    }, site.bnpl);
    const missingProviders = site.bnpl.filter((p) => !foundProviders.includes(p));
    const bnplStatus =
      missingProviders.length === 0 ? 'pass' : foundProviders.length > 0 ? 'warning' : 'fail';
    checks.push({
      id: 'plp-bnpl-logos',
      category: 'localization',
      description: `BNPL providers ${site.bnpl.join(', ')} present on PLP`,
      status: bnplStatus,
      details: { url: plpBase, expected: site.bnpl, found: foundProviders, missing: missingProviders },
    });

    defaultOrder = await getProductOrder(page);
  } catch (err) {
    for (const id of ['plp-banner-text', 'plp-bnpl-logos']) {
      checks.push({
        id,
        category: 'content',
        description: id,
        status: 'fail',
        details: { error: `PLP failed to load: ${err.message}` },
      });
    }
  }

  // Empty-state on impossible filter.
  try {
    const impossibleUrl = plpBase + IMPOSSIBLE_FILTER_QS;
    await page.goto(impossibleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const text = ((await page.textContent('body').catch(() => '')) || '').toLowerCase();
    const found = text.includes(EMPTY_STATE_PHRASE);
    checks.push({
      id: 'plp-empty-state',
      category: 'content',
      description: 'Empty-state message "No products found..." appears on impossible filter combination',
      status: found ? 'pass' : 'fail',
      details: { url: impossibleUrl, expectedSubstring: 'No products found', found },
    });
  } catch (err) {
    checks.push({
      id: 'plp-empty-state',
      category: 'content',
      description: 'Empty-state message on impossible filter combination',
      status: 'fail',
      details: { error: err.message },
    });
  }

  // Samsung search.
  try {
    const searchUrl = `${site.baseUrl}/search?q=${encodeURIComponent(SEARCH_QUERY)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const productCount = await page.evaluate(() => {
      const set = new Set();
      document.querySelectorAll('a[href*="/products/"]').forEach((a) => {
        try {
          set.add(new URL(a.href).pathname);
        } catch (_) {
          set.add(a.getAttribute('href') || '');
        }
      });
      return set.size;
    });
    checks.push({
      id: 'plp-search-samsung',
      category: 'functional',
      description: 'Search for "Samsung" returns at least one product card',
      status: productCount >= 1 ? 'pass' : 'fail',
      details: { url: searchUrl, productCardCount: productCount },
    });
  } catch (err) {
    checks.push({
      id: 'plp-search-samsung',
      category: 'functional',
      description: 'Search for "Samsung" returns at least one product card',
      status: 'fail',
      details: { error: err.message },
    });
  }

  // Sort-by-price-low-to-high changes order.
  try {
    if (defaultOrder.length === 0) {
      await page.goto(plpBase, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      defaultOrder = await getProductOrder(page);
    }
    const sortUrl = plpBase + SORT_ASC_QS;
    await page.goto(sortUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const sortedOrder = await getProductOrder(page);
    const orderChanged =
      defaultOrder.length > 0 &&
      sortedOrder.length > 0 &&
      JSON.stringify(defaultOrder) !== JSON.stringify(sortedOrder);
    let status;
    if (sortedOrder.length === 0 || defaultOrder.length === 0) status = 'fail';
    else if (orderChanged) status = 'pass';
    else status = 'warning';
    checks.push({
      id: 'plp-sort-price-asc',
      category: 'functional',
      description: 'Sort by price low-to-high changes product card order',
      status,
      details: {
        defaultCount: defaultOrder.length,
        sortedCount: sortedOrder.length,
        defaultFirst3: defaultOrder.slice(0, 3),
        sortedFirst3: sortedOrder.slice(0, 3),
        orderChanged,
      },
    });
  } catch (err) {
    checks.push({
      id: 'plp-sort-price-asc',
      category: 'functional',
      description: 'Sort by price low-to-high changes product card order',
      status: 'fail',
      details: { error: err.message },
    });
  }
}

async function getProductOrder(page) {
  return await page.evaluate(() => {
    const seen = new Set();
    const order = [];
    document.querySelectorAll('a[href*="/products/"]').forEach((a) => {
      let pathname;
      try {
        pathname = new URL(a.href).pathname;
      } catch (_) {
        pathname = a.getAttribute('href') || '';
      }
      if (!seen.has(pathname)) {
        seen.add(pathname);
        order.push(pathname);
      }
    });
    return order.slice(0, 8);
  });
}

function summarize(site, checks) {
  const passing = checks.filter((c) => c.status === 'pass').length;
  const warnings = checks.filter((c) => c.status === 'warning').length;
  const failing = checks.filter((c) => c.status === 'fail').length;
  const total = checks.length || 1;
  return {
    id: site.id,
    name: site.name,
    region: site.region,
    summary: {
      total: checks.length,
      pass: passing,
      warning: warnings,
      fail: failing,
      passRate: Math.round((passing / total) * 100),
      status: failing > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
    },
    checks,
  };
}

main().catch((err) => {
  console.error('Run failed:', err);
  process.exit(1);
});
