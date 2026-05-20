// Implements Journey 2 (PDP) from the Revibe Daily QA doc.
// Source-of-truth for intent: https://docs.google.com/document/d/1IZbKwnGIuAgyVXM24bLeKS2HFtziUgt6Y9raC32yYbk/
// Code = deterministic subset; qualitative items (visual/translation judgment) live in the doc only.

import {
  measureLCP,
  lcpStatus,
  expectedWarranty,
  fetchShopifyProductJson,
  getWarrantyCardText,
  extractDisplayedWarranty,
} from '../helpers.js';

const WARRANTY_HEADING = 'get full protection and warranty for 24 months';

export default {
  id: 'j2-pdp',
  name: 'PDP',
  async run(page, site, ctx) {
    const checks = [];

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
      const ids = ['pdp-loads', 'pdp-lcp', 'pdp-compare-gt-price', 'pdp-warranty-heading', 'pdp-warranty-tier-math', 'pdp-cashback-reasonable'];
      for (const id of ids) {
        checks.push({
          id,
          category: 'meta',
          description: id,
          status: 'skip',
          details: { todo: 'No product URL captured from PLP' },
        });
      }
      return checks;
    }

    const pdpUrl = site.baseUrl + ctx.plpFirstProductPath;
    let lcpMs = 0;
    let response;
    try {
      const result = await measureLCP(page, pdpUrl);
      response = result.response;
      lcpMs = result.lcpMs;
      ctx.pdpLcpMs = lcpMs;
      ctx.pdpCls = result.cls;
    } catch (err) {
      checks.push({
        id: 'pdp-loads',
        category: 'functional',
        description: 'PDP loads with 2xx response',
        status: 'fail',
        details: { url: pdpUrl, error: err.message },
      });
      return checks;
    }

    checks.push({
      id: 'pdp-loads',
      category: 'functional',
      description: 'PDP loads with 2xx response',
      status: response.status() < 400 ? 'pass' : 'fail',
      details: { url: pdpUrl, status: response.status() },
    });

    checks.push({
      id: 'pdp-lcp',
      category: 'performance',
      description: 'PDP LCP under thresholds (pass <2.5s, warn 2.5-4s, fail >4s)',
      status: lcpStatus(lcpMs),
      details: { url: pdpUrl, lcpMs },
    });

    const product = await fetchShopifyProductJson(page, ctx.plpFirstProductPath);
    if (!product || !product.variants || product.variants.length === 0) {
      for (const id of ['pdp-compare-gt-price', 'pdp-warranty-heading', 'pdp-warranty-tier-math', 'pdp-cashback-reasonable']) {
        checks.push({
          id,
          category: 'meta',
          description: id,
          status: 'skip',
          details: { todo: 'Could not load Shopify product JSON' },
        });
      }
      return checks;
    }

    const variant = product.variants[0];
    const priceCents = variant.price;
    const compareCents = variant.compare_at_price;
    const price = Math.round(priceCents / 100);
    const compare = compareCents ? Math.round(compareCents / 100) : 0;
    ctx.pdpProduct = {
      handle: product.handle,
      title: product.title,
      url: pdpUrl,
      price,
      compare,
      variantId: variant.id,
    };

    const compareStatus = compare > 0 && compare > price ? 'pass' : compare === 0 ? 'warning' : 'fail';
    checks.push({
      id: 'pdp-compare-gt-price',
      category: 'math',
      description: 'PDP compare-at price is greater than actual price',
      status: compareStatus,
      details: { url: pdpUrl, title: product.title, price, compare, currency: site.currency.code },
    });

    const bodyText = ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ');
    const headingFound = bodyText.toLowerCase().includes(WARRANTY_HEADING);
    checks.push({
      id: 'pdp-warranty-heading',
      category: 'content',
      description: 'Warranty card heading "Get full protection and warranty for 24 months" present on PDP',
      status: headingFound ? 'pass' : 'fail',
      details: { url: pdpUrl, found: headingFound },
    });

    const tier = site.warrantyTiers.find((t) => price <= t.maxPrice) || null;
    const expected = tier?.warranty ?? expectedWarranty(price, site.warrantyTiers);
    if (expected == null) {
      checks.push({
        id: 'pdp-warranty-tier-math',
        category: 'math',
        description: 'Displayed warranty price matches canonical tier for product price',
        status: 'skip',
        details: { todo: 'No tier matched', productPrice: price },
      });
    } else {
      const warrantyArea = await getWarrantyCardText(page, WARRANTY_HEADING);
      const displayed = extractDisplayedWarranty(
        warrantyArea,
        WARRANTY_HEADING,
        site.currency.code,
        site.currency.symbols
      );
      let status;
      if (displayed == null) status = 'fail';
      else if (displayed === expected) status = 'pass';
      else status = 'fail';
      checks.push({
        id: 'pdp-warranty-tier-math',
        category: 'math',
        description: 'Displayed warranty price matches canonical tier for product price',
        status,
        details: {
          url: pdpUrl,
          productPrice: price,
          expectedWarranty: expected,
          displayedWarranty: displayed,
          currency: site.currency.code,
          match: displayed === expected,
          tierHandle: tier?.handle ?? null,
          tierProductId: tier?.productId ?? null,
          cardSnippet: warrantyArea.slice(0, 400),
        },
      });
    }

    // Cashback reshape: "Reasonable cashback" -> present AND non-zero.
    // Per QA doc the feature is currently On Hold; present-with-zero and absent both -> skip.
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
    let cashbackStatus;
    let cashbackTodo = null;
    if (!cashbackInfo.present) {
      cashbackStatus = 'skip';
      cashbackTodo = 'Cashback widget not visible (feature currently On Hold per QA doc)';
    } else if (cashbackInfo.amount > 0) {
      cashbackStatus = 'pass';
    } else {
      cashbackStatus = 'skip';
      cashbackTodo = 'Cashback widget visible but amount = 0 (feature On Hold per QA doc)';
    }
    checks.push({
      id: 'pdp-cashback-reasonable',
      category: 'content',
      description: 'Cashback widget present AND amount > 0 (skipped while feature On Hold per QA doc)',
      status: cashbackStatus,
      details: { url: pdpUrl, todo: cashbackTodo, ...cashbackInfo },
    });

    // ---- Bucket A: deterministic widget presence checks ----

    // Trustpilot: text/widget URLs in DOM (Trustpilot embed often uses iframe; check src too)
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
    let trustpilotStatus;
    if (!trustpilot.hasHeading) trustpilotStatus = 'skip';
    else if (trustpilot.count > 0) trustpilotStatus = 'pass';
    else trustpilotStatus = 'warning';
    checks.push({
      id: 'pdp-trustpilot-present',
      category: 'content',
      description: 'Trustpilot widget rendered with non-zero review count',
      status: trustpilotStatus,
      details: { url: pdpUrl, ...trustpilot, todo: trustpilotStatus === 'skip' ? 'Trustpilot widget not on this PDP' : null },
    });

    // Related / Recommended products: at least 3 product cards under such a section.
    // Broader heading patterns + total-product-link count as a fallback.
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
          // Exclude the current PDP itself
          if (!currentHandle || !p.endsWith('/' + currentHandle)) otherProductPaths.add(p);
        } catch (_) {}
      });
      if (heading) {
        // Count product links in the heading's section/parent/siblings
        let scope = heading;
        for (let i = 0; i < 4 && scope.parentElement; i++) scope = scope.parentElement;
        const inScope = new Set();
        scope.querySelectorAll('a[href*="/products/"]').forEach((a) => {
          try { inScope.add(new URL(a.href).pathname); } catch (_) {}
        });
        return { source: 'heading', count: inScope.size, totalOther: otherProductPaths.size };
      }
      // No heading found; fall back to "number of other product links on the page"
      return { source: 'fallback-total-other-products', count: otherProductPaths.size, totalOther: otherProductPaths.size };
    });
    checks.push({
      id: 'pdp-related-products-count',
      category: 'content',
      description: 'Recommended/Related section has ≥3 product cards (or PDP shows ≥3 other product links)',
      status: relatedCount.count >= 3 ? 'pass' : relatedCount.count > 0 ? 'warning' : 'fail',
      details: { url: pdpUrl, ...relatedCount },
    });

    // "What's Included" for smartphone: broader heading match + textContent (catches collapsed accordions)
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

    // Technical Specification: broader element search + textContent (collapsed accordions)
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

    // USP icons: use textContent (captures hidden/collapsed text) + alt attrs (icon-only USPs)
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

    // ---- Bucket B: PDP variant URL changes price ----
    // Visit ?variant=<second variant id>, verify the displayed price differs.
    if (product.variants.length >= 2) {
      const v1 = product.variants[0];
      const v2 = product.variants.find((v) => v.price !== v1.price) || product.variants[1];
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
        let status;
        if (v1PriceMajor === v2PriceMajor) status = 'skip';
        else if (v2Shown) status = 'pass';
        else status = 'fail';
        checks.push({
          id: 'pdp-variant-url-changes-price',
          category: 'functional',
          description: 'Navigating ?variant=<id> shows that variant\'s price',
          status,
          details: {
            url: variantUrl,
            v1Price: v1PriceMajor,
            v2Price: v2PriceMajor,
            v2Shown,
            v1NoLongerInTopOfPage: v1NoLongerSole,
            todo: status === 'skip' ? 'All variants share the same price; can\'t prove price change' : null,
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

    // ---- Bucket B: Warranty (i) icon click reveals Revibe Care+ content ----
    // Capture text before click, click any info icon inside the warranty card,
    // wait briefly, then verify Revibe Care+ keywords appear that weren't there before.
    const warrantyClick = await page.evaluate(() => {
      // Find the smallest element whose textContent contains the warranty heading
      const heading = 'get full protection and warranty for 24 months';
      const matches = [];
      document.querySelectorAll('*').forEach((el) => {
        const tc = (el.textContent || '').toLowerCase();
        if (tc.includes(heading)) matches.push({ el, len: tc.length });
      });
      if (matches.length === 0) return { clicked: false, reason: 'no warranty heading' };
      matches.sort((a, b) => a.len - b.len);
      let card = matches[0].el;
      for (let i = 0; i < 5 && card.parentElement; i++) card = card.parentElement;
      // Find an "info" affordance inside or near the card
      const clickCandidates = Array.from(card.querySelectorAll('button, a, [role="button"], svg, span, i'));
      const icon = clickCandidates.find((el) => {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const text = (el.textContent || '').trim().toLowerCase();
        const cls = (typeof el.className === 'string' ? el.className : (el.className.baseVal || '')).toLowerCase();
        return /info|more|details|learn|tooltip/.test(aria + ' ' + title + ' ' + cls) || text === 'i' || text === '?';
      });
      if (!icon) return { clicked: false, reason: 'no info icon in card' };
      const before = (document.body.innerText || '');
      const beforeLen = before.length;
      try { icon.click(); } catch (e) { return { clicked: false, reason: 'click threw: ' + e.message }; }
      return { clicked: true, beforeLen, iconTag: icon.tagName };
    });
    if (!warrantyClick.clicked) {
      checks.push({
        id: 'pdp-warranty-info-modal-content',
        category: 'functional',
        description: 'Clicking the warranty (i) icon reveals Revibe Care+ content',
        status: 'skip',
        details: { url: pdpUrl, todo: warrantyClick.reason || 'no info icon found in warranty card' },
      });
    } else {
      await page.waitForTimeout(900);
      const post = await page.evaluate(() => {
        const text = (document.body.innerText || '').toLowerCase();
        return {
          length: text.length,
          fullProtection: /full\s*protection/.test(text),
          accidentalDamage: /accidental\s*damage/.test(text),
          expressReplacement: /express\s*replacement/.test(text),
          support247: /24[\/\-\s]*7\s*support/.test(text),
          revibeCarePlus: /revibe\s*care\s*\+?|revibe\s*care\s*plus/.test(text),
        };
      });
      const keywords = ['fullProtection', 'accidentalDamage', 'expressReplacement', 'support247', 'revibeCarePlus'];
      const hits = keywords.filter((k) => post[k]).length;
      const grew = post.length > warrantyClick.beforeLen;
      let status;
      if (hits >= 3 && grew) status = 'pass';
      else if (hits >= 3 || grew) status = 'warning';
      else status = 'fail';
      checks.push({
        id: 'pdp-warranty-info-modal-content',
        category: 'functional',
        description: 'Clicking the warranty (i) icon reveals Revibe Care+ content (Full Protection / Accidental Damage / Express Replacement / 24/7 Support / Revibe Care+)',
        status,
        details: { url: pdpUrl, keywordHits: hits, keywords: keywords.filter((k) => post[k]), textGrewBy: post.length - warrantyClick.beforeLen },
      });
    }

    // ---- Bucket B: Supplier widget click resolves to a real page ----
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
      // Find the closest <a> AFTER the label position in DOM order
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      // Score each link by proximity to "sold by" text
      let best = null;
      let bestScore = Infinity;
      for (const a of allLinks) {
        const ctx = (a.closest('section,div,article,p,li')?.innerText || '').toLowerCase();
        if (!ctx.includes(labelIdx.label)) continue;
        // Prefer absolute href, non-anchor
        const href = a.getAttribute('href') || '';
        if (!href || href === '#' || href.startsWith('javascript:')) continue;
        const score = (a.innerText || '').length;
        if (score < bestScore && score > 0 && score < 60) {
          bestScore = score;
          best = { name: a.innerText.trim(), href };
        }
      }
      if (!best) {
        // Maybe it's not a link, just text. Mark present without a link.
        return { present: true, link: null, label: labelIdx.label };
      }
      try {
        const u = new URL(best.href, location.href);
        best.absHref = u.href;
      } catch (_) {}
      return { present: true, link: best, label: labelIdx.label };
    });
    if (!supplier.present) {
      checks.push({
        id: 'pdp-supplier-click-resolves',
        category: 'functional',
        description: 'Supplier widget present and clicking it opens a real page',
        status: 'skip',
        details: { url: pdpUrl, todo: 'No supplier widget detected on PDP' },
      });
    } else if (!supplier.link) {
      checks.push({
        id: 'pdp-supplier-click-resolves',
        category: 'functional',
        description: 'Supplier widget present and clicking it opens a real page',
        status: 'warning',
        details: { url: pdpUrl, todo: 'Supplier label found but no associated clickable link', label: supplier.label },
      });
    } else {
      // GET the link without leaving the page
      let linkStatus = 0;
      let linkErr = null;
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

    // ---- Bucket B: Cashback widget visible (not display:none / zero-sized) ----
    const cashbackViz = await page.evaluate(() => {
      const xpath = `//*[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'cashback') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'cash back')]`;
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      let visible = false;
      let smallestVisibleArea = 0;
      let nodeCount = result.snapshotLength;
      for (let i = 0; i < Math.min(nodeCount, 30); i++) {
        const el = result.snapshotItem(i);
        if (!(el instanceof Element)) continue;
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0) {
          visible = true;
          if (smallestVisibleArea === 0 || r.width * r.height < smallestVisibleArea) {
            smallestVisibleArea = r.width * r.height;
          }
        }
      }
      return { nodeCount, visible, smallestVisibleArea: Math.round(smallestVisibleArea) };
    });
    let cashbackVizStatus;
    let cashbackVizTodo = null;
    if (cashbackViz.nodeCount === 0) {
      cashbackVizStatus = 'skip';
      cashbackVizTodo = 'Cashback text not found in DOM (feature On Hold per QA doc)';
    } else if (cashbackViz.visible) {
      cashbackVizStatus = 'pass';
    } else {
      cashbackVizStatus = 'fail';
      cashbackVizTodo = 'Cashback element exists in DOM but is hidden (display:none / zero size) — likely a rendering bug';
    }
    checks.push({
      id: 'pdp-cashback-visible',
      category: 'visual',
      description: 'Cashback element is actually rendered (not display:none / zero-sized)',
      status: cashbackVizStatus,
      details: { url: pdpUrl, todo: cashbackVizTodo, ...cashbackViz },
    });

    return checks;
  },
};
