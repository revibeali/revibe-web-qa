// Renders a self-contained, mobile-first HTML report from a QA run JSON.
// Two tabs: Summary (plain-language, glanceable) and Technical (filterable,
// per-check cards with expandable details). Inline CSS, no external assets.
// Brand: teal #0F6E56, cream #FAFAF7, 0.5px borders, no shadows, weights 400/500.

const STATUS_LABEL = { pass: 'pass', warning: 'warn', fail: 'fail', skip: 'skip' };

export function renderHTML(report) {
  const t = aggregateTotals(report);
  const failures = collectFailures(report);
  const warnings = collectByStatus(report, 'warning');
  const skips = collectByStatus(report, 'skip');
  const skipReasons = groupSkipReasons(skips);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>Revibe QA — ${escape(report.date)}</title>
<style>${renderCss()}</style>
</head>
<body>
<main>
  ${renderHeader(report, t)}
  ${renderTabNav(t, failures.length)}

  <section class="panel" id="panel-summary">
    ${renderSummary(report, t, failures, warnings, skipReasons)}
  </section>

  <section class="panel hidden" id="panel-technical">
    ${renderTechnical(report, t, failures)}
  </section>

  <footer>
    <span>Generated ${escape(report.timestamp)}</span>
    <span>Run time ${formatDuration(report.runTimeMs)}</span>
  </footer>
</main>
<script>${renderJs()}</script>
</body>
</html>`;
}

// ============================================================
// HEADER + TAB NAV
// ============================================================

function renderHeader(report, t) {
  const overallStatus = report.sites.some((s) => s.summary.status === 'fail') ? 'fail'
    : report.sites.some((s) => s.summary.status === 'warning') ? 'warning' : 'pass';
  return `<header>
  <div class="kicker">Revibe Daily QA</div>
  <h1>${escape(report.date)}</h1>
  <div class="header-meta">
    <span class="pill ${overallStatus}">${escape(overallStatus.toUpperCase())}</span>
    <span class="meta-text">${report.sites.length} sites · ${t.total} checks · ${formatDuration(report.runTimeMs)}</span>
  </div>
</header>`;
}

function renderTabNav(t, failCount) {
  return `<nav class="tabs">
  <button class="tab-btn active" data-tab="panel-summary">Summary</button>
  <button class="tab-btn" data-tab="panel-technical">Technical${failCount > 0 ? ` · ${failCount} !` : ''}</button>
</nav>`;
}

// ============================================================
// SUMMARY TAB
// ============================================================

function renderSummary(report, t, failures, warnings, skipReasons) {
  return `
${renderHero(report, t, failures, warnings)}
${renderRegressionBanner(report)}
${renderSiteCards(report)}
${renderIssuesNarrative(failures, warnings)}
${renderSkipReasons(skipReasons)}
`;
}

function renderRegressionBanner(report) {
  const d = report.diff;
  if (!d || !d.hasBaseline) return '';
  const nb = (d.newlyBroken || []).length;
  const nf = (d.newlyFixed || []).length;
  if (nb === 0 && nf === 0) {
    return `<div class="regression-banner stable">
      <strong>Since ${escape(d.baselineDate)}:</strong> no change — same checks broken, same checks fixed.
    </div>`;
  }
  const broken = (d.newlyBroken || []).slice(0, 6).map((i) =>
    `<li><span class="issue-id">${escape(i.id)}</span> <span class="issue-sites">${escape(shortSiteName(i.site))}</span> <span class="issue-desc">${escape((i.description || '').slice(0, 110))}</span></li>`
  ).join('');
  const fixed = (d.newlyFixed || []).slice(0, 6).map((i) =>
    `<li><span class="issue-id pass">${escape(i.id)}</span> <span class="issue-sites">${escape(shortSiteName(i.site))}</span> <span class="issue-desc">${escape((i.description || '').slice(0, 110))}</span></li>`
  ).join('');
  return `<div class="regression-banner ${nb > 0 ? 'attention' : 'positive'}">
    <div class="regression-summary">
      <strong>Since ${escape(d.baselineDate)}:</strong>
      ${nb > 0 ? `<span class="rb-newly-broken">+${nb} newly broken</span>` : ''}
      ${nf > 0 ? `<span class="rb-newly-fixed">+${nf} newly fixed</span>` : ''}
    </div>
    ${nb > 0 ? `<details ${nb > 0 ? 'open' : ''}><summary>Newly broken (${nb})</summary><ul class="regression-list">${broken}</ul></details>` : ''}
    ${nf > 0 ? `<details><summary>Newly fixed (${nf})</summary><ul class="regression-list">${fixed}</ul></details>` : ''}
  </div>`;
}

function renderHero(report, t, failures, warnings) {
  const passRate = t.scoreable > 0 ? Math.round((t.pass / t.scoreable) * 100) : 0;
  const allPass = report.sites.every((s) => s.summary.status === 'pass');
  const headline = allPass
    ? `All ${report.sites.length} sites are passing today.`
    : failures.length > 0
      ? `${failures.length} check${failures.length === 1 ? '' : 's'} failed across the storefront${warnings.length > 0 ? `, with ${warnings.length} additional warning${warnings.length === 1 ? '' : 's'}` : ''}.`
      : `${warnings.length} warning${warnings.length === 1 ? '' : 's'} surfaced — worth a glance.`;
  return `<div class="hero">
  <p class="hero-headline">${escape(headline)}</p>
  <div class="hero-stats">
    <div class="hero-stat"><div class="hero-stat-value">${passRate}%</div><div class="hero-stat-label">pass rate</div></div>
    <div class="hero-stat"><div class="hero-stat-value">${t.pass}</div><div class="hero-stat-label">passing</div></div>
    <div class="hero-stat"><div class="hero-stat-value ${failures.length > 0 ? 'alert' : ''}">${failures.length}</div><div class="hero-stat-label">failing</div></div>
    <div class="hero-stat"><div class="hero-stat-value subtle">${t.skip}</div><div class="hero-stat-label">skipped</div></div>
  </div>
</div>`;
}

function renderSiteCards(report) {
  const cards = report.sites.map((site) => {
    const s = site.summary;
    const scoreable = s.pass + s.warning + s.fail;
    const barSegments = [
      ['pass', s.pass], ['warning', s.warning], ['fail', s.fail], ['skip', s.skip],
    ].filter(([_, v]) => v > 0)
      .map(([cls, v]) => `<span class="seg ${cls}" style="flex:${v}" title="${cls}: ${v}"></span>`)
      .join('');
    const oneliner = s.fail > 0
      ? `${s.fail} check${s.fail === 1 ? '' : 's'} failed.`
      : s.warning > 0
        ? `${s.warning} warning${s.warning === 1 ? '' : 's'}.`
        : `All scoreable checks passed.`;
    return `<div class="site-card">
      <div class="site-card-top">
        <div>
          <div class="site-name">${escape(site.name)}</div>
          <div class="site-region">${escape(site.region || '')}</div>
        </div>
        <span class="pill ${s.status}">${escape(s.status)}</span>
      </div>
      <div class="ratio-bar">${barSegments}</div>
      <div class="site-counts">
        <span><strong>${s.pass}</strong> passed</span>
        ${s.warning > 0 ? `<span class="warn"><strong>${s.warning}</strong> warned</span>` : ''}
        ${s.fail > 0 ? `<span class="fail"><strong>${s.fail}</strong> failed</span>` : ''}
        ${s.skip > 0 ? `<span class="skip"><strong>${s.skip}</strong> skipped</span>` : ''}
      </div>
      <p class="site-oneliner">${escape(oneliner)} ${scoreable > 0 ? `Score: ${s.passRate}% of ${scoreable} scoreable.` : ''}</p>
    </div>`;
  }).join('');
  return `<section class="site-cards">${cards}</section>`;
}

function renderIssuesNarrative(failures, warnings) {
  if (failures.length === 0 && warnings.length === 0) {
    return `<section class="narrative empty"><h2>Open issues</h2><p>Nothing failing or warning today.</p></section>`;
  }
  const byCheckId = groupByCheckId(failures);
  const failureItems = Array.from(byCheckId.entries()).map(([checkId, items]) => {
    const sites = items.map((i) => shortSiteName(i.site)).join(', ');
    const desc = items[0].description || checkId;
    const detail = humanReadableFailure(items[0]);
    return `<li class="issue-item fail">
      <div class="issue-head"><span class="issue-id">${escape(checkId)}</span> <span class="issue-sites">${escape(sites)}</span></div>
      <div class="issue-desc">${escape(desc)}</div>
      ${detail ? `<div class="issue-detail">${escape(detail)}</div>` : ''}
    </li>`;
  }).join('');

  const warnByCheck = groupByCheckId(warnings);
  const warningItems = Array.from(warnByCheck.entries()).map(([checkId, items]) => {
    const sites = items.map((i) => shortSiteName(i.site)).join(', ');
    const desc = items[0].description || checkId;
    return `<li class="issue-item warn">
      <div class="issue-head"><span class="issue-id">${escape(checkId)}</span> <span class="issue-sites">${escape(sites)}</span></div>
      <div class="issue-desc">${escape(desc)}</div>
    </li>`;
  }).join('');

  return `<section class="narrative">
    ${failures.length > 0 ? `<h2>What's broken (${failures.length})</h2><ul class="issues">${failureItems}</ul>` : ''}
    ${warnings.length > 0 ? `<h2>Worth a look (${warnings.length})</h2><ul class="issues">${warningItems}</ul>` : ''}
  </section>`;
}

function renderSkipReasons(skipReasons) {
  if (skipReasons.length === 0) return '';
  const items = skipReasons.map((g) => `<li class="skip-group">
    <div class="skip-count">${g.count}x</div>
    <div class="skip-reason">${escape(g.reason)}</div>
  </li>`).join('');
  return `<section class="narrative skipped">
    <h2>Skipped checks · grouped by reason</h2>
    <p class="muted">Skips are deferred checks, not failures — the harness deliberately didn't run them.</p>
    <ul class="skip-list">${items}</ul>
  </section>`;
}

// ============================================================
// TECHNICAL TAB
// ============================================================

function renderTechnical(report, t, failures) {
  return `
${renderFilterBar(t)}
${renderTechSiteSections(report)}
${renderWarrantyReference(report)}
`;
}

function renderFilterBar(t) {
  return `<div class="filter-bar">
  <button class="filter-btn active" data-filter="all">All (${t.total})</button>
  ${t.fail > 0 ? `<button class="filter-btn" data-filter="fail">Fails (${t.fail})</button>` : ''}
  ${t.warning > 0 ? `<button class="filter-btn" data-filter="warning">Warnings (${t.warning})</button>` : ''}
  ${t.pass > 0 ? `<button class="filter-btn" data-filter="pass">Passing (${t.pass})</button>` : ''}
  ${t.skip > 0 ? `<button class="filter-btn" data-filter="skip">Skipped (${t.skip})</button>` : ''}
</div>`;
}

function renderTechSiteSections(report) {
  return report.sites.map((site) => {
    const s = site.summary;
    const journeyGroups = groupByJourney(site.checks);
    const journeyBlocks = Array.from(journeyGroups.entries()).map(([journey, checks]) => {
      const journeyName = checks[0]?.journeyName || journey;
      const journeyCode = checks[0]?.journeyCode || '';
      const counts = countByStatus(checks);
      return `<details class="journey-block" ${counts.fail > 0 ? 'open' : ''}>
        <summary>
          <span class="journey-code">${escape(journeyCode || journey)}</span>
          <span class="journey-name">${escape(journeyName)}</span>
          <span class="journey-counts">${checks.length} · ${counts.pass}p / ${counts.warning}w / ${counts.fail}f / ${counts.skip}s</span>
        </summary>
        <div class="check-list">${checks.map(renderCheckCard).join('')}</div>
      </details>`;
    }).join('');
    return `<section class="tech-site-block">
      <div class="tech-site-header">
        <h3>${escape(site.name)}</h3>
        <span class="pill ${s.status}">${escape(s.status)}</span>
        <span class="counts">${s.pass}p · ${s.warning}w · ${s.fail}f · ${s.skip}s · ${s.passRate}%</span>
      </div>
      ${journeyBlocks}
    </section>`;
  }).join('');
}

function renderCheckCard(check) {
  const detailsJson = check.details ? JSON.stringify(check.details, null, 2) : '';
  const todo = check.details?.todo || check.details?.reason || null;
  const shot = check.details?.screenshot ? `<a class="check-shot-link" href="${escape(check.details.screenshot)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(check.details.screenshot)}" alt="Failure screenshot for ${escape(check.id)}"></a>` : '';
  return `<article class="check-card" data-status="${escape(check.status)}">
    <header class="check-card-head">
      <span class="pill small ${escape(check.status)}">${escape(STATUS_LABEL[check.status] || check.status)}</span>
      <span class="check-id">${escape(check.id)}</span>
    </header>
    <div class="check-desc">${escape(check.description || '')}</div>
    ${todo ? `<div class="check-todo">${escape(todo)}</div>` : ''}
    ${shot}
    ${detailsJson ? `<details class="check-detail"><summary>Details</summary><pre>${escape(detailsJson)}</pre></details>` : ''}
  </article>`;
}

function renderWarrantyReference(report) {
  if (!report.warrantyTiers) return '';
  const blocks = Object.entries(report.warrantyTiers).map(([siteId, tiers]) => {
    const rows = tiers.map((t) => {
      const ceiling = t.maxPrice == null ? '∞' : t.maxPrice;
      return `<tr><td>${escape(ceiling)}</td><td>${escape(t.warranty)}</td></tr>`;
    }).join('');
    return `<div class="tier-table">
      <h4>${escape(siteId.toUpperCase())}</h4>
      <table>
        <thead><tr><th>Price &le;</th><th>Warranty</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
  return `<section class="warranty-ref">
    <h3>Warranty tier reference</h3>
    <div class="tier-grid">${blocks}</div>
  </section>`;
}

