// Implements Journey J04 — Commerce Smoke (per Revibe Master QA Test Library).
// Sheet: https://docs.google.com/spreadsheets/d/1-cKrw7J7y98er5KksdCEteQqz67lkdoU5QUKaHYVLv0/
//
// Daily commerce-readiness checks. Cheap, fast, and stops short of full
// PDP widget deep-dive (that's J07/J08). Verifies the storefront can
// actually take an order: the Add-to-Cart button exists and BNPL options
// render on the PDP.

import { ensurePDPLoaded } from '../helpers.js';

const CHECK_IDS = ['j04-atc-button-clickable', 'j04-bnpl-providers-on-pdp', 'j04-currency-on-pdp'];

export default {
  id: 'j04-commerce-smoke',
  journeyCode: 'J04',
  frequency: 'daily',
  priority: 'critical',
  name: 'Commerce Smoke',
  async run(page, site, ctx) {
    const checks = [];
    const setup = await ensurePDPLoaded(page, site, ctx);
    if (!setup.ok) {
      const cdnBlocked = setup.reason === 'cdn-blocked';
      for (const id of CHECK_IDS) {
        checks.push({
          id, category: 'meta', description: id,
          status: cdnBlocked ? 'skip' : 'fail',
          details: { todo: cdnBlocked ? `PDP blocked by CDN (HTTP ${setup.status})` : null, error: setup.reason },
        });
      }
      return checks;
    }
    const pdpUrl = setup.product.url;

    // j04-atc-button-clickable
    const atc = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"], [class*="add-to-cart"]'));
      const found = els.find((el) => /add to cart|add to bag|buy now/.test(((el.textContent || el.value || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase()));
      if (!found) return { present: false };
      const r = found.getBoundingClientRect();
      const style = getComputedStyle(found);
      return {
        present: true,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        disabled: found.disabled || found.getAttribute('aria-disabled') === 'true',
        text: (found.textContent || found.value || '').trim().slice(0, 40),
      };
    });
    let atcStatus;
    if (!atc.present) atcStatus = 'fail';
    else if (atc.visible && !atc.disabled) atcStatus = 'pass';
    else atcStatus = 'warning';
    checks.push({
      id: 'j04-atc-button-clickable',
      category: 'functional',
      description: 'PDP Add-to-Cart button present, visible, and clickable',
      status: atcStatus,
      details: { url: pdpUrl, ...atc },
    });

    // j04-bnpl-providers-on-pdp
    const foundProviders = await page.evaluate((providers) => {
      const text = (document.body.innerText || '').toLowerCase();
      const imgInfo = Array.from(document.images)
        .map((i) => `${i.alt || ''} ${i.src || ''}`.toLowerCase())
        .join(' ');
      return providers.filter((p) => (text + ' ' + imgInfo).includes(p.toLowerCase()));
    }, site.bnpl);
    const missingProviders = site.bnpl.filter((p) => !foundProviders.includes(p));
    let bnplStatus;
    if (missingProviders.length === 0) bnplStatus = 'pass';
    else if (foundProviders.length > 0) bnplStatus = 'warning';
    else bnplStatus = 'fail';
    checks.push({
      id: 'j04-bnpl-providers-on-pdp',
      category: 'localization',
      description: `BNPL providers ${site.bnpl.join(', ')} all present on PDP`,
      status: bnplStatus,
      details: { url: pdpUrl, expected: site.bnpl, found: foundProviders, missing: missingProviders },
    });

    // j04-currency-on-pdp
    const pageText = (await page.textContent('body').catch(() => '')) || '';
    const foundSymbol = site.currency.symbols.find((s) => pageText.includes(s));
    checks.push({
      id: 'j04-currency-on-pdp',
      category: 'localization',
      description: `Currency ${site.currency.code} renders on PDP`,
      status: foundSymbol ? 'pass' : 'fail',
      details: { url: pdpUrl, expectedSymbols: site.currency.symbols, foundSymbol: foundSymbol ?? null },
    });

    return checks;
  },
};
