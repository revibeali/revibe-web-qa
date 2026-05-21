// Implements Journey J07 — PDP Variant & Pricing (per Revibe Master QA Test Library).
// Sheet: https://docs.google.com/spreadsheets/d/1-cKrw7J7y98er5KksdCEteQqz67lkdoU5QUKaHYVLv0/

import { ensurePDPLoaded } from '../helpers.js';

const CHECK_IDS = ['pdp-loads', 'pdp-compare-gt-price', 'pdp-variant-url-changes-price'];

export default {
  id: 'j07-pdp-variant-pricing',
  journeyCode: 'J07',
  frequency: 'weekly',
  priority: 'critical',
  name: 'PDP Variant & Pricing',
  async run(page, site, ctx) {
    const checks = [];
    const setup = await ensurePDPLoaded(page, site, ctx);
    if (!setup.ok) {
      const cdnBlocked = setup.reason === 'cdn-blocked';
      const reasonText = cdnBlocked
        ? `Product pages were blocked by the site's bot protection (HTTP ${setup.status}) during this run — could not test.`
        : `Product pages could not be loaded after 3 retries — could not test. Most likely a transient slowdown, not a site outage.`;
      // pdp-loads carries the signal. A bot-block is a "skip" (not our fault, not
      // a real defect); a genuine unreachable PDP is a fail flagged as
      // infrastructure so the summary frames it as "couldn't test", not "broken".
      checks.push({
        id: 'pdp-loads',
        category: 'functional',
        description: 'PDP loads with 2xx response',
        status: cdnBlocked ? 'skip' : 'fail',
        details: { failureType: 'infrastructure', reason: setup.reason, humanReason: reasonText },
      });
      for (const id of ['pdp-compare-gt-price', 'pdp-variant-url-changes-price']) {
        checks.push({
          id, category: 'meta', description: id,
          status: 'skip',
          details: { todo: reasonText, failureType: 'infrastructure', reason: setup.reason },
        });
      }
      return checks;
    }
    const { product } = setup;
    const pdpUrl = product.url;

    // pdp-loads (from setup response status)
    const status = setup.response?.status() ?? 0;
    checks.push({
      id: 'pdp-loads',
      category: 'functional',
      description: 'PDP loads with 2xx response',
      status: status > 0 && status < 400 ? 'pass' : 'fail',
      details: { url: pdpUrl, status },
    });

    // pdp-compare-gt-price
    const compareStatus = product.compare > 0 && product.compare > product.price ? 'pass'
      : product.compare === 0 ? 'warning' : 'fail';
    checks.push({
      id: 'pdp-compare-gt-price',
      category: 'math',
      description: 'PDP compare-at price is greater than actual price',
      status: compareStatus,
      details: { url: pdpUrl, title: product.title, price: product.price, compare: product.compare, currency: site.currency.code },
    });

    // pdp-variant-url-changes-price
    const variants = product.variants;
    if (variants && variants.length >= 2) {
      const v1 = variants[0];
      const v2 = variants.find((v) => v.price !== v1.price) || variants[1];
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
        let s;
        if (v1PriceMajor === v2PriceMajor) s = 'skip';
        else if (v2Shown) s = 'pass';
        else s = 'fail';
        checks.push({
          id: 'pdp-variant-url-changes-price',
          category: 'functional',
          description: 'Navigating ?variant=<id> shows that variant\'s price',
          status: s,
          details: {
            url: variantUrl,
            v1Price: v1PriceMajor,
            v2Price: v2PriceMajor,
            v2Shown,
            v1NoLongerInTopOfPage: v1NoLongerSole,
            todo: s === 'skip' ? 'All variants share the same price; can\'t prove price change' : null,
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
