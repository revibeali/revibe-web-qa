// Implements Journey 2 (PDP) from the Revibe Daily QA doc.
// Source-of-truth for intent: https://docs.google.com/document/d/1IZbKwnGIuAgyVXM24bLeKS2HFtziUgt6Y9raC32yYbk/
// Code = deterministic subset; qualitative items (visual/translation judgment) live in the doc only.

import {
  measureLCP,
  lcpStatus,
  expectedWarranty,
  fetchShopifyProductJson,
  getWarrantyCardText,
  extractDisplayedWarranty,
} from '../helpers.js';

const WARRANTY_HEADING = 'get full protection and warranty for 24 months';

export default {
  id: 'j2-pdp',
  name: 'PDP',
  async run(page, site, ctx) {
    const checks = [];

    if (!ctx.plpFirstProductPath) {
      try {
        await page.goto(site.baseUrl + site.plpPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        ctx.plpFirstProductPath = await page.evaluate(() => {
          const a = document.querySelector('a[href*="/products/"]');
          if (!a) return null;
          try { return new URL(a.href).pathname; } catch (_) { return null; }
        });
      } catch (_) {}
    }

    if (!ctx.plpFirstProductPath) {
      const ids = ['pdp-loads', 'pdp-lcp', 'pdp-compare-gt-price', 'pdp-warranty-heading', 'pdp-warranty-tier-math', 'pdp-cashback-reasonable'];
      for (const id of ids) {
        checks.push({
          id,
          category: 'meta',
          description: id,
          status: 'skip',
          details: { todo: 'No product URL captured from PLP' },
        });
      }
      return checks;
    }

    const pdpUrl = site.baseUrl + ctx.plpFirstProductPath;
    let lcpMs = 0;
    let response;
    try {
      const result = await measureLCP(page, pdpUrl);
      response = result.response;
      lcpMs = result.lcpMs;
      ctx.pdpLcpMs = lcpMs;
    } catch (err) {
      checks.push({
        id: 'pdp-loads',
        category: 'functional',
        description: 'PDP loads with 2xx response',
        status: 'fail',
        details: { url: pdpUrl, error: err.message },
      });
      return checks;
    }

    checks.push({
      id: 'pdp-loads',
      category: 'functional',
      description: 'PDP loads with 2xx response',
      status: response.status() < 400 ? 'pass' : 'fail',
      details: { url: pdpUrl, status: response.status() },
    });

    checks.push({
      id: 'pdp-lcp',
      category: 'performance',
      description: 'PDP LCP under thresholds (pass <2.5s, warn 2.5-4s, fail >4s)',
      status: lcpStatus(lcpMs),
      details: { url: pdpUrl, lcpMs },
    });

    const product = await fetchShopifyProductJson(page, ctx.plpFirstProductPath);
    if (!product || !product.variants || product.variants.length === 0) {
      for (const id of ['pdp-compare-gt-price', 'pdp-warranty-heading', 'pdp-warranty-tier-math', 'pdp-cashback-reasonable']) {
        checks.push({
          id,
          category: 'meta',
          description: id,
          status: 'skip',
          details: { todo: 'Could not load Shopify product JSON' },
        });
      }
      return checks;
    }

    const variant = product.variants[0];
    const priceCents = variant.price;
    const compareCents = variant.compare_at_price;
    const price = Math.round(priceCents / 100);
    const compare = compareCents ? Math.round(compareCents / 100) : 0;
    ctx.pdpProduct = {
      handle: product.handle,
      title: product.title,
      url: pdpUrl,
      price,
      compare,
      variantId: variant.id,
    };

    const compareStatus = compare > 0 && compare > price ? 'pass' : compare === 0 ? 'warning' : 'fail';
    checks.push({
      id: 'pdp-compare-gt-price',
      category: 'math',
      description: 'PDP compare-at price is greater than actual price',
      status: compareStatus,
      details: { url: pdpUrl, title: product.title, price, compare, currency: site.currency.code },
    });

    const bodyText = ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ');
    const headingFound = bodyText.toLowerCase().includes(WARRANTY_HEADING);
    checks.push({
      id: 'pdp-warranty-heading',
      category: 'content',
      description: 'Warranty card heading "Get full protection and warranty for 24 months" present on PDP',
      status: headingFound ? 'pass' : 'fail',
      details: { url: pdpUrl, found: headingFound },
    });

    const tier = site.warrantyTiers.find((t) => price <= t.maxPrice) || null;
    const expected = tier?.warranty ?? expectedWarranty(price, site.warrantyTiers);
    if (expected == null) {
      checks.push({
        id: 'pdp-warranty-tier-math',
        category: 'math',
        description: 'Displayed warranty price matches canonical tier for product price',
        status: 'skip',
        details: { todo: 'No tier matched', productPrice: price },
      });
    } else {
      const warrantyArea = await getWarrantyCardText(page, WARRANTY_HEADING);
      const displayed = extractDisplayedWarranty(
        warrantyArea,
        WARRANTY_HEADING,
        site.currency.code,
        site.currency.symbols
      );
      let status;
      if (displayed == null) status = 'fail';
      else if (displayed === expected) status = 'pass';
      else status = 'fail';
      checks.push({
        id: 'pdp-warranty-tier-math',
        category: 'math',
        description: 'Displayed warranty price matches canonical tier for product price',
        status,
        details: {
          url: pdpUrl,
          productPrice: price,
          expectedWarranty: expected,
          displayedWarranty: displayed,
          currency: site.currency.code,
          match: displayed === expected,
          tierHandle: tier?.handle ?? null,
          tierProductId: tier?.productId ?? null,
          cardSnippet: warrantyArea.slice(0, 400),
        },
      });
    }

    // Cashback reshape: "Reasonable cashback" -> present AND non-zero.
    // Per QA doc the feature is currently On Hold; present-with-zero and absent both -> skip.
    const cashbackInfo = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const lower = text.toLowerCase();
      let idx = lower.indexOf('cashback');
      if (idx < 0) idx = lower.indexOf('cash back');
      if (idx < 0) return { present: false, amount: 0, snippet: '' };
      const snippet = text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + 100));
      const region = text.slice(Math.max(0, idx - 30), Math.min(text.length, idx + 80));
      const m = region.match(/(\d+(?:[.,]\d{1,2})?)/);
      const amount = m ? parseFloat(m[1].replace(',', '.')) : 0;
      return { present: true, amount, snippet };
    });
    let cashbackStatus;
    let cashbackTodo = null;
    if (!cashbackInfo.present) {
      cashbackStatus = 'skip';
      cashbackTodo = 'Cashback widget not visible (feature currently On Hold per QA doc)';
    } else if (cashbackInfo.amount > 0) {
      cashbackStatus = 'pass';
    } else {
      cashbackStatus = 'skip';
      cashbackTodo = 'Cashback widget visible but amount = 0 (feature On Hold per QA doc)';
    }
    checks.push({
      id: 'pdp-cashback-reasonable',
      category: 'content',
      description: 'Cashback widget present AND amount > 0 (skipped while feature On Hold per QA doc)',
      status: cashbackStatus,
      details: { url: pdpUrl, todo: cashbackTodo, ...cashbackInfo },
    });

    return checks;
  },
};
