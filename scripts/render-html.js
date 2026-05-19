// Renders a self-contained HTML report from a QA run JSON.
// Inline CSS, no external assets, print-friendly. Brand: teal #0F6E56,
// cream #FAFAF7, 0.5px borders, no shadows, no gradients, weights 400/500.

const STATUS_LABELS = { pass: 'pass', warning: 'warn', fail: 'fail', skip: 'skip' };

export function renderHTML(report) {
  const totals = aggregateTotals(report);
  const css = renderCss();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Revibe QA — ${escape(report.date)}</title>
<style>${css}</style>
</head>
<body>
<main>
  ${renderHeader(report)}
  ${renderMetrics(report, totals)}
  ${renderSites(report)}
  ${renderFailures(report)}
  ${renderWarrantyReference(report)}
  <footer>
    <span>Generated ${escape(report.timestamp)}</span>
    <span>Run time ${formatDuration(report.runTimeMs)}</span>
  </footer>
</main>
</body>
</html>`;
}

function renderHeader(report) {
  const sitePills = report.sites
    .map((s) => `<span class="pill ${s.summary.status}">${escape(s.name)} · ${escape(s.summary.status)}</span>`)
    .join('');
  return `<header>
  <div class="kicker">Revibe Daily QA</div>
  <h1>${escape(report.date)}</h1>
  <div class="pills">${sitePills}</div>
</header>`;
}

function renderMetrics(report, totals) {
  const passRate = totals.scoreable > 0 ? Math.round((totals.pass / totals.scoreable) * 100) : 0;
  return `<section class="metrics">
  ${metric('Aggregate pass rate', `${passRate}%`, `${totals.pass} of ${totals.scoreable} scoreable checks`)}
  ${metric('Total checks', `${totals.total}`, `across ${report.sites.length} sites`)}
  ${metric('Open failures', `${totals.fail}`, `${totals.warning} warnings · ${totals.skip} skipped`)}
  ${metric('Run time', formatDuration(report.runTimeMs), '')}
</section>`;
}

function metric(label, value, sub) {
  return `<div class="metric">
    <div class="metric-label">${escape(label)}</div>
    <div class="metric-value">${escape(value)}</div>
    <div class="metric-sub">${escape(sub)}</div>
  </div>`;
}

function renderSites(report) {
  return `<section class="sites">
  <h2>Per-site breakdown</h2>
  ${report.sites.map(renderSite).join('')}
</section>`;
}

function renderSite(site) {
  const s = site.summary;
  const journeyBuckets = groupByJourney(site.checks);
  const journeyBlocks = Array.from(journeyBuckets.entries())
    .map(([journey, checks]) => renderJourney(journey, checks))
    .join('');
  return `<article class="site">
  <header class="site-header">
    <h3>${escape(site.name)}</h3>
    <span class="region">${escape(site.region)}</span>
    <span class="pill ${s.status}">${escape(s.status)}</span>
    <span class="counts">${s.pass} pass · ${s.warning} warn · ${s.fail} fail · ${s.skip} skip · ${s.passRate}%</span>
  </header>
  ${journeyBlocks}
</article>`;
}

function renderJourney(journey, checks) {
  const counts = countByStatus(checks);
  const journeyName = checks[0]?.journeyName || journey;
  return `<details ${counts.fail > 0 ? 'open' : ''}>
  <summary>
    <span class="journey-id">${escape(journey)}</span>
    <span class="journey-name">${escape(journeyName)}</span>
    <span class="journey-counts">${checks.length} checks · ${counts.pass}p / ${counts.warning}w / ${counts.fail}f / ${counts.skip}s</span>
  </summary>
  <table>
    <thead><tr><th>Status</th><th>Check</th><th>Description</th><th>Details</th></tr></thead>
    <tbody>
      ${checks.map(renderCheckRow).join('')}
    </tbody>
  </table>
</details>`;
}

function renderCheckRow(check) {
  const detailsStr = check.details ? JSON.stringify(check.details, null, 0) : '';
  const truncated = detailsStr.length > 320 ? detailsStr.slice(0, 320) + '…' : detailsStr;
  return `<tr class="row-${escape(check.status)}">
    <td><span class="pill small ${check.status}">${escape(STATUS_LABELS[check.status] || check.status)}</span></td>
    <td class="check-id">${escape(check.id)}</td>
    <td>${escape(check.description || '')}</td>
    <td class="details"><code>${escape(truncated)}</code></td>
  </tr>`;
}

function renderFailures(report) {
  const fails = [];
  for (const site of report.sites) {
    for (const c of site.checks || []) {
      if (c.status === 'fail') fails.push({ site: site.name, ...c });
    }
  }
  if (fails.length === 0) {
    return `<section class="failures">
  <h2>Open failures</h2>
  <p class="empty">No failures.</p>
</section>`;
  }
  return `<section class="failures">
  <h2>Open failures (${fails.length})</h2>
  <table>
    <thead><tr><th>Site</th><th>Journey</th><th>Check</th><th>Details</th></tr></thead>
    <tbody>
      ${fails.map((f) => `<tr>
        <td>${escape(f.site)}</td>
        <td>${escape(f.journey || '')}</td>
        <td class="check-id">${escape(f.id)}</td>
        <td class="details"><code>${escape(JSON.stringify(f.details || {}, null, 0))}</code></td>
      </tr>`).join('')}
    </tbody>
  </table>
</section>`;
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
        <thead><tr><th>Product price ≤</th><th>Warranty</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
  return `<section class="warranty-ref">
  <h2>Warranty tier reference</h2>
  <div class="tier-grid">${blocks}</div>
</section>`;
}

function aggregateTotals(report) {
  const totals = { total: 0, pass: 0, warning: 0, fail: 0, skip: 0 };
  for (const site of report.sites) {
    for (const c of site.checks || []) {
      totals.total++;
      totals[c.status] = (totals[c.status] || 0) + 1;
    }
  }
  totals.scoreable = totals.pass + totals.warning + totals.fail;
  return totals;
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

function renderCss() {
  return `
:root {
  --teal: #0F6E56;
  --cream: #FAFAF7;
  --ink: #1A1A1A;
  --muted: #6B6B6B;
  --line: rgba(0,0,0,0.12);
  --amber: #B5651D;
  --rose: #A02738;
  --grey: #888;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--cream); color: var(--ink); }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; font-weight: 400; font-size: 14px; line-height: 1.5; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
h1, h2, h3, h4 { font-weight: 500; margin: 0; }
h1 { font-size: 32px; letter-spacing: -0.02em; }
h2 { font-size: 18px; margin: 32px 0 12px; }
h3 { font-size: 16px; }
h4 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
header { border-bottom: 0.5px solid var(--line); padding-bottom: 20px; margin-bottom: 24px; }
.kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--teal); font-weight: 500; margin-bottom: 4px; }
.pills { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.pill { display: inline-flex; align-items: center; padding: 3px 10px; border: 0.5px solid var(--line); border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--ink); background: transparent; }
.pill.small { padding: 1px 8px; font-size: 11px; }
.pill.pass { border-color: var(--teal); color: var(--teal); }
.pill.warning { border-color: var(--amber); color: var(--amber); }
.pill.fail { border-color: var(--rose); color: var(--rose); }
.pill.skip { border-color: var(--line); color: var(--grey); }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 8px; }
.metric { border: 0.5px solid var(--line); border-radius: 4px; padding: 14px 16px; background: white; }
.metric-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.metric-value { font-size: 28px; font-weight: 500; margin: 4px 0 2px; letter-spacing: -0.02em; color: var(--teal); }
.metric-sub { font-size: 12px; color: var(--muted); }
.site { border: 0.5px solid var(--line); border-radius: 4px; padding: 16px 18px; background: white; margin-bottom: 14px; }
.site-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.site-header h3 { margin-right: auto; }
.region { color: var(--muted); font-size: 13px; }
.counts { color: var(--muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
details { border-top: 0.5px solid var(--line); margin-top: 8px; padding-top: 8px; }
details:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
summary { cursor: pointer; padding: 6px 0; display: flex; gap: 12px; align-items: center; user-select: none; }
.journey-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--teal); font-weight: 500; }
.journey-name { font-weight: 500; }
.journey-counts { color: var(--muted); font-size: 12px; margin-left: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 8px; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 0.5px solid var(--line); vertical-align: top; }
th { font-weight: 500; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.check-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: nowrap; }
.details code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); word-break: break-all; }
.row-fail .check-id { color: var(--rose); }
.empty { color: var(--muted); font-style: italic; }
.tier-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.tier-table { border: 0.5px solid var(--line); border-radius: 4px; padding: 12px 14px; background: white; }
.tier-table table { margin: 0; }
.tier-table th, .tier-table td { padding: 4px 6px; }
footer { margin-top: 40px; padding-top: 16px; border-top: 0.5px solid var(--line); color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; }
@media print {
  body { background: white; }
  main { max-width: none; padding: 16px; }
  .site, .metric, .tier-table { page-break-inside: avoid; }
  details { open: true; }
  details > summary { list-style: none; }
}
`;
}
