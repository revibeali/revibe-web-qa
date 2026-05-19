// Implements Journey 3 (Cart) from the Revibe Daily QA doc.
// Source-of-truth for intent: https://docs.google.com/document/d/1IZbKwnGIuAgyVXM24bLeKS2HFtziUgt6Y9raC32yYbk/
// Code = deterministic subset; qualitative items (visual/translation judgment) live in the doc only.

import {
  measureLCP,
  shopifyClearCart,
  shopifyAddToCart,
  shopifyGetCart,
} from '../helpers.js';

export default {
  id: 'j3-cart',
  name: 'Cart',
  async run(page, site, ctx) {
    const checks = [];

    // 1. Add via Shopify AJAX (doesn't depend on cart page DOM)
    let addedOk = false;
    let addResult = null;
    if (ctx.pdpProduct?.variantId) {
      try {
        await shopifyClearCart(page);
        addResult = await shopifyAddToCart(page, ctx.pdpProduct.variantId, 1);
        addedOk = !!addResult.ok;
      } catch (e) {
        addResult = { ok: false, error: String(e.message || e) };
      }
    }
    if (addedOk) {
      checks.push({
        id: 'cart-add-via-api',
        category: 'functional',
        description: 'Cart populated via Shopify /cart/add.js (variant from j2 PDP)',
        status: 'pass',
        details: { variantId: ctx.pdpProduct.variantId, addResultStatus: addResult.status },
      });
    } else {
      checks.push({
        id: 'cart-add-via-api',
        category: 'functional',
        description: 'Cart populated via Shopify /cart/add.js (variant from j2 PDP)',
        status: 'skip',
        details: { todo: 'Variant ID unavailable or add failed', addResult },
      });
    }

    // 2. Verify cart contents via /cart.js (AJAX, no DOM nav needed)
    if (addedOk) {
      const cartJson = await shopifyGetCart(page);
      const items = cartJson?.items ?? [];
      const hasVariant = items.some((it) => it.variant_id === ctx.pdpProduct.variantId);
      checks.push({
        id: 'cart-shows-added-product',
        category: 'functional',
        description: 'Cart /cart.js contains the variant we just added',
        status: hasVariant ? 'pass' : 'fail',
        details: {
          itemCount: cartJson?.item_count ?? 0,
          expectedVariantId: ctx.pdpProduct.variantId,
          actualVariantIds: items.map((it) => it.variant_id),
        },
      });
    } else {
      checks.push({
        id: 'cart-shows-added-product',
        category: 'functional',
        description: 'Cart contains the variant added via API',
        status: 'skip',
        details: { todo: 'No product was added to cart' },
      });
    }

    // 3. Navigate to /cart page (LCP + BNPL DOM checks). May be CDN-blocked.
    let cartResponse, cartLcpMs = 0, cartBlocked = false, cartLoadErr = null;
    try {
      const result = await measureLCP(page, site.baseUrl + '/cart');
      cartResponse = result.response;
      cartLcpMs = result.lcpMs;
      const status = cartResponse?.status() ?? 0;
      if (status === 403 || status === 429) {
        cartBlocked = true;
      } else {
        ctx.cartLcpMs = cartLcpMs;
      }
    } catch (e) {
      cartLoadErr = e.message;
    }

    const cartStatus = cartResponse?.status() ?? 0;
    if (cartBlocked) {
      checks.push({
        id: 'cart-loads',
        category: 'functional',
        description: 'Cart page loads with 2xx response',
        status: 'skip',
        details: { status: cartStatus, todo: `HTTP ${cartStatus} on /cart — likely Cloudflare/Shopify anti-bot block. Skipped; investigate stealth mode or whitelisted UA later.` },
      });
      checks.push({
        id: 'cart-bnpl-logos',
        category: 'localization',
        description: `BNPL providers ${site.bnpl.join(', ')} present on cart page`,
        status: 'skip',
        details: { todo: `Cart page blocked (${cartStatus}); BNPL check skipped` },
      });
    } else if (cartLoadErr) {
      checks.push({
        id: 'cart-loads',
        category: 'functional',
        description: 'Cart page loads with 2xx response',
        status: 'fail',
        details: { error: cartLoadErr },
      });
      checks.push({
        id: 'cart-bnpl-logos',
        category: 'localization',
        description: `BNPL providers ${site.bnpl.join(', ')} present on cart page`,
        status: 'fail',
        details: { error: 'Cart page failed to load' },
      });
    } else {
      checks.push({
        id: 'cart-loads',
        category: 'functional',
        description: 'Cart page loads with 2xx response',
        status: cartStatus < 400 ? 'pass' : 'fail',
        details: { status: cartStatus },
      });

      const foundProviders = await page.evaluate((providers) => {
        const text = (document.body.innerText || '').toLowerCase();
        const imgInfo = Array.from(document.images)
          .map((i) => `${i.alt || ''} ${i.src || ''}`.toLowerCase())
          .join(' ');
        return providers.filter((p) => (text + ' ' + imgInfo).includes(p.toLowerCase()));
      }, site.bnpl);
      const missingProviders = site.bnpl.filter((p) => !foundProviders.includes(p));
      checks.push({
        id: 'cart-bnpl-logos',
        category: 'localization',
        description: `BNPL providers ${site.bnpl.join(', ')} present on cart page`,
        status: missingProviders.length === 0 ? 'pass' : foundProviders.length > 0 ? 'warning' : 'fail',
        details: { expected: site.bnpl, found: foundProviders, missing: missingProviders },
      });
    }

    // 4. Checkout — needs populated cart AND unblocked CDN
    if (!addedOk) {
      checks.push({
        id: 'checkout-loads',
        category: 'functional',
        description: 'Checkout page loads with populated cart',
        status: 'skip',
        details: { todo: 'Cart was not populated; cannot test checkout' },
      });
    } else if (cartBlocked) {
      checks.push({
        id: 'checkout-loads',
        category: 'functional',
        description: 'Checkout page loads with populated cart',
        status: 'skip',
        details: { todo: 'Cart page CDN-blocked; checkout likely affected too. Deferred.' },
      });
    } else {
      let checkoutLoaded = false;
      let checkoutLcpMs = 0;
      let checkoutStatus = 0;
      try {
        const result = await measureLCP(page, site.baseUrl + '/checkout', { timeout: 45000, idleTimeout: 8000 });
        checkoutStatus = result.response?.status() ?? 0;
        checkoutLoaded = checkoutStatus > 0 && checkoutStatus < 400;
        checkoutLcpMs = result.lcpMs;
        if (checkoutLoaded) ctx.checkoutLcpMs = checkoutLcpMs;
      } catch (_) {}
      checks.push({
        id: 'checkout-loads',
        category: 'functional',
        description: 'Checkout page loads with populated cart',
        status: checkoutLoaded ? 'pass' : (checkoutStatus === 403 || checkoutStatus === 429 ? 'skip' : 'fail'),
        details: {
          status: checkoutStatus,
          lcpMs: checkoutLcpMs,
          todo: !checkoutLoaded ? 'Checkout did not return 2xx — may redirect to external Shop Pay domain or be CDN-blocked' : null,
        },
      });
    }

    return checks;
  },
};
