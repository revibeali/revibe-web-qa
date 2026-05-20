import { chromium, devices } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { SITES } from './sites.js';

// Phase-1 priority journeys (built out with real checks)
import j01 from './journeys/j01-critical-path-smoke.js';
import j04 from './journeys/j04-commerce-smoke.js';
import j06 from './journeys/j06-plp-deep.js';
import j07 from './journeys/j07-pdp-variant-pricing.js';
import j08 from './journeys/j08-pdp-widgets-trust.js';
import j09 from './journeys/j09-pdp-content-spec.js';
import j10 from './journeys/j10-atc-warranty-flow.js';
import j11 from './journeys/j11-cart-checkout-deep.js';

// Phase-2 journeys (existing 47 checks, renamed to new codes; checks stay byte-for-byte)
import j02 from './journeys/j02-site-health.js';
import j03 from './journeys/j03-performance.js';
import j12 from './journeys/j12-localization.js';

import { renderHTML } from './render-html.js';

// Execution order — dependency-driven, not numeric.
// j02 (site health = homepage init, captures homepage LCP into ctx)
//   -> j06 (PLP, captures product paths)
//   -> j07 (PDP setup; J08/J09/J10/J04 reuse ctx.pdpProduct)
//   -> j08, j09, j10
//   -> j04 (commerce smoke; reuses PDP)
//   -> j11 (cart + checkout)
//   -> j03 (performance — reads cached LCP/CLS from ctx)
//   -> j12 (Arabic, separate page)
//   -> j01 (per-deploy smoke; chained, navigates fresh)
const JOURNEYS = [j02, j06, j07, j08, j09, j10, j04, j11, j03, j12, j01];

const RUN_TIMESTAMP = new Date().toISOString();
const RUN_DATE = RUN_TIMESTAMP.slice(0, 10);

// FREQUENCY, PRIORITY, JOURNEY are comma-separated env vars. Empty = no filter.
const FILTER = {
  frequency: parseCsv(process.env.FREQUENCY),
  priority: parseCsv(process.env.PRIORITY),
  journey: parseCsv(process.env.JOURNEY),
};
function parseCsv(v) { return (v || '').split(',').map((s) => s.trim()).filter(Boolean); }
function journeyMatchesFilter(j) {
  if (FILTER.journey.length > 0 && !FILTER.journey.includes(j.journeyCode)) return false;
  if (FILTER.frequency.length > 0 && !FILTER.frequency.includes(j.frequency)) return false;
  if (FILTER.priority.length > 0 && !FILTER.priority.includes(j.priority)) return false;
  return true;
}

async function main() {
  const startTime = Date.now();
  const matched = JOURNEYS.filter(journeyMatchesFilter);
  const filterApplied = FILTER.frequency.length + FILTER.priority.length + FILTER.journey.length > 0;
  console.log(`\nJourneys: ${matched.length}/${JOURNEYS.length} selected${filterApplied ? ` (filter: ${JSON.stringify(FILTER)})` : ''}`);
  if (matched.length === 0) {
    console.log('No journeys matched the filter. Exiting.');
    process.exit(0);
  }

  const browser = await chromium.launch();
  const siteReports = [];
  for (const site of SITES) {
    console.log(`\n=== ${site.name} (${site.region}) ===`);
    try {
      const report = await runSite(browser, site, matched);
      siteReports.push(report);
      const s = report.summary;
      console.log(`  ${s.pass} pass / ${s.warning} warn / ${s.fail} fail / ${s.skip} skip (${s.total} total)`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      siteReports.push({
        id: site.id, name: site.name, region: site.region, error: err.message,
        summary: { total: 0, pass: 0, warning: 0, fail: 1, skip: 0, passRate: 0, status: 'fail' },
        checks: [],
      });
    }
  }
  await browser.close();

  const runTimeMs = Date.now() - startTime;
  const warrantyTiers = SITES.reduce((acc, s) => {
    acc[s.id] = s.warrantyTiers.map((t) => ({ maxPrice: t.maxPrice === Infinity ? null : t.maxPrice, warranty: t.warranty }));
    return acc;
  }, {});

  // Regression diff vs the most recent prior report (if any)
  const diff = computeRegressionDiff(RUN_DATE, siteReports);

  const report = {
    date: RUN_DATE,
    timestamp: RUN_TIMESTAMP,
    runTimeMs,
    filter: { ...FILTER, applied: filterApplied, journeysMatched: matched.length, journeysTotal: JOURNEYS.length },
    diff,
    sites: siteReports,
    warrantyTiers,
  };

  if (!existsSync('reports')) mkdirSync('reports');
  const jsonPath = `reports/${RUN_DATE}.json`;
  const htmlPath = `reports/${RUN_DATE}.html`;
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(htmlPath, renderHTML(report));
  console.log(`\nJSON  → ${jsonPath}`);
  console.log(`HTML  → ${htmlPath}`);
  syncDashboardData();
  console.log(`Dashboard data → docs/reports/`);
  console.log(`Run time: ${(runTimeMs / 1000).toFixed(1)}s`);
}

function syncDashboardData() {
  if (!existsSync('docs')) mkdirSync('docs');
  if (!existsSync('docs/reports')) mkdirSync('docs/reports');
  const allFiles = readdirSync('reports');
  const jsonFiles = allFiles.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const htmlFiles = allFiles.filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f));
  for (const f of [...jsonFiles, ...htmlFiles]) {
    copyFileSync(join('reports', f), join('docs/reports', f));
  }
  const dates = jsonFiles.map((f) => f.replace('.json', '')).sort();
  writeFileSync(join('docs/reports', 'index.json'), JSON.stringify({ dates }, null, 2));

  // Mirror today's screenshots into docs/reports/screenshots/<date>/ for Pages access.
  const todayShots = join('reports', 'screenshots', RUN_DATE);
  if (existsSync(todayShots)) {
    mirrorDir(todayShots, join('docs/reports/screenshots', RUN_DATE));
  }
  // 30-day retention: prune older dated screenshot directories.
  pruneOldScreenshots('reports/screenshots', 30);
  pruneOldScreenshots('docs/reports/screenshots', 30);
}

