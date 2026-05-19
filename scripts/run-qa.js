import { chromium, devices } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { SITES } from './sites.js';
import j1 from './journeys/j1-plp.js';
import j2 from './journeys/j2-pdp.js';
import j3 from './journeys/j3-cart.js';
import j4 from './journeys/j4-navigation.js';
import j5 from './journeys/j5-speed.js';
import j6 from './journeys/j6-localization.js';

// Execution order is dependency-driven, not numeric:
// j4 (homepage init) → j1 (PLP, captures first product handle)
//   → j2 (PDP, captures Shopify variant id) → j3 (cart, uses variant id)
//   → j5 (reads cached LCPs + measures PLP fresh) → j6 (Arabic)
const JOURNEYS = [j4, j1, j2, j3, j5, j6];

const RUN_TIMESTAMP = new Date().toISOString();
const RUN_DATE = RUN_TIMESTAMP.slice(0, 10);

async function main() {
  const startTime = Date.now();
  const browser = await chromium.launch();
  const siteReports = [];

  for (const site of SITES) {
    console.log(`\n=== ${site.name} (${site.region}) ===`);
    try {
      const report = await runSite(browser, site);
      siteReports.push(report);
      const s = report.summary;
      console.log(`  ${s.pass} pass / ${s.warning} warn / ${s.fail} fail / ${s.skip} skip (${s.total} total)`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      siteReports.push({
        id: site.id,
        name: site.name,
        region: site.region,
        error: err.message,
        summary: { total: 0, pass: 0, warning: 0, fail: 1, skip: 0, passRate: 0, status: 'fail' },
        checks: [],
      });
    }
  }

  await browser.close();

  const runTimeMs = Date.now() - startTime;
  const warrantyTiers = SITES.reduce((acc, s) => {
    acc[s.id] = s.warrantyTiers.map((t) => ({
      maxPrice: t.maxPrice === Infinity ? null : t.maxPrice,
      warranty: t.warranty,
    }));
    return acc;
  }, {});

  const report = {
    date: RUN_DATE,
    timestamp: RUN_TIMESTAMP,
    runTimeMs,
    sites: siteReports,
    warrantyTiers,
  };

  if (!existsSync('reports')) mkdirSync('reports');
  const filepath = `reports/${RUN_DATE}.json`;
  writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`\nJSON  → ${filepath}`);
  console.log(`Run time: ${(runTimeMs / 1000).toFixed(1)}s`);
}

async function runSite(browser, site) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const ctx = {};
  const failedImageRequests = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && response.request().resourceType() === 'image') {
      failedImageRequests.push({ url: response.url(), status: response.status() });
    }
  });

  const checks = [];
  let journeyIdx = 0;
  for (const journey of JOURNEYS) {
    // Small pause between journeys lowers request cadence and reduces
    // intermittent Cloudflare bot-challenge interception.
    if (journeyIdx > 0) await sleep(1500);
    journeyIdx++;
    console.log(`  → ${journey.id}`);
    let journeyChecks = [];
    try {
      journeyChecks = await journey.run(page, site, ctx);
    } catch (err) {
      console.error(`    journey ${journey.id} threw: ${err.message}`);
      journeyChecks = [
        {
          id: `${journey.id}-error`,
          category: 'meta',
          description: `Journey ${journey.id} threw an error during execution`,
          status: 'fail',
          details: { error: err.message, stack: (err.stack || '').split('\n').slice(0, 5).join('\n') },
        },
      ];
    }
    for (const c of journeyChecks) {
      c.journey = journey.id;
      c.journeyName = journey.name;
    }
    checks.push(...journeyChecks);
  }

  checks.push({
    id: 'image-network-ok',
    journey: 'meta',
    journeyName: 'Cross-journey',
    category: 'visual',
    description: 'All image network requests returned 2xx/3xx across this session',
    status: failedImageRequests.length === 0 ? 'pass' : 'warning',
    details: { failedCount: failedImageRequests.length, samples: failedImageRequests.slice(0, 5) },
  });

  await context.close();
  return summarize(site, checks);
}

function summarize(site, checks) {
  const counts = { pass: 0, warning: 0, fail: 0, skip: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
  const scoreable = counts.pass + counts.warning + counts.fail;
  return {
    id: site.id,
    name: site.name,
    region: site.region,
    summary: {
      total: checks.length,
      pass: counts.pass,
      warning: counts.warning,
      fail: counts.fail,
      skip: counts.skip,
      passRate: scoreable > 0 ? Math.round((counts.pass / scoreable) * 100) : 0,
      status: counts.fail > 0 ? 'fail' : counts.warning > 0 ? 'warning' : 'pass',
    },
    checks,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('Run failed:', err);
  process.exit(1);
});
