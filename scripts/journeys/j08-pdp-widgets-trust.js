// Implements Journey J08 — PDP Widgets & Trust (per Revibe Master QA Test Library).
// Sheet: https://docs.google.com/spreadsheets/d/1-cKrw7J7y98er5KksdCEteQqz67lkdoU5QUKaHYVLv0/

import {
  ensurePDPLoaded,
  expectedWarranty,
  getWarrantyCardText,
  extractDisplayedWarranty,
} from '../helpers.js';

const WARRANTY_HEADING = 'get full protection and warranty for 24 months';
const CHECK_IDS = [
  'pdp-warranty-heading',
  'pdp-warranty-tier-math',
  'pdp-cashback-reasonable',
  'pdp-trustpilot-present',
  'pdp-usp-icons-all-four',
  'pdp-supplier-click-resolves',
  'pdp-cashback-visible',
];

export default {
  id: 'j08-pdp-widgets-trust',
  journeyCode: 'J08',
  frequency: 'weekly',
  priority: 'critical',
  name: 'PDP Widgets & Trust',
  async run(page, site, ctx) {
    const checks = [];
    const setup = await ensurePDPLoaded(page, site, ctx);
    if (!setup.ok) {
      const cdnBlocked = setup.reason === 'cdn-blocked';
      for (const id of CHECK_IDS) {
        checks.push({
          id,
          category: 'meta',
          description: id,
          status: cdnBlocked ? 'skip' : 'fail',
          details: { todo: cdnBlocked ? `PDP blocked by CDN (HTTP ${setup.status})` : null, error: setup.reason },
        });
      }
      return checks;
    }
    const { product } = setup;
    const pdpUrl = product.url;

    const bodyText = ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ');

    // pdp-warranty-heading
    const headingFound = bodyText.toLowerCase().includes(WARRANTY_HEADING);
    checks.push({
      id: 'pdp-warranty-heading',
      category: 'content',
      description: 'Warranty card heading "Get full protection and warranty for 24 months" present on PDP',
      status: headingFound ? 'pass' : 'fail',
      details: { url: pdpUrl, found: headingFound },
    });

    // pdp-warranty-tier-math
    const tier = site.warrantyTiers.find((t) => product.price <= t.maxPrice) || null;
    const expected = tier?.warranty ?? expectedWarranty(product.price, site.warrantyTiers);
    if (expected == null) {
      checks.push({
        id: 'pdp-warranty-tier-math',
        category: 'math',
        description: 'Displayed warranty price matches canonical tier for product price',
        status: 'skip',
        details: { todo: 'No tier matched', productPrice: product.price },
      });
    } else {
      const warrantyArea = await getWarrantyCardText(page, WARRANTY_HEADING);
      const displayed = extractDisplayedWarranty(warrantyArea, WARRANTY_HEADING, site.currency.code, site.currency.symbols);
      let s;
      if (displayed == null) s = 'fail';
      else if (displayed === expected) s = 'pass';
      else s = 'fail';
      checks.push({
        id: 'pdp-warranty-tier-math',
        category: 'math',
        description: 'Displayed warranty price matches canonical tier for product price',
        status: s,
        details: {
          url: pdpUrl, productPrice: product.price, expectedWarranty: expected, displayedWarranty: displayed,
          currency: site.currency.code, match: displayed === expected,
          tierHandle: tier?.handle ?? null, tierProductId: tier?.productId ?? null,
          cardSnippet: warrantyArea.slice(0, 400),
        },
      });
    }

    // pdp-cashback-reasonable (present + non-zero, skip while On Hold)
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
    let cashbackStatus, cashbackTodo = null;
    if (!cashbackInfo.present) {
      cashbackStatus = 'skip'; cashbackTodo = 'Cashback widget not visible (feature currently On Hold per QA doc)';
    } else if (cashbackInfo.amount > 0) {
      cashbackStatus = 'pass';
    } else {
      cashbackStatus = 'skip'; cashbackTodo = 'Cashback widget visible but amount = 0 (feature On Hold per QA doc)';
    }
    checks.push({
      id: 'pdp-cashback-reasonable',
      category: 'content',
      description: 'Cashback widget present AND amount > 0 (skipped while feature On Hold per QA doc)',
      status: cashbackStatus,
      details: { url: pdpUrl, todo: cashbackTodo, ...cashbackInfo },
    });

    // pdp-trustpilot-present
    const trustpilot = await page.evaluate(() => {
      const fullText = (document.body.textContent || '').toLowerCase();
      const hasText = /trustpilot/i.test(fullText);
      const widgetUrl = Array.from(document.querySelectorAll('iframe,script,img,a'))
        .some((el) => /trustpilot\.com/i.test((el.src || el.href || '')));
      const hasHeading = hasText || widgetUrl;
      const m = (document.body.textContent || '').match(/(\d{1,3}(?:[,]\d{3})*|\d+)\s*(?:reviews?|ratings?)/i);
      const count = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
      return { hasHeading, hasText, widgetUrl, count };
    });
    let tpStatus;
    if (!trustpilot.hasHeading) tpStatus = 'skip';
    else if (trustpilot.count > 0) tpStatus = 'pass';
    else tpStatus = 'warning';
    checks.push({
      id: 'pdp-trustpilot-present',
      category: 'content',
      description: 'Trustpilot widget rendered with non-zero review count',
      status: tpStatus,
      details: { url: pdpUrl, ...trustpilot, todo: tpStatus === 'skip' ? 'Trustpilot widget not on this PDP' : null },
    });

    // pdp-usp-icons-all-four
    const usp = await page.evaluate(() => {
      const fullText = ((document.body.textContent || '') + ' ' +
        Array.from(document.images).map((i) => i.alt || '').join(' ')).toLowerCase();
      const items = {
        certified: /certified by experts|certified renewed|inspected by experts/i.test(fullText),
        unlocked: /(all\s*phones?\s*are\s*)?unlocked/i.test(fullText),
        warranty12: /12\s*months?\s*warranty/i.test(fullText),
        freeDelivery: /free\s*(delivery|shipping)/i.test(fullText),
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

    // pdp-supplier-click-resolves
    const supplier = await page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      const labelIdx = (function () {
        const candidates = ['sold by', 'authenticated & sold by', 'authenticated and sold by', 'seller:', 'supplier:'];
        for (const c of candidates) {
          const i = text.indexOf(c);
          if (i >= 0) return { label: c, idx: i };
        }
        return null;
      })();
      if (!labelIdx) return { present: false };
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      let best = null, bestScore = Infinity;
      for (const a of allLinks) {
        const ctxStr = (a.closest('section,div,article,p,li')?.innerText || '').toLowerCase();
        if (!ctxStr.includes(labelIdx.label)) continue;
        const href = a.getAttribute('href') || '';
        if (!href || href === '#' || href.startsWith('javascript:')) continue;
        const score = (a.innerText || '').length;
        if (score < bestScore && score > 0 && score < 60) { bestScore = score; best = { name: a.innerText.trim(), href }; }
      }
      if (!best) return { present: true, link: null, label: labelIdx.label };
      try { best.absHref = new URL(best.href, location.href).href; } catch (_) {}
      return { present: true, link: best, label: labelIdx.label };
    });
    if (!supplier.present) {
      checks.push({ id: 'pdp-supplier-click-resolves', category: 'functional', description: 'Supplier widget present and clicking it opens a real page',
        status: 'skip', details: { url: pdpUrl, todo: 'No supplier widget detected on PDP' } });
    } else if (!supplier.link) {
      checks.push({ id: 'pdp-supplier-click-resolves', category: 'functional', description: 'Supplier widget present and clicking it opens a real page',
        status: 'warning', details: { url: pdpUrl, todo: 'Supplier label found but no associated clickable link', label: supplier.label } });
    } else {
      let linkStatus = 0, linkErr = null;
      try {
        const resp = await page.context().request.get(supplier.link.absHref || supplier.link.href, { timeout: 15000, maxRedirects: 5 });
        linkStatus = resp.status();
      } catch (e) { linkErr = e.message; }
      const ok = linkStatus > 0 && linkStatus < 400;
      checks.push({
        id: 'pdp-supplier-click-resolves',
        category: 'functional',
        description: 'Supplier widget present and the supplier link resolves to 2xx/3xx',
        status: ok ? 'pass' : (linkStatus === 403 || linkStatus === 429 ? 'skip' : 'fail'),
        details: { url: pdpUrl, supplier: supplier.link, linkStatus, error: linkErr },
      });
    }

    // pdp-cashback-visible
    const cashbackViz = await page.evaluate(() => {
      const xpath = `//*[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'cashback') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'cash back')]`;
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      let visible = false, smallestVisibleArea = 0;
      const nodeCount = result.snapshotLength;
      for (let i = 0; i < Math.min(nodeCount, 30); i++) {
        const el = result.snapshotItem(i);
        if (!(el instanceof Element)) continue;
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0) {
          visible = true;
          if (smallestVisibleArea === 0 || r.width * r.height < smallestVisibleArea) smallestVisibleArea = r.width * r.height;
        }
      }
      return { nodeCount, visible, smallestVisibleArea: Math.round(smallestVisibleArea) };
    });
    let cvStatus, cvTodo = null;
    if (cashbackViz.nodeCount === 0) { cvStatus = 'skip'; cvTodo = 'Cashback text not found in DOM (feature On Hold per QA doc)'; }
    else if (cashbackViz.visible) { cvStatus = 'pass'; }
    else { cvStatus = 'fail'; cvTodo = 'Cashback element exists in DOM but is hidden (display:none / zero size) — likely a rendering bug'; }
    checks.push({
      id: 'pdp-cashback-visible',
      category: 'visual',
      description: 'Cashback element is actually rendered (not display:none / zero-sized)',
      status: cvStatus,
      details: { url: pdpUrl, todo: cvTodo, ...cashbackViz },
    });

    return checks;
  },
};
