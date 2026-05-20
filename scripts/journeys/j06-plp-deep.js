// Implements Journey J06 — PLP Deep (per Revibe Master QA Test Library).
// Source-of-truth for intent: https://docs.google.com/document/d/1IZbKwnGIuAgyVXM24bLeKS2HFtziUgt6Y9raC32yYbk/
// Code = deterministic subset; qualitative items (visual/translation judgment) live in the doc only.

import { isChallengePage } from '../helpers.js';

const BANNER_PHRASES = [
  'certified renewed devices',
  'inspected by experts',
  'up to 70% cheaper than new',
];
const EMPTY_STATE_PHRASE = 'no products found';
const IMPOSSIBLE_FILTER_QS = '?filter.v.price.gte=999999999';
const SORT_ASC_QS = '?sort_by=price-ascending';
const SEARCH_QUERY = 'Samsung';

export default {
  id: 'j06-plp-deep',
  journeyCode: 'J06',
  frequency: 'weekly',
  priority: 'major',
  name: 'PLP',
  async run(page, site, ctx) {
    const checks = [];
    const plpBase = site.baseUrl + site.plpPath;
    let defaultOrder = [];

    // Banner sub-text + BNPL + capture first product handle
    try {
      await page.goto(plpBase, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const rawText = (await page.textContent('body').catch(() => '')) || '';
      if (isChallengePage(rawText)) {
        for (const id of ['plp-banner-text', 'plp-bnpl-logos']) {
          checks.push(skipChallenge(id, plpBase));
        }
      } else {
        const bodyText = rawText.replace(/\s+/g, ' ').toLowerCase();
        const missingPhrases = BANNER_PHRASES.filter((p) => !bodyText.includes(p));
        checks.push({
          id: 'plp-banner-text',
          category: 'content',
          description: 'PLP banner sub-text "Certified renewed devices - Inspected by Experts - Up to 70% cheaper than new" present',
          status: missingPhrases.length === 0 ? 'pass' : 'fail',
          details: { url: plpBase, expectedPhrases: BANNER_PHRASES, missingPhrases },
        });

        const foundProviders = await findBnplProviders(page, site.bnpl);
        const missingProviders = site.bnpl.filter((p) => !foundProviders.includes(p));
        checks.push({
          id: 'plp-bnpl-logos',
          category: 'localization',
          description: `BNPL providers ${site.bnpl.join(', ')} present on PLP`,
          status: missingProviders.length === 0 ? 'pass' : foundProviders.length > 0 ? 'warning' : 'fail',
          details: { url: plpBase, expected: site.bnpl, found: foundProviders, missing: missingProviders },
        });

        defaultOrder = await getProductOrder(page);
        ctx.plpFirstProductPath = defaultOrder[0] || null;
        ctx.plpProductPaths = defaultOrder.slice(0, 5);
      }
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

    // Empty-state on impossible filter
    try {
      const impossibleUrl = plpBase + IMPOSSIBLE_FILTER_QS;
      await page.goto(impossibleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const rawText = (await page.textContent('body').catch(() => '')) || '';
      if (isChallengePage(rawText)) {
        checks.push(skipChallenge('plp-empty-state', impossibleUrl));
      } else {
        const found = rawText.toLowerCase().includes(EMPTY_STATE_PHRASE);
        checks.push({
          id: 'plp-empty-state',
          category: 'content',
          description: 'Empty-state message "No products found..." appears on impossible filter combination',
          status: found ? 'pass' : 'fail',
          details: { url: impossibleUrl, expectedSubstring: 'No products found', found },
        });
      }
    } catch (err) {
      checks.push({
        id: 'plp-empty-state',
        category: 'content',
        description: 'Empty-state message on impossible filter combination',
        status: 'fail',
        details: { error: err.message },
      });
    }

    // Samsung search — also asserts category-appropriate heading (reshape rule)
    try {
      const searchUrl = `${site.baseUrl}/search?q=${encodeURIComponent(SEARCH_QUERY)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const rawText = (await page.textContent('body').catch(() => '')) || '';
      if (isChallengePage(rawText)) {
        checks.push(skipChallenge('plp-search-samsung', searchUrl));
      } else {
        const productCount = await page.evaluate(() => {
          const set = new Set();
          document.querySelectorAll('a[href*="/products/"]').forEach((a) => {
            try { set.add(new URL(a.href).pathname); } catch (_) { set.add(a.getAttribute('href') || ''); }
          });
          return set.size;
        });
        const h1Text = ((await page.textContent('h1').catch(() => '')) || '').trim();
        const headingOk = h1Text.toLowerCase().includes(SEARCH_QUERY.toLowerCase());
        let status;
        if (productCount >= 1 && headingOk) status = 'pass';
        else if (productCount >= 1 && !headingOk) status = 'warning';
        else status = 'fail';
        checks.push({
          id: 'plp-search-samsung',
          category: 'functional',
          description: 'Search "Samsung" returns >=1 product card AND heading mentions "Samsung"',
          status,
          details: { url: searchUrl, productCardCount: productCount, h1: h1Text.slice(0, 120), headingMentionsQuery: headingOk },
        });
      }
    } catch (err) {
      checks.push({
        id: 'plp-search-samsung',
        category: 'functional',
        description: 'Search "Samsung" returns >=1 product card AND heading mentions "Samsung"',
        status: 'fail',
        details: { error: err.message },
      });
    }

    // Sort-by-price-low-to-high
    try {
      if (defaultOrder.length === 0) {
        await page.goto(plpBase, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        const rawText = (await page.textContent('body').catch(() => '')) || '';
        if (isChallengePage(rawText)) {
          checks.push(skipChallenge('plp-sort-price-asc', plpBase));
          return checks;
        }
        defaultOrder = await getProductOrder(page);
        if (!ctx.plpFirstProductPath) ctx.plpFirstProductPath = defaultOrder[0] || null;
      }
      const sortUrl = plpBase + SORT_ASC_QS;
      await page.goto(sortUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const rawText = (await page.textContent('body').catch(() => '')) || '';
      if (isChallengePage(rawText)) {
        checks.push(skipChallenge('plp-sort-price-asc', sortUrl));
        return checks;
      }
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

    return checks;
  },
};

function skipChallenge(id, url) {
  return {
    id,
    category: 'meta',
    description: `${id} skipped — Cloudflare challenge intercepted ${url}`,
    status: 'skip',
    details: { url, todo: 'Cloudflare anti-bot challenge intercepted this page. Investigate stealth/UA tuning later.' },
  };
}

async function getProductOrder(page) {
  return await page.evaluate(() => {
    const seen = new Set();
    const order = [];
    document.querySelectorAll('a[href*="/products/"]').forEach((a) => {
      let pathname;
      try { pathname = new URL(a.href).pathname; } catch (_) { pathname = a.getAttribute('href') || ''; }
      if (!seen.has(pathname)) { seen.add(pathname); order.push(pathname); }
    });
    return order.slice(0, 8);
  });
}

async function findBnplProviders(page, providers) {
  return await page.evaluate((providers) => {
    const text = (document.body.innerText || '').toLowerCase();
    const imgInfo = Array.from(document.images)
      .map((i) => `${i.alt || ''} ${i.src || ''}`.toLowerCase())
      .join(' ');
    const haystack = text + ' ' + imgInfo;
    return providers.filter((p) => haystack.includes(p.toLowerCase()));
  }, providers);
}
