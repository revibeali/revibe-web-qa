// Reusable QA helpers: LCP measurement and broken-image detection.
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