// ============================================================
// HELPERS
// ============================================================

function aggregateTotals(report) {
  const t = { total: 0, pass: 0, warning: 0, fail: 0, skip: 0 };
  for (const site of report.sites) {
    for (const c of site.checks || []) {
      t.total++;
      t[c.status] = (t[c.status] || 0) + 1;
    }
  }
  t.scoreable = t.pass + t.warning + t.fail;
  return t;
}

function collectFailures(report) {
  const out = [];
  for (const site of report.sites) {
    for (const c of site.checks || []) {
      if (c.status === 'fail') out.push({ ...c, site: site.name });
    }
  }
  return out;
}

function collectByStatus(report, status) {
  const out = [];
  for (const site of report.sites) {
    for (const c of site.checks || []) {
      if (c.status === status) out.push({ ...c, site: site.name });
    }
  }
  return out;
}

function groupByCheckId(items) {
  const m = new Map();
  for (const i of items) {
    if (!m.has(i.id)) m.set(i.id, []);
    m.get(i.id).push(i);
  }
  return m;
}

function groupSkipReasons(skips) {
  const m = new Map();
  for (const s of skips) {
    const reason = (s.details?.todo || s.details?.reason || 'unspecified').toString().slice(0, 140);
    m.set(reason, (m.get(reason) || 0) + 1);
  }
  return Array.from(m.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function groupByJourney(checks) {
  const m = new Map();
  for (const c of checks) {
    const key = c.journey || 'meta';
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(c);
  }
  return m;
}

function countByStatus(checks) {
  const c = { pass: 0, warning: 0, fail: 0, skip: 0 };
  for (const x of checks) c[x.status] = (c[x.status] || 0) + 1;
  return c;
}

function humanReadableFailure(check) {
  const d = check.details || {};
  if (d.error) return `Error: ${String(d.error).slice(0, 200)}`;
  if (d.lcpMs) return `LCP measured at ${d.lcpMs}ms (over the 4s threshold).`;
  if (d.expectedWarranty != null && d.displayedWarranty != null) {
    return `Expected ${d.expectedWarranty}, page shows ${d.displayedWarranty}.`;
  }
  if (d.missingProviders?.length > 0) return `Missing: ${d.missingProviders.join(', ')}.`;
  if (d.missingPhrases?.length > 0) return `Missing copy: ${d.missingPhrases.slice(0, 2).join('; ')}.`;
  if (typeof d.status === 'number' && d.status >= 400) return `HTTP ${d.status}.`;
  if (typeof d.count === 'number') return `Count: ${d.count}.`;
  return null;
}

function shortSiteName(name) {
  return (name || '').replace('revibe.', '').replace('.me', '').replace('.co.za', 'za') || name;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function escape(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// CSS
// ============================================================

function renderCss() {
  return `
:root {
  --teal: #0F6E56;
  --cream: #FAFAF7;
  --ink: #1A1A1A;
  --muted: #6B6B6B;
  --line: rgba(0,0,0,0.12);
  --line-soft: rgba(0,0,0,0.06);
  --amber: #B5651D;
  --rose: #A02738;
  --grey: #888;
  --card-bg: #ffffff;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--cream); color: var(--ink); }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; font-weight: 400; font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
main { max-width: 880px; margin: 0 auto; padding: 20px 16px 64px; }
h1, h2, h3, h4 { font-weight: 500; margin: 0; letter-spacing: -0.01em; }
h1 { font-size: 28px; letter-spacing: -0.02em; }
h2 { font-size: 18px; margin: 28px 0 12px; }
h3 { font-size: 16px; }
h4 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }

header { border-bottom: 0.5px solid var(--line); padding-bottom: 16px; margin-bottom: 20px; }
.kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--teal); font-weight: 500; margin-bottom: 4px; }
.header-meta { margin-top: 10px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.meta-text { color: var(--muted); font-size: 13px; }

.pill { display: inline-flex; align-items: center; padding: 3px 10px; border: 0.5px solid var(--line); border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--ink); background: transparent; white-space: nowrap; }
.pill.small { padding: 1px 8px; font-size: 11px; }
.pill.pass { border-color: var(--teal); color: var(--teal); }
.pill.warning { border-color: var(--amber); color: var(--amber); }
.pill.fail { border-color: var(--rose); color: var(--rose); }
.pill.skip { border-color: var(--line); color: var(--grey); }

nav.tabs { display: flex; gap: 4px; border-bottom: 0.5px solid var(--line); margin-bottom: 20px; }
.tab-btn { flex: 1; background: transparent; border: 0; padding: 12px 8px; font: inherit; font-weight: 500; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; transition: color 0.15s; }
.tab-btn:hover { color: var(--ink); }
.tab-btn.active { color: var(--teal); border-bottom-color: var(--teal); }
.panel { display: block; }
.panel.hidden { display: none; }

.hero { margin-bottom: 20px; }
.hero-headline { font-size: 17px; font-weight: 500; margin: 0 0 14px; }
.hero-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.hero-stat { background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 6px; padding: 12px 14px; }
.hero-stat-value { font-size: 26px; font-weight: 500; color: var(--teal); letter-spacing: -0.02em; line-height: 1.1; }
.hero-stat-value.alert { color: var(--rose); }
.hero-stat-value.subtle { color: var(--grey); }
.hero-stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

.site-cards { display: grid; gap: 12px; margin-bottom: 16px; }
.site-card { background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 6px; padding: 14px 16px; }
.site-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.site-name { font-weight: 500; font-size: 15px; }
.site-region { color: var(--muted); font-size: 12px; margin-top: 2px; }
.ratio-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--line-soft); margin-bottom: 8px; }
.ratio-bar .seg { display: block; min-width: 2px; }
.ratio-bar .seg.pass { background: var(--teal); }
.ratio-bar .seg.warning { background: var(--amber); }
.ratio-bar .seg.fail { background: var(--rose); }
.ratio-bar .seg.skip { background: var(--grey); opacity: 0.4; }
.site-counts { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.site-counts strong { color: var(--ink); font-weight: 500; }
.site-counts .warn strong { color: var(--amber); }
.site-counts .fail strong { color: var(--rose); }
.site-counts .skip strong { color: var(--grey); }
.site-oneliner { font-size: 13px; color: var(--muted); margin: 6px 0 0; }

.narrative { margin-top: 20px; }
.narrative.empty { background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 6px; padding: 16px; text-align: center; color: var(--muted); }
.issues { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.issue-item { background: var(--card-bg); border: 0.5px solid var(--line); border-left: 3px solid var(--grey); border-radius: 4px; padding: 10px 12px; }
.issue-item.fail { border-left-color: var(--rose); }
.issue-item.warn { border-left-color: var(--amber); }
.issue-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.issue-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 500; color: var(--rose); word-break: break-all; }
.issue-item.warn .issue-id { color: var(--amber); }
.issue-sites { font-size: 11px; color: var(--muted); }
.issue-desc { font-size: 14px; }
.issue-detail { font-size: 12px; color: var(--muted); margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }

.skip-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.skip-group { display: flex; gap: 12px; align-items: flex-start; background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 4px; padding: 8px 12px; }
.skip-count { font-weight: 500; color: var(--grey); min-width: 32px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.skip-reason { font-size: 13px; color: var(--muted); flex: 1; }
.muted { color: var(--muted); font-size: 13px; }

.regression-banner { background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; border-left: 3px solid var(--grey); }
.regression-banner.attention { border-left-color: var(--rose); }
.regression-banner.positive { border-left-color: var(--teal); }
.regression-banner.stable { border-left-color: var(--grey); color: var(--muted); font-size: 13px; }
.regression-summary { display: flex; flex-wrap: wrap; gap: 12px; font-size: 14px; }
.rb-newly-broken { color: var(--rose); font-weight: 500; }
.rb-newly-fixed { color: var(--teal); font-weight: 500; }
.regression-banner details { margin-top: 8px; }
.regression-banner summary { font-size: 12px; color: var(--muted); cursor: pointer; padding: 4px 0; }
.regression-banner .regression-list { list-style: none; padding: 0; margin: 6px 0 0; font-size: 12px; display: grid; gap: 4px; }
.regression-banner .regression-list li { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; border-bottom: 0.5px solid var(--line-soft); }
.regression-banner .regression-list .issue-id { color: var(--rose); }
.regression-banner .regression-list .issue-id.pass { color: var(--teal); }
.regression-banner .regression-list .issue-desc { color: var(--muted); flex: 1 1 100%; padding-left: 0; }

.check-shot-link { display: block; margin-top: 8px; border: 0.5px solid var(--line); border-radius: 4px; overflow: hidden; }
.check-shot-link img { display: block; width: 100%; max-height: 280px; object-fit: cover; object-position: top; }

.filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; position: sticky; top: 0; background: var(--cream); padding: 8px 0; z-index: 5; }
.filter-btn { background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 12px; font-weight: 500; color: var(--muted); cursor: pointer; }
.filter-btn:hover { color: var(--ink); }
.filter-btn.active { background: var(--teal); border-color: var(--teal); color: white; }

.tech-site-block { margin-bottom: 24px; }
.tech-site-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 0.5px solid var(--line); margin-bottom: 10px; }
.tech-site-header h3 { margin-right: auto; }
.tech-site-header .counts { color: var(--muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.journey-block { background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 6px; margin-bottom: 8px; }
.journey-block summary { cursor: pointer; padding: 10px 14px; display: flex; gap: 10px; align-items: center; user-select: none; flex-wrap: wrap; list-style: none; }
.journey-block summary::-webkit-details-marker { display: none; }
.journey-block summary::before { content: '▸'; font-size: 11px; color: var(--muted); transition: transform 0.15s; }
.journey-block[open] summary::before { transform: rotate(90deg); }
.journey-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--teal); font-weight: 500; background: rgba(15,110,86,0.08); padding: 2px 6px; border-radius: 3px; }
.journey-name { font-weight: 500; font-size: 14px; }
.journey-counts { color: var(--muted); font-size: 11px; margin-left: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.check-list { padding: 4px 14px 14px; display: grid; gap: 8px; }
.check-card { border: 0.5px solid var(--line-soft); border-radius: 4px; padding: 10px 12px; background: rgba(0,0,0,0.005); }
.check-card[data-status="fail"] { border-left: 3px solid var(--rose); }
.check-card[data-status="warning"] { border-left: 3px solid var(--amber); }
.check-card[data-status="pass"] { border-left: 3px solid var(--teal); }
.check-card[data-status="skip"] { opacity: 0.65; }
.check-card.hidden { display: none; }
.check-card-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
.check-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--ink); word-break: break-all; }
.check-desc { font-size: 13px; line-height: 1.45; }
.check-todo { font-size: 12px; color: var(--muted); margin-top: 4px; font-style: italic; }
.check-detail { margin-top: 6px; }
.check-detail summary { font-size: 12px; color: var(--muted); cursor: pointer; }
.check-detail pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); white-space: pre-wrap; word-break: break-all; margin: 6px 0 0; padding: 8px; background: rgba(0,0,0,0.03); border-radius: 4px; }

.warranty-ref { margin-top: 28px; }
.tier-grid { display: grid; gap: 10px; }
.tier-table { background: var(--card-bg); border: 0.5px solid var(--line); border-radius: 6px; padding: 10px 12px; }
.tier-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tier-table th, .tier-table td { padding: 4px 6px; text-align: left; border-bottom: 0.5px solid var(--line-soft); }
.tier-table th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }

footer { margin-top: 36px; padding-top: 14px; border-top: 0.5px solid var(--line); color: var(--muted); font-size: 12px; display: flex; flex-direction: column; gap: 4px; }

@media (min-width: 600px) {
  main { padding: 32px 24px 80px; }
  h1 { font-size: 32px; }
  .hero-stats { grid-template-columns: repeat(4, 1fr); }
  .site-cards { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .tier-grid { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
  footer { flex-direction: row; justify-content: space-between; }
}

@media print {
  body { background: white; }
  main { max-width: none; padding: 16px; }
  nav.tabs { display: none; }
  .panel.hidden { display: block !important; }
  .filter-bar { display: none; }
  .journey-block summary::before { content: ''; }
  .check-detail { display: none; }
}
`;
}

// ============================================================
// CLIENT JS
// ============================================================

function renderJs() {
  return `
(function () {
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('hidden', p.id !== target); });
    });
  });
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var filter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.check-card').forEach(function (card) {
        var status = card.dataset.status;
        card.classList.toggle('hidden', filter !== 'all' && status !== filter);
      });
    });
  });
})();
`;
}
