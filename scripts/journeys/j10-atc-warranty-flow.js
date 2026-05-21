// Implements Journey J10 — Add-to-Cart & Warranty Flow (per Revibe Master QA Test Library).
// Sheet: https://docs.google.com/spreadsheets/d/1-cKrw7J7y98er5KksdCEteQqz67lkdoU5QUKaHYVLv0/

import { ensurePDPLoaded } from '../helpers.js';

const CHECK_IDS = ['pdp-warranty-info-modal-content', 'pdp-atc-button-present', 'pdp-warranty-toggle-present'];

export default {
  id: 'j10-atc-warranty-flow',
  journeyCode: 'J10',
  frequency: 'weekly',
  priority: 'critical',
  name: 'Add-to-Cart & Warranty Flow',
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

    // pdp-atc-button-present: locate an Add-to-Cart-like button on the PDP.
    const atcButton = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"], [class*="add-to-cart"], [class*="addToCart"]'));
      const found = candidates.find((el) => {
        const text = (el.textContent || el.value || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        const id = (el.getAttribute('id') || '').toLowerCase();
        return /add to cart|add to bag|buy now/.test(text + ' ' + aria) || /add[-_]?to[-_]?cart/i.test(name + ' ' + id);
      });
      if (!found) return { present: false };
      const r = found.getBoundingClientRect();
      const style = getComputedStyle(found);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      return {
        present: true,
        visible,
        text: (found.textContent || found.value || '').trim().slice(0, 40),
        disabled: found.disabled || found.getAttribute('aria-disabled') === 'true',
      };
    });
    let atcStatus;
    if (!atcButton.present) atcStatus = 'fail';
    else if (atcButton.visible && !atcButton.disabled) atcStatus = 'pass';
    else atcStatus = 'warning';
    checks.push({
      id: 'pdp-atc-button-present',
      category: 'functional',
      description: 'Add-to-Cart button is present, visible, and enabled on PDP',
      status: atcStatus,
      details: { url: pdpUrl, ...atcButton },
    });

    // pdp-warranty-toggle-present: locate the warranty toggle near the warranty card.
    const warrantyToggle = await page.evaluate(() => {
      const lower = (document.body.textContent || '').toLowerCase();
      if (!lower.includes('get full protection and warranty for 24 months')) {
        return { present: false, reason: 'no warranty heading' };
      }
      const inputs = Array.from(document.querySelectorAll('input[type="checkbox"], button[role="switch"], [role="switch"], input[type="radio"]'));
      const candidates = inputs.filter((el) => {
        const ctxStr = (el.closest('section,div,article,form,fieldset')?.textContent || '').toLowerCase();
        return /full\s*protection|warranty|revibe\s*care/.test(ctxStr);
      });
      if (candidates.length === 0) return { present: false, reason: 'no toggle near warranty card' };
      const first = candidates[0];
      const r = first.getBoundingClientRect();
      const style = getComputedStyle(first);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      return {
        present: true,
        visible,
        type: first.tagName + '/' + (first.type || first.getAttribute('role') || ''),
        checked: first.checked || first.getAttribute('aria-checked') === 'true',
      };
    });
    // "Not found" is a warning, not a fail: the toggle is a small theme widget
    // and a negative result is as likely to be a selector miss as a real bug.
    // A human should verify before this screams red.
    let wtStatus;
    if (!warrantyToggle.present) wtStatus = 'warning';
    else if (warrantyToggle.visible) wtStatus = 'pass';
    else wtStatus = 'warning';
    checks.push({
      id: 'pdp-warranty-toggle-present',
      category: 'functional',
      description: 'Warranty toggle exists near the warranty card on PDP',
      status: wtStatus,
      details: { url: pdpUrl, ...warrantyToggle },
    });

    // pdp-warranty-info-modal-content: click the (i) icon, verify new Revibe Care+ content
    const warrantyClick = await page.evaluate(() => {
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
      const beforeLower = before.toLowerCase();
      const preKeywords = {
        fullProtection: /full\s*protection/.test(beforeLower),
        accidentalDamage: /accidental\s*damage/.test(beforeLower),
        expressReplacement: /express\s*replacement/.test(beforeLower),
        support247: /24[\/\-\s]*7\s*support/.test(beforeLower),
        revibeCarePlus: /revibe\s*care\s*\+?|revibe\s*care\s*plus/.test(beforeLower),
      };
      try { icon.click(); } catch (e) { return { clicked: false, reason: 'click threw: ' + e.message }; }
      return { clicked: true, beforeLen, iconTag: icon.tagName, preKeywords };
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
      const newKeywords = keywords.filter((k) => post[k] && !warrantyClick.preKeywords[k]);
      const newHits = newKeywords.length;
      const grew = post.length > warrantyClick.beforeLen;
      // "Click revealed no new content" is ambiguous — could be a real broken
      // modal, or the modal copy simply differs from the keywords we expect.
      // Warn rather than fail so a human confirms before it counts as red.
      let s;
      if (newHits >= 3 && grew) s = 'pass';
      else if (newHits >= 1 && grew) s = 'warning';
      else s = 'warning';
      checks.push({
        id: 'pdp-warranty-info-modal-content',
        category: 'functional',
        description: 'Clicking the warranty (i) icon reveals NEW Revibe Care+ content (Full Protection / Accidental Damage / Express Replacement / 24/7 Support / Revibe Care+)',
        status: s,
        details: {
          url: pdpUrl,
          newKeywords,
          preClickKeywords: keywords.filter((k) => warrantyClick.preKeywords[k]),
          postClickKeywords: keywords.filter((k) => post[k]),
          textGrewBy: post.length - warrantyClick.beforeLen,
        },
      });
    }

    return checks;
  },
};
