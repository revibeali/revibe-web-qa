// Reusable QA helpers: LCP+CLS measurement, broken-image detection,
// Shopify cart/product utilities, warranty math, Arabic detection.
// Designed to work on any page (homepage, PLP, PDP, cart, checkout).

export async function measureLCP(page, url, { timeout = 30000, idleTimeout = 15000 } = {}) {
  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          window.__lcp = last.renderTime || last.loadTime || last.startTime || 0;
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {
      // Browser doesn't expose LCP; __lcp stays 0.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (_) {
      // CLS not supported; __cls stays 0.
    }
  });
  const response = await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForLoadState('networkidle', { timeout: idleTimeout }).catch(() => {});
  const m = await page.evaluate(() => ({ lcp: window.__lcp || 0, cls: window.__cls || 0 }));
  return { lcpMs: Math.round(m.lcp), cls: Math.round(m.cls * 1000) / 1000, response };
}

export function lcpStatus(lcpMs) {
  if (!lcpMs || lcpMs <= 0) return 'fail';
  if (lcpMs < 2500) return 'pass';
  if (lcpMs <= 4000) return 'warning';
  return 'fail';
}

// Google's CLS thresholds: <0.1 good, 0.1-0.25 needs improvement, >0.25 poor.
export function clsStatus(cls) {
  if (cls == null) return 'skip';
  if (cls < 0.1) return 'pass';
  if (cls <= 0.25) return 'warning';
  return 'fail';
}

export async function findBrokenImages(page, { networkIdleTimeout = 10000 } = {}) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const height = document.documentElement.scrollHeight;
    window.scrollTo(0, height);
    await sleep(400);
    for (let y = height; y >= 0; y -= 600) {
      window.scrollTo(0, y);
      await sleep(80);
    }
    window.scrollTo(0, 0);
    await sleep(200);
  });
  await page.waitForLoadState('networkidle', { timeout: networkIdleTimeout }).catch(() => {});

  return await page.evaluate(() => {
    const pageHref = location.href;
    const pageNoHash = pageHref.split('#')[0];
    const pageNoQuery = pageNoHash.split('?')[0];
    const origin = location.origin;
    const originSlash = origin + '/';

    const isRealSrc = (src) => {
      if (!src) return false;
      const s = src.trim();
      if (!s) return false;
      if (s.startsWith('data:')) return false;
      if (s === pageHref || s === pageNoHash || s === pageNoQuery) return false;
      if (s === origin || s === originSlash) return false;
      return true;
    };

    return Array.from(document.images)
      .filter((img) => isRealSrc(img.src) && img.complete && img.naturalWidth === 0)
      .map((img) => img.src);
  });
}

// Detects Cloudflare interstitial / browser-verification challenge pages.
// These pages return HTTP 200 with bot-challenge content rather than the real site,
// so status-code checks alone miss them.
const CHALLENGE_RE = /your connection needs to be verified|verification successful\. waiting for|attention required|cf-browser-verification|just a moment\.\.\./i;
export function isChallengePage(text) {
  return CHALLENGE_RE.test(text || '');
}

export async function isChallengedNow(page) {
  try {
    const txt = await page.textContent('body');
    return isChallengePage(txt || '');
  } catch (_) {
    return false;
  }
}

export function expectedWarranty(price, tiers) {
  for (const tier of tiers) {
    if (price <= tier.maxPrice) return tier.warranty;
  }
  return null;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

export function containsArabic(text) {
  return ARABIC_RE.test(text || '');
}

export function containsLatinLetters(text) {
  return LATIN_LETTER_RE.test(text || '');
}

export async function fetchShopifyProductJson(page, handlePath) {
  return await page.evaluate(async (p) => {
    try {
      const res = await fetch(p + '.js');
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }, handlePath);
}

export async function shopifyClearCart(page) {
  return await page.evaluate(async () => {
    try {
      const res = await fetch('/cart/clear.js', { method: 'POST' });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, status: 0, error: String(e.message || e) };
    }
  });
}

export async function shopifyAddToCart(page, variantId, quantity = 1) {
  return await page.evaluate(
    async ({ id, qty }) => {
      try {
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, quantity: qty }),
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, bodyPreview: text.slice(0, 160) };
      } catch (e) {
        return { ok: false, status: 0, error: String(e.message || e) };
      }
    },
    { id: variantId, qty: quantity }
  );
}

export async function shopifyGetCart(page) {
  return await page.evaluate(async () => {
    try {
      const res = await fetch('/cart.js');
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  });
}

// Update a cart line's quantity. Use quantity=0 to remove.
// `line` is 1-indexed per Shopify's /cart/change.js contract.
export async function shopifyChangeCart(page, line, quantity) {
  return await page.evaluate(
    async ({ line, qty }) => {
      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ line, quantity: qty }),
        });
        if (!res.ok) return { ok: false, status: res.status };
        const body = await res.json();
        return { ok: true, status: res.status, body };
      } catch (e) {
        return { ok: false, status: 0, error: String(e.message || e) };
      }
    },
    { line, qty: quantity }
  );
}

