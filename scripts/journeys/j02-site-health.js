// Implements Journey J02 — Site Health (per Revibe Master QA Test Library).
// Source-of-truth for intent: https://docs.google.com/document/d/1IZbKwnGIuAgyVXM24bLeKS2HFtziUgt6Y9raC32yYbk/
// Code = deterministic subset; qualitative items (visual/translation judgment) live in the doc only.

import { measureLCP, findBrokenImages } from '../helpers.js';

export default {
  id: 'j02-site-health',
  journeyCode: 'J02',
  frequency: 'daily',
  priority: 'critical',
  name: 'Navigation & Page Health',
  async run(page, site, ctx) {
    const checks = [];

    let response;
    let lcpMs = 0;
    try {
      const result = await measureLCP(page, site.baseUrl);
      response = result.response;
      lcpMs = result.lcpMs;
      ctx.homepageLcpMs = lcpMs;
      ctx.homepageCls = result.cls;
    } catch (err) {
      for (const id of ['homepage-loads', 'currency-present', 'homepage-broken-images', 'internal-links-no-4xx', 'header-nav-multi-items']) {
        checks.push({
          id,
          category: 'meta',
          description: id,
          status: 'fail',
          details: { error: `Homepage failed to load: ${err.message}` },
        });
      }
      return checks;
    }

    checks.push({
      id: 'homepage-loads',
      category: 'functional',
      description: 'Homepage loads with 2xx response',
      status: response.status() < 400 ? 'pass' : 'fail',
      details: { status: response.status() },
    });

    const pageText = (await page.textContent('body').catch(() => '')) || '';
    const foundSymbol = site.currency.symbols.find((s) => pageText.includes(s));
    checks.push({
      id: 'currency-present',
      category: 'localization',
      description: `Currency ${site.currency.code} appears on homepage`,
      status: foundSymbol ? 'pass' : 'fail',
      details: { expectedSymbols: site.currency.symbols, foundSymbol: foundSymbol ?? null },
    });

    const brokenImages = await findBrokenImages(page);
    checks.push({
      id: 'homepage-broken-images',
      category: 'visual',
      description: 'No broken images on homepage (post-lazy-load scroll)',
      status: brokenImages.length === 0 ? 'pass' : brokenImages.length <= 2 ? 'warning' : 'fail',
      details: { count: brokenImages.length, sampleUrls: brokenImages.slice(0, 5) },
    });

    // Sample 5 internal links and GET-check status.
    // Skip /ar paths — they're Cloudflare-protected on the AE/SA sites and time out.
    const links = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('a[href]').forEach((a) => {
        try {
          const u = new URL(a.href);
          if (u.host !== location.host) return;
          if (!u.pathname || u.pathname === '/' || u.pathname.length <= 1) return;
          if (u.pathname.startsWith('/ar')) return;
          out.add(u.origin + u.pathname);
        } catch (_) {}
      });
      return Array.from(out).slice(0, 5);
    });
    const linkResults = [];
    for (const link of links) {
      try {
        const resp = await page.context().request.get(link, { timeout: 15000, maxRedirects: 5 });
        linkResults.push({ url: link, status: resp.status() });
      } catch (e) {
        linkResults.push({ url: link, status: 0, error: e.message });
      }
    }
    const bad = linkResults.filter((r) => r.status === 0 || r.status >= 400);
    let linkStatus;
    if (linkResults.length === 0) linkStatus = 'skip';
    else if (bad.length === 0) linkStatus = 'pass';
    else if (bad.length <= 1) linkStatus = 'warning';
    else linkStatus = 'fail';
    checks.push({
      id: 'internal-links-no-4xx',
      category: 'functional',
      description: 'Sample of internal links from homepage return 2xx/3xx',
      status: linkStatus,
      details: { sampled: linkResults.length, badCount: bad.length, results: linkResults.slice(0, 5) },
    });

    const navCount = await page.evaluate(() => {
      const links = new Set();
      document.querySelectorAll('header a[href], nav a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (href && href !== '#') links.add(href);
      });
      return links.size;
    });
    checks.push({
      id: 'header-nav-multi-items',
      category: 'functional',
      description: 'Header/nav contains multiple links (≥3 distinct hrefs)',
      status: navCount >= 3 ? 'pass' : 'fail',
      details: { count: navCount },
    });

    // ---- Bucket A: sample 5 FOOTER links and check 2xx/3xx ----
    const footerLinks = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('footer a[href]').forEach((a) => {
        try {
          const u = new URL(a.href);
          if (u.host !== location.host) return;
          if (!u.pathname || u.pathname === '/' || u.pathname.length <= 1) return;
          if (u.pathname.startsWith('/ar')) return;
          out.add(u.origin + u.pathname);
        } catch (_) {}
      });
      return Array.from(out).slice(0, 5);
    });
    const footerResults = [];
    for (const link of footerLinks) {
      try {
        const resp = await page.context().request.get(link, { timeout: 15000, maxRedirects: 5 });
        footerResults.push({ url: link, status: resp.status() });
      } catch (e) {
        footerResults.push({ url: link, status: 0, error: e.message });
      }
    }
    const footerBad = footerResults.filter((r) => r.status === 0 || r.status >= 400);
    let footerStatus;
    if (footerResults.length === 0) footerStatus = 'skip';
    else if (footerBad.length === 0) footerStatus = 'pass';
    else if (footerBad.length <= 1) footerStatus = 'warning';
    else footerStatus = 'fail';
    checks.push({
      id: 'footer-no-4xx',
      category: 'functional',
      description: 'Sample of footer links return 2xx/3xx',
      status: footerStatus,
      details: { sampled: footerResults.length, badCount: footerBad.length, results: footerResults.slice(0, 5), todo: footerResults.length === 0 ? 'No footer links found' : null },
    });

    // ---- Bucket B: mobile hamburger button selector present ----
    const hamburger = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const found = candidates.find((el) => {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const cls = (el.className || '').toString().toLowerCase();
        const id = (el.id || '').toLowerCase();
        return /menu|hamburger|nav/.test(aria + ' ' + cls + ' ' + id) || /menu/.test(el.textContent || '');
      });
      return { present: !!found, sample: found ? (found.outerHTML.slice(0, 120)) : null };
    });
    checks.push({
      id: 'mobile-hamburger-present',
      category: 'functional',
      description: 'Mobile hamburger / menu trigger present in header',
      status: hamburger.present ? 'pass' : 'fail',
      details: hamburger,
    });

    return checks;
  },
};
