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
      ctx.pdpCls = result.cls;
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

    // ---- Bucket A: deterministic widget presence checks ----

    // Trustpilot: heading + non-zero plausible review count
    const trustpilot = await page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      const hasHeading = /trustpilot/i.test(text);
      // Match patterns like "1,234 reviews" / "based on 567 reviews"
      const m = (document.body.innerText || '').match(/(\d{1,3}(?:[,]\d{3})*|\d+)\s*(?:reviews?|ratings?)/i);
      const count = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
      return { hasHeading, count };
    });
    let trustpilotStatus;
    if (!trustpilot.hasHeading) trustpilotStatus = 'skip';
    else if (trustpilot.count > 0) trustpilotStatus = 'pass';
    else trustpilotStatus = 'warning';
    checks.push({
      id: 'pdp-trustpilot-present',
      category: 'content',
      description: 'Trustpilot widget rendered with non-zero review count',
      status: trustpilotStatus,
      details: { url: pdpUrl, ...trustpilot, todo: trustpilotStatus === 'skip' ? 'Trustpilot widget not on this PDP' : null },
    });

    // Related / Recommended products: at least 3 product cards under such a section
    const relatedCount = await page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      const headingIdx = Math.max(text.indexOf('recommended'), text.indexOf('related'), text.indexOf('you may also'));
      if (headingIdx < 0) return 0;
      // Count distinct /products/ links AFTER the heading
      const allLinks = Array.from(document.querySelectorAll('a[href*="/products/"]'));
      const headingEl = (function () {
        for (const el of document.querySelectorAll('h1,h2,h3,h4')) {
          const t = (el.innerText || '').toLowerCase();
          if (t.includes('recommended') || t.includes('related') || t.includes('you may also')) return el;
        }
        return null;
      })();
      if (!headingEl) return 0;
      const set = new Set();
      let node = headingEl;
      while ((node = node.nextElementSibling) || (node = headingEl.parentElement && headingEl.parentElement.nextElementSibling)) {
        if (!node) break;
        node.querySelectorAll('a[href*="/products/"]').forEach((a) => {
          try { set.add(new URL(a.href).pathname); } catch (_) {}
        });
        if (set.size >= 8) break;
        if (!node.nextElementSibling) break;
      }
      return set.size;
    });
    checks.push({
      id: 'pdp-related-products-count',
      category: 'content',
      description: 'Recommended/Related section has ≥3 product cards',
      status: relatedCount >= 3 ? 'pass' : relatedCount > 0 ? 'warning' : 'fail',
      details: { url: pdpUrl, count: relatedCount },
    });

    // "What's Included" for smartphone: Charger + Mobile both appear
    const whatsIncluded = await page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      const sectionPresent = text.includes("what's included") || text.includes('whats included') || text.includes('what is included');
      const hasCharger = /\bcharger\b/.test(text);
      const hasMobile = /\bmobile\b/.test(text) || /\bphone\b/.test(text);
      return { sectionPresent, hasCharger, hasMobile };
    });
    let wiStatus;
    if (!whatsIncluded.sectionPresent) wiStatus = 'skip';
    else if (whatsIncluded.hasCharger && whatsIncluded.hasMobile) wiStatus = 'pass';
    else wiStatus = 'warning';
    checks.push({
      id: 'pdp-whats-included-smartphone',
      category: 'content',
      description: '"What\'s Included" lists Charger AND Mobile/Phone for smartphone PDPs',
      status: wiStatus,
      details: { url: pdpUrl, ...whatsIncluded, todo: wiStatus === 'skip' ? "'What's Included' section not found" : null },
    });

    // Technical Specification: section present and non-empty
    const techSpec = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      const heading = headings.find((h) => /technical\s*specification|specifications?/i.test(h.innerText || ''));
      if (!heading) return { present: false, length: 0 };
      let sibling = heading.parentElement;
      let extracted = '';
      if (sibling) extracted = (sibling.innerText || '').slice(0, 1000);
      return { present: true, length: extracted.length };
    });
    checks.push({
      id: 'pdp-tech-spec-present',
      category: 'content',
      description: 'Technical Specification section present and non-empty',
      status: techSpec.present && techSpec.length > 80 ? 'pass' : techSpec.present ? 'warning' : 'fail',
      details: { url: pdpUrl, ...techSpec },
    });

    // USP icons: Certified by Experts · Unlocked · 12 Months Warranty · Free Delivery
    const usp = await page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      const items = {
        certified: /certified by experts|certified renewed/i.test(text),
        unlocked: /unlocked/i.test(text),
        warranty12: /12\s*months?\s*warranty/i.test(text),
        freeDelivery: /free\s*(delivery|shipping)/i.test(text),
      };
      const count = Object.values(items).filter(Boolean).length;
      return { items, count };
    });
    checks.push({
      id: 'pdp-usp-icons-all-four',
      category: 'content',
      description: 'PDP USP strip mentions Certified · Unlocked · 12 Months Warranty · Free Delivery (≥3 of 4)',
      status: usp.count >= 4 ? 'pass' : usp.count >= 3 ? 'warning' : 'fail',
      details: { url: pdpUrl, ...usp },
    });

    // ---- Bucket B: PDP variant URL changes price ----
    // Visit ?variant=<second variant id>, verify the displayed price differs.
    if (product.variants.length >= 2) {
      const v1 = product.variants[0];
      const v2 = product.variants.find((v) => v.price !== v1.price) || product.variants[1];
      const v2PriceMajor = Math.round(v2.price / 100);
      const v1PriceMajor = Math.round(v1.price / 100);
      const variantUrl = `${pdpUrl}?variant=${v2.id}`;
      try {
        await page.goto(variantUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        const variantText = (await page.textContent('body').catch(() => '')) || '';
        const v2Pattern = new RegExp(`(?<!\\d)${v2PriceMajor}(?:[,\\s]\\d{3})*(?!\\d)`);
        const v2Shown = v2Pattern.test(variantText.replace(/\s+/g, ' '));
        const v1NoLongerSole = !new RegExp(`(?<!\\d)${v1PriceMajor}(?:[,\\s]\\d{3})*(?!\\d)`).test(variantText.slice(0, 2000));
        let status;
        if (v1PriceMajor === v2PriceMajor) status = 'skip';
        else if (v2Shown) status = 'pass';
        else status = 'fail';
        checks.push({
          id: 'pdp-variant-url-changes-price',
          category: 'functional',
          description: 'Navigating ?variant=<id> shows that variant\'s price',
          status,
          details: {
            url: variantUrl,
            v1Price: v1PriceMajor,
            v2Price: v2PriceMajor,
            v2Shown,
            v1NoLongerInTopOfPage: v1NoLongerSole,
            todo: status === 'skip' ? 'All variants share the same price; can\'t prove price change' : null,
          },
        });
      } catch (err) {
        checks.push({
          id: 'pdp-variant-url-changes-price',
          category: 'functional',
          description: 'Navigating ?variant=<id> shows that variant\'s price',
          status: 'fail',
          details: { url: variantUrl, error: err.message },
        });
      }
    } else {
      checks.push({
        id: 'pdp-variant-url-changes-price',
        category: 'functional',
        description: 'Navigating ?variant=<id> shows that variant\'s price',
        status: 'skip',
        details: { todo: 'Product has only one variant' },
      });
    }

    return checks;
  },
};