export function warrantyDisplayPattern(amount, currencyCode, currencySymbols) {
  const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = [currencyCode, ...currencySymbols].map(escape).join('|');
  // Allow 0-15 non-digit chars between currency token and amount, either order.
  // Amount may carry optional decimals (e.g., 125.00).
  const amt = `${amount}(?:[\\.,]\\d{1,2})?(?!\\d)`;
  return new RegExp(
    `(?:(?:${tokens})[^\\d]{0,15}${amt}|(?<!\\d)${amt}[^\\d]{0,15}(?:${tokens}))`,
    'i'
  );
}

// Extracts the first currency+amount (either order) that appears AFTER the
// warranty heading inside the warranty card text. Returns the numeric amount
// or null if nothing parseable is found.
// Latin currency tokens (R/ZAR/AED/SAR) are wrapped in \b so they don't match
// inside English words like "warranty" or "years". Non-ASCII tokens (د.إ, ر.س)
// stay unbounded since \b doesn't behave usefully around non-\w characters.
export function extractDisplayedWarranty(cardText, headingFragmentLower, currencyCode, currencySymbols) {
  if (!cardText) return null;
  const idx = cardText.toLowerCase().indexOf(headingFragmentLower);
  if (idx < 0) return null;
  const after = cardText.slice(idx + headingFragmentLower.length, idx + headingFragmentLower.length + 600);
  const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = [currencyCode, ...currencySymbols].map((t) => {
    const e = escape(t);
    return /^[A-Za-z]+$/.test(t) ? `\\b${e}\\b` : e;
  }).join('|');
  const numPart = '(\\d{1,5}(?:[,\\s]\\d{3})*(?:\\.\\d{1,2})?)';
  const re = new RegExp(
    `(?:${tokens})[\\s\\u00A0]*${numPart}|(?<!\\d)${numPart}[\\s\\u00A0]*(?:${tokens})`,
    'i'
  );
  const m = after.match(re);
  if (!m) return null;
  const raw = m[1] || m[2];
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Shared PDP-setup helper used by every PDP-family journey (J07/J08/J09/J10).
// Idempotent — if ctx.pdpProduct is already populated, returns immediately
// so multiple journey files can reuse a single PDP navigation per site.
// Returns { ok, response, lcpMs, cls, product } describing the loaded PDP.
export async function ensurePDPLoaded(page, site, ctx) {
  if (ctx.pdpProduct?.url && ctx.pdpReady) {
    return { ok: true, fromCache: true, product: ctx.pdpProduct, lcpMs: ctx.pdpLcpMs, cls: ctx.pdpCls };
  }
  // Fall back to grabbing a PLP product handle if upstream j06 didn't capture it.
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
    return { ok: false, reason: 'no-product-path' };
  }
  const pdpUrl = site.baseUrl + ctx.plpFirstProductPath;
  let response, lcpMs = 0, cls = 0;
  try {
    const result = await measureLCP(page, pdpUrl);
    response = result.response;
    lcpMs = result.lcpMs;
    cls = result.cls;
    ctx.pdpLcpMs = lcpMs;
    ctx.pdpCls = cls;
  } catch (err) {
    return { ok: false, reason: 'pdp-nav-error', error: err.message };
  }
  const status = response?.status() ?? 0;
  if (status === 403 || status === 429) {
    return { ok: false, reason: 'cdn-blocked', status };
  }
  if (status >= 400) {
    return { ok: false, reason: 'http-error', status };
  }
  const product = await fetchShopifyProductJson(page, ctx.plpFirstProductPath);
  if (!product || !product.variants || product.variants.length === 0) {
    return { ok: false, reason: 'no-product-json', response, lcpMs, cls };
  }
  const variant = product.variants[0];
  ctx.pdpProduct = {
    handle: product.handle,
    title: product.title,
    url: pdpUrl,
    price: Math.round(variant.price / 100),
    compare: variant.compare_at_price ? Math.round(variant.compare_at_price / 100) : 0,
    variantId: variant.id,
    product,
  };
  ctx.pdpReady = true;
  return { ok: true, response, lcpMs, cls, product: ctx.pdpProduct };
}

export async function getWarrantyCardText(page, headingFragmentLower) {
  return await page.evaluate((heading) => {
    // Find the smallest (most-specific) element whose textContent includes the heading,
    // then climb a few levels to capture surrounding card content.
    const matches = [];
    document.querySelectorAll('*').forEach((el) => {
      const tc = (el.textContent || '').toLowerCase();
      if (tc.includes(heading)) matches.push({ el, len: tc.length });
    });
    if (matches.length === 0) return '';
    matches.sort((a, b) => a.len - b.len);
    let p = matches[0].el;
    for (let i = 0; i < 5 && p.parentElement; i++) p = p.parentElement;
    return (p.innerText || '') + ' ' + (p.textContent || '');
  }, headingFragmentLower);
}
