// Implements Journey J03 — Performance & Web Vitals (per Revibe Master QA Test Library).
// Source-of-truth for intent: https://docs.google.com/document/d/1IZbKwnGIuAgyVXM24bLeKS2HFtziUgt6Y9raC32yYbk/
// Code = deterministic subset; qualitative items (visual/translation judgment) live in the doc only.

import { measureLCP, lcpStatus, clsStatus } from '../helpers.js';

export default {
  id: 'j03-performance',
  journeyCode: 'J03',
  frequency: 'daily',
  priority: 'major',
  name: 'Page Speed (LCP across journeys)',
  async run(page, site, ctx) {
    const checks = [];

    pushLcpFromCtx(checks, 'homepage-lcp', 'Homepage LCP under thresholds (pass <2.5s, warn 2.5-4s, fail >4s)', ctx.homepageLcpMs, 'reused from j4-navigation');

    // Fresh PLP LCP measurement (j1 doesn't capture LCP).
    let plpLcp = 0;
    let plpErr = null;
    try {
      const result = await measureLCP(page, site.baseUrl + site.plpPath);
      plpLcp = result.lcpMs;
      ctx.plpLcpMs = plpLcp;
    } catch (err) {
      plpErr = err.message;
    }
    if (plpErr) {
      checks.push({
        id: 'plp-lcp',
        category: 'performance',
        description: 'PLP LCP under thresholds',
        status: 'fail',
        details: { error: plpErr },
      });
    } else {
      checks.push({
        id: 'plp-lcp',
        category: 'performance',
        description: 'PLP LCP under thresholds (pass <2.5s, warn 2.5-4s, fail >4s)',
        status: lcpStatus(plpLcp),
        details: { lcpMs: plpLcp, url: site.baseUrl + site.plpPath },
      });
    }

    pushLcpFromCtx(checks, 'pdp-lcp', 'PDP LCP under thresholds (pass <2.5s, warn 2.5-4s, fail >4s)', ctx.pdpLcpMs, 'reused from j2-pdp');
    pushLcpFromCtx(checks, 'cart-lcp', 'Cart LCP under thresholds (pass <2.5s, warn 2.5-4s, fail >4s)', ctx.cartLcpMs, 'reused from j3-cart');

    if (ctx.checkoutLcpMs != null) {
      checks.push({
        id: 'checkout-lcp',
        category: 'performance',
        description: 'Checkout LCP under thresholds',
        status: lcpStatus(ctx.checkoutLcpMs),
        details: { lcpMs: ctx.checkoutLcpMs, source: 'reused from j3-cart' },
      });
    } else {
      checks.push({
        id: 'checkout-lcp',
        category: 'performance',
        description: 'Checkout LCP under thresholds',
        status: 'skip',
        details: { todo: 'Checkout LCP not captured (cart unpopulated or external redirect)' },
      });
    }

    // ---- Bucket A: CLS (Cumulative Layout Shift) thresholds ----
    // Google's Core Web Vitals: <0.1 good, 0.1-0.25 needs improvement, >0.25 poor.
    pushClsFromCtx(checks, 'homepage-cls', 'Homepage CLS under thresholds (pass <0.1, warn 0.1-0.25, fail >0.25)', ctx.homepageCls, 'reused from j4-navigation');
    pushClsFromCtx(checks, 'pdp-cls', 'PDP CLS under thresholds (pass <0.1, warn 0.1-0.25, fail >0.25)', ctx.pdpCls, 'reused from j2-pdp');

    return checks;
  },
};

function pushClsFromCtx(checks, id, description, cls, source) {
  if (cls == null) {
    checks.push({
      id,
      category: 'performance',
      description,
      status: 'skip',
      details: { todo: `${id} not captured by earlier journey` },
    });
    return;
  }
  checks.push({
    id,
    category: 'performance',
    description,
    status: clsStatus(cls),
    details: { cls, source },
  });
}

function pushLcpFromCtx(checks, id, description, lcpMs, source) {
  if (lcpMs == null) {
    checks.push({
      id,
      category: 'performance',
      description,
      status: 'skip',
      details: { todo: `${id} not captured by earlier journey` },
    });
    return;
  }
  checks.push({
    id,
    category: 'performance',
    description,
    status: lcpStatus(lcpMs),
    details: { lcpMs, source },
  });
}