function mirrorDir(src, dst) {
  if (!existsSync(src)) return;
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const st = statSync(s);
    if (st.isDirectory()) mirrorDir(s, d);
    else copyFileSync(s, d);
  }
}

function pruneOldScreenshots(root, keepDays) {
  if (!existsSync(root)) return;
  const cutoff = new Date(Date.now() - keepDays * 24 * 3600 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const name of readdirSync(root)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < cutoffStr) {
      try { rmSync(join(root, name), { recursive: true, force: true }); } catch (_) {}
    }
  }
}

// Compares this run against the most recent prior report (different date) and
// returns { newlyBroken, newlyFixed, stillBroken } as arrays of {site,id,description}.
function computeRegressionDiff(currentDate, siteReports) {
  if (!existsSync('reports')) return null;
  const priors = readdirSync('reports')
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith(currentDate))
    .sort()
    .reverse();
  if (priors.length === 0) return { hasBaseline: false };
  let prior;
  try { prior = JSON.parse(readFileSync(join('reports', priors[0]), 'utf8')); }
  catch (_) { return { hasBaseline: false }; }
  const priorChecks = new Map();
  for (const s of prior.sites || []) {
    for (const c of s.checks || []) {
      priorChecks.set(`${s.id}::${c.id}`, c.status);
    }
  }
  const newlyBroken = [], newlyFixed = [], stillBroken = [];
  for (const s of siteReports) {
    for (const c of s.checks || []) {
      const key = `${s.id}::${c.id}`;
      const prev = priorChecks.get(key);
      if (c.status === 'fail' && prev && prev !== 'fail') {
        newlyBroken.push({ site: s.name, id: c.id, description: c.description, was: prev });
      } else if (c.status !== 'fail' && prev === 'fail') {
        newlyFixed.push({ site: s.name, id: c.id, description: c.description, now: c.status });
      } else if (c.status === 'fail' && prev === 'fail') {
        stillBroken.push({ site: s.name, id: c.id, description: c.description });
      }
    }
  }
  return {
    hasBaseline: true,
    baselineDate: prior.date,
    newlyBroken,
    newlyFixed,
    stillBroken,
  };
}

async function runSite(browser, site, journeysToRun) {
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
  for (const journey of journeysToRun) {
    if (journeyIdx > 0) await sleep(1500);
    journeyIdx++;
    console.log(`  → ${journey.id}`);
    let journeyChecks = [];
    try {
      journeyChecks = await journey.run(page, site, ctx);
    } catch (err) {
      console.error(`    journey ${journey.id} threw: ${err.message}`);
      journeyChecks = [{
        id: `${journey.id}-error`, category: 'meta',
        description: `Journey ${journey.id} threw an error during execution`,
        status: 'fail',
        details: { error: err.message, stack: (err.stack || '').split('\n').slice(0, 5).join('\n') },
      }];
    }
    for (const c of journeyChecks) {
      c.journey = journey.id;
      c.journeyName = journey.name;
      c.journeyCode = journey.journeyCode || null;
      c.journeyFrequency = journey.frequency || null;
      c.journeyPriority = journey.priority || null;
    }
    // Screenshot-on-fail: if any check in this journey failed, snapshot the
    // current page state. One PNG per (site, journey) shared by its failures.
    const journeyHasFail = journeyChecks.some((c) => c.status === 'fail');
    if (journeyHasFail) {
      const relPath = join('screenshots', RUN_DATE, site.id, `${journey.id}.png`);
      const absPath = join('reports', relPath);
      try {
        mkdirSync(join('reports', 'screenshots', RUN_DATE, site.id), { recursive: true });
        await page.screenshot({ path: absPath, fullPage: false, timeout: 5000 });
        for (const c of journeyChecks) {
          if (c.status === 'fail') {
            c.details = { ...(c.details || {}), screenshot: relPath };
          }
        }
      } catch (e) {
        console.log(`    (screenshot failed for ${journey.id}: ${e.message})`);
      }
    }
    checks.push(...journeyChecks);
  }

  checks.push({
    id: 'image-network-ok',
    journey: 'meta', journeyName: 'Cross-journey', journeyCode: null, journeyFrequency: null, journeyPriority: null,
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
    id: site.id, name: site.name, region: site.region,
    summary: {
      total: checks.length,
      pass: counts.pass, warning: counts.warning, fail: counts.fail, skip: counts.skip,
      passRate: scoreable > 0 ? Math.round((counts.pass / scoreable) * 100) : 0,
      status: counts.fail > 0 ? 'fail' : counts.warning > 0 ? 'warning' : 'pass',
    },
    checks,
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => { console.error('Run failed:', err); process.exit(1); });
