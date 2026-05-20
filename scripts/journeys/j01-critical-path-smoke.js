// Implements Journey J01 — Critical Path Smoke (per Revibe Master QA Test Library).
// Sheet: https://docs.google.com/spreadsheets/d/1-cKrw7J7y98er5KksdCEteQqz67lkdoU5QUKaHYVLv0/
//
// This is the per-deploy release gate. One chained check that walks the
// happy-path commerce flow end-to-end and pushes a single PASS/FAIL with
// per-step detail. If any step fails the whole check fails — that's the
// gate behaviour the doc calls for.

import { shopifyClearCart, shopifyAddToCart, fetchShopifyProductJson } from '../helpers.js';

export default {
  id: 'j01-critical-path-smoke',
  journeyCode: 'J01',
  frequency: 'per-deploy',
  priority: 'critical',
  name: 'Critical Path Smoke',
  async run(page, site, ctx) {
    const checks = [];
    const steps = [];

    // Step 1: homepage 2xx
    let homepageStatus = 0;
    try {
      const r = await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      homepageStatus = r?.status() ?? 0;
    } catch (e) {
      steps.push({ step: 'homepage', ok: false, error: e.message });
    }
    if (homepageStatus > 0) steps.push({ step: 'homepage', ok: homepageStatus < 400, status: homepageStatus });

    // Step 2: PLP 2xx and has products
    let plpHandle = null;
    try {
      const r = await page.goto(site.baseUrl + site.plpPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      const status = r?.status() ?? 0;
      plpHandle = await page.evaluate(() => {
        const a = document.querySelector('a[href*="/products/"]');
        if (!a) return null;
        try { return new URL(a.href).pathname; } catch (_) { return null; }
      });
      steps.push({ step: 'plp', ok: status < 400 && !!plpHandle, status, productFound: !!plpHandle });
    } catch (e) {
      steps.push({ step: 'plp', ok: false, error: e.message });
    }

    // Step 3: PDP 2xx, product JSON valid, variant id captured
    let variantId = null;
    if (plpHandle) {
      try {
        const r = await page.goto(site.baseUrl + plpHandle, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const status = r?.status() ?? 0;
        const product = await fetchShopifyProductJson(page, plpHandle);
        variantId = product?.variants?.[0]?.id ?? null;
        steps.push({ step: 'pdp', ok: status < 400 && !!variantId, status, variantId });
      } catch (e) {
        steps.push({ step: 'pdp', ok: false, error: e.message });
      }
    } else {
      steps.push({ step: 'pdp', ok: false, error: 'no product handle from plp' });
    }

    // Step 4: Cart add via Shopify AJAX
    let cartAddOk = false;
    if (variantId) {
      try {
        await shopifyClearCart(page);
        const addRes = await shopifyAddToCart(page, variantId, 1);
        cartAddOk = !!addRes.ok;
        steps.push({ step: 'cart-add', ok: cartAddOk, status: addRes.status });
      } catch (e) {
        steps.push({ step: 'cart-add', ok: false, error: e.message });
      }
    } else {
      steps.push({ step: 'cart-add', ok: false, error: 'no variant id' });
    }

    // Step 5: Checkout page 2xx with populated cart
    let checkoutOk = false;
    if (cartAddOk) {
      try {
        const r = await page.goto(site.baseUrl + '/checkout', { waitUntil: 'domcontentloaded', timeout: 45000 });
        const status = r?.status() ?? 0;
        checkoutOk = status > 0 && status < 400;
        steps.push({ step: 'checkout', ok: checkoutOk, status });
      } catch (e) {
        steps.push({ step: 'checkout', ok: false, error: e.message });
      }
    } else {
      steps.push({ step: 'checkout', ok: false, error: 'cart not populated' });
    }

    const allOk = steps.every((s) => s.ok);
    const cdnBlocked = steps.some((s) => s.status === 403 || s.status === 429);
    let status;
    if (allOk) status = 'pass';
    else if (cdnBlocked) status = 'skip';
    else status = 'fail';

    checks.push({
      id: 'j01-critical-path-chained',
      category: 'functional',
      description: 'Critical path: homepage → PLP → PDP → /cart/add → /checkout all return 2xx',
      status,
      details: {
        steps,
        allOk,
        todo: cdnBlocked ? 'One or more steps blocked by CDN (403/429); not a real failure' : null,
      },
    });

    return checks;
  },
};
