// Implements Journey J09 — PDP Content & Spec (per Revibe Master QA Test Library).
// Sheet: https://docs.google.com/spreadsheets/d/1-cKrw7J7y98er5KksdCEteQqz67lkdoU5QUKaHYVLv0/

import { ensurePDPLoaded } from '../helpers.js';

const CHECK_IDS = ['pdp-related-products-count', 'pdp-whats-included-smartphone', 'pdp-tech-spec-present'];

export default {
  id: 'j09-pdp-content-spec',
  journeyCode: 'J09',
  frequency: 'weekly',
  priority: 'minor',
  name: 'PDP Content & Spec',
  async run(page, site, ctx) {
    const checks = [];
    const setup = await ensurePDPLoaded(page, site, ctx);
    if (!setup.ok) {
      const reasonText = setup.reason === 'cdn-blocked'
        ? `Product page blocked by the site's bot protection (HTTP ${setup.status}) — could not test.`
        : `Product page could not be loaded after retries — could not test (likely a transient slowdown).`;
      for (const id of CHECK_IDS) {
        checks.push({
          id, category: 'meta', description: id,
          status: 'skip',
          details: { todo: reasonText, failureType: 'infrastructure', reason: setup.reason },
        });
      }
      return checks;
    }
    const pdpUrl = setup.product.url;

    // Scroll to bottom + wait to give lazy-loaded carousels time to render.
    await page.evaluate(async () => {
      const h = document.documentElement.scrollHeight;
      window.scrollTo(0, h);
      await new Promise((r) => setTimeout(r, 1500));
      window.scrollTo(0, h * 0.7);
      await new Promise((r) => setTimeout(r, 1000));
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // pdp-related-products-count
    const relatedCount = await page.evaluate(() => {
      const patterns = /recommended|related|you may also|similar (products|items)|customers also|frequently bought|more from|trending|featured products/i;
      const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,div[class*="heading"],div[class*="title"]'))
        .find((el) => patterns.test(el.textContent || ''));
      const allProductLinks = Array.from(document.querySelectorAll('a[href*="/products/"]'));
      const currentHandle = location.pathname.split('/products/')[1]?.split('?')[0] ?? '';
      const otherProductPaths = new Set();
      allProductLinks.forEach((a) => {
        try {
          const p = new URL(a.href).pathname;
          if (!currentHandle || !p.endsWith('/' + currentHandle)) otherProductPaths.add(p);
        } catch (_) {}
      });
      if (heading) {
        let scope = heading;
        for (let i = 0; i < 4 && scope.parentElement; i++) scope = scope.parentElement;
        const inScope = new Set();
        scope.querySelectorAll('a[href*="/products/"]').forEach((a) => {
          try { inScope.add(new URL(a.href).pathname); } catch (_) {}
        });
        return { source: 'heading', count: inScope.size, totalOther: otherProductPaths.size };
      }
      return { source: 'fallback-total-other-products', count: otherProductPaths.size, totalOther: otherProductPaths.size };
    });
    // Pass if EITHER scoped or total-other count is >=3.
    const effectiveCount = Math.max(relatedCount.count, relatedCount.totalOther);
    checks.push({
      id: 'pdp-related-products-count',
      category: 'content',
      description: 'Recommended/Related section has ≥3 product cards (or PDP shows ≥3 other product links)',
      status: effectiveCount >= 3 ? 'pass' : effectiveCount > 0 ? 'warning' : 'fail',
      details: { url: pdpUrl, ...relatedCount, effectiveCount },
    });

    // pdp-whats-included-smartphone
    const whatsIncluded = await page.evaluate(() => {
      const text = (document.body.textContent || '').toLowerCase();
      const sectionPresent =
        /what['']?s\s*included/i.test(text) ||
        /\bin\s*the\s*box\b/i.test(text) ||
        /\bpackage\s*(contents|includes)\b/i.test(text) ||
        /\bbox\s*contents\b/i.test(text);
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

    // pdp-tech-spec-present
    const techSpec = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,summary,button,div[class*="title"],div[class*="heading"]'))
        .find((h) => /\btechnical\s*specifications?|^specifications?|\bspecs\b|\bproduct\s*details\b|\bfeatures\b/i.test((h.textContent || '').trim()));
      if (!heading) return { present: false, length: 0 };
      let scope = heading;
      for (let i = 0; i < 3 && scope.parentElement; i++) scope = scope.parentElement;
      const extracted = (scope.textContent || '').slice(0, 2000);
      return { present: true, length: extracted.length, headingText: (heading.textContent || '').trim().slice(0, 60) };
    });
    checks.push({
      id: 'pdp-tech-spec-present',
      category: 'content',
      description: 'Technical Specification section present and non-empty',
      status: techSpec.present && techSpec.length > 80 ? 'pass' : techSpec.present ? 'warning' : 'fail',
      details: { url: pdpUrl, ...techSpec },
    });

    return checks;
  },
};
