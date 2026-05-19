// Implements Journey 6 (Localization & BNPL Verification) from the Revibe Daily QA doc.
// Source-of-truth for intent: https://docs.google.com/document/d/1IZbKwnGIuAgyVXM24bLeKS2HFtziUgt6Y9raC32yYbk/
// Code = deterministic subset; qualitative items (visual/translation judgment) live in the doc only.

import { containsArabic, containsLatinLetters } from '../helpers.js';

export default {
  id: 'j6-localization',
  name: 'Localization (Arabic + BNPL consistency)',
  async run(page, site, ctx) {
    const checks = [];

    if (site.id === 'za') {
      for (const id of ['arabic-page-loads', 'arabic-contains-rtl-text', 'arabic-no-english-leak-in-h1']) {
        checks.push({
          id,
          category: 'localization',
          description: `${id} (not applicable to ZA — English-only per QA doc)`,
          status: 'skip',
          details: { reason: 'revibe.co.za is English-only per QA doc' },
        });
      }
      return checks;
    }

    const arUrl = site.baseUrl + '/?locale=ar';
    let response;
    try {
      response = await page.goto(arUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    } catch (err) {
      checks.push({
        id: 'arabic-page-loads',
        category: 'localization',
        description: 'Arabic locale homepage loads',
        status: 'fail',
        details: { url: arUrl, error: err.message },
      });
      for (const id of ['arabic-contains-rtl-text', 'arabic-no-english-leak-in-h1']) {
        checks.push({
          id,
          category: 'localization',
          description: id,
          status: 'fail',
          details: { error: 'Arabic page navigation failed' },
        });
      }
      return checks;
    }

    const arStatus = response.status();
    if (arStatus === 403 || arStatus === 429) {
      for (const id of ['arabic-page-loads', 'arabic-contains-rtl-text', 'arabic-no-english-leak-in-h1']) {
        checks.push({
          id,
          category: 'localization',
          description: `${id} — Arabic locale CDN-blocked`,
          status: 'skip',
          details: {
            url: arUrl,
            status: arStatus,
            todo: `HTTP ${arStatus} on /?locale=ar — Cloudflare anti-bot challenge. Investigate stealth mode or whitelisted UA later.`,
          },
        });
      }
      return checks;
    }

    checks.push({
      id: 'arabic-page-loads',
      category: 'localization',
      description: 'Arabic locale homepage loads (via ?locale=ar)',
      status: arStatus < 400 ? 'pass' : 'fail',
      details: { url: arUrl, status: arStatus },
    });

    const bodyText = (await page.textContent('body').catch(() => '')) || '';
    const hasArabic = containsArabic(bodyText);
    checks.push({
      id: 'arabic-contains-rtl-text',
      category: 'localization',
      description: 'Arabic locale page contains Arabic Unicode characters',
      status: hasArabic ? 'pass' : 'fail',
      details: { url: arUrl, sample: bodyText.slice(0, 200) },
    });

    const h1Text = ((await page.textContent('h1').catch(() => '')) || '').trim();
    let h1Status;
    if (!h1Text) h1Status = 'warning';
    else if (containsArabic(h1Text) && !containsLatinLetters(h1Text)) h1Status = 'pass';
    else if (containsArabic(h1Text)) h1Status = 'warning';
    else h1Status = 'fail';
    checks.push({
      id: 'arabic-no-english-leak-in-h1',
      category: 'localization',
      description: 'Arabic h1 contains Arabic Unicode and no Latin letter leak',
      status: h1Status,
      details: { url: arUrl, h1: h1Text.slice(0, 200) },
    });

    return checks;
  },
};
