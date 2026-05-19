// Reusable QA helpers: LCP measurement, broken-image detection,
// Shopify cart/product utilities, warranty math, Arabic detection.
// Designed to work on any page (homepage, PLP, PDP, cart, checkout).

export async function measureLCP(page, url, { timeout = 30000, idleTimeout = 15000 } = {}) {
  await page.addInitScript(() => {
    window.__lcp = 0;
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
  });
  const response = await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForLoadState('networkidle', { timeout: idleTimeout }).catch(() => {});
  const lcp = await page.evaluate(() => window.__lcp || 0);
  return { lcpMs: Math.round(lcp), response };
}

export function lcpStatus(lcpMs) {
  if (!lcpMs || lcpMs <= 0) return 'fail';
  if (lcpMs < 2500) return 'pass';
  if (lcpMs <= 4000) return 'warning';
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
