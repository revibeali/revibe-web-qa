# revibe-web-qa

Deterministic daily QA harness for **revibe.me** (UAE), **sa.revibe.me** (KSA), and **revibe.co.za** (ZA).

- Playwright iPhone 13 emulation, headless Chromium
- ~30 checks per site organised into 6 journeys (PLP, PDP, cart, navigation/health, speed, localisation)
- Outputs `reports/YYYY-MM-DD.json` (machine-readable) and `reports/YYYY-MM-DD.html` (shareable snapshot)
- Static dashboard at [`/docs/index.html`](docs/index.html) trends the last 60 runs
- Runs daily at 06:00 UTC via GitHub Actions; commits results back to `main`

**Live dashboard:** https://revibeali.github.io/revibe-web-qa/

## Local setup

```bash
npm ci
npx playwright install chromium
npm run qa
```

A run takes ~5 minutes and writes two files under `reports/`, plus mirrors data into `docs/reports/` for the dashboard. Open the HTML report directly, or serve the dashboard locally:

```bash
npx http-server docs -p 8080
# → http://localhost:8080
```

## GitHub Pages — one-time enable

The Actions workflow already commits the dashboard payload into `docs/` on `main`. To publish the site, in this repo:

1. Click **Settings** (top tab bar).
2. In the left sidebar, under **Code and automation**, click **Pages**.
3. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
4. Under **Branch**, select **`main`** and the **`/docs`** folder.
5. Click **Save**.
6. Wait ~30 seconds and refresh the page. The live URL appears at the top — for this repo it will be `https://revibeali.github.io/revibe-web-qa/`.

Subsequent pushes to `main` that change anything in `/docs/` will republish automatically.

## How to add a check

Checks live inside a journey file under `scripts/journeys/`. Each journey exports a single `{ id, name, run(page, site, ctx) }` object; `run` returns an array of check objects.

1. **Pick the journey** the check thematically belongs to (PLP/PDP/cart/etc.) and open `scripts/journeys/jX-*.js`.
2. **Navigate if needed** (`await page.goto(...)`), then guard against a Cloudflare interstitial with `isChallengePage(text)` from `helpers.js` — if challenged, push a `skip` with a TODO and return.
3. **Push a check object** into `checks`:

   ```js
   checks.push({
     id: 'pdp-something-new',           // unique, kebab-case
     category: 'content',               // functional|performance|content|localization|visual|math|meta
     description: 'Human-readable assertion',
     status: ok ? 'pass' : 'fail',      // pass | warning | fail | skip
     details: { url, observed, expected }, // anything useful for debugging
   });
   ```

4. **Reuse helpers** from `scripts/helpers.js` rather than re-implementing:
   - `measureLCP(page, url)` → `{ lcpMs, response }` (use for any new page-load timing)
   - `lcpStatus(ms)` → `'pass' | 'warning' | 'fail'` against agreed thresholds
   - `findBrokenImages(page)` (scrolls bottom-to-top first, filters empty/data:/base-URL srcs)
   - `expectedWarranty(price, tiers)` / `warrantyDisplayPattern(...)` for warranty math
   - `containsArabic(text)` / `containsLatinLetters(text)` for Arabic leak detection
   - `fetchShopifyProductJson(page, '/products/<handle>')`, `shopifyClearCart/AddToCart/GetCart`
   - `isChallengePage(text)` for Cloudflare interstitial detection

5. **Add to ctx** if a later journey needs the value:

   ```js
   ctx.pdpProduct = { variantId, price, title };
   ```

6. **Run** `npm run qa` and check the new entry in `reports/YYYY-MM-DD.json` + `.html`.

If a check turns out flaky on one site only, set its status to `skip` and put the reason in `details.todo` — shipped beats blocked.

### Adding a whole new journey

Drop a new file `scripts/journeys/jN-foo.js` exporting `{ id, name, run }`, then add it to the `JOURNEYS` array in `scripts/run-qa.js`. The dashboard groups by `journey` automatically.

## Layout

```
scripts/
  helpers.js              shared utilities (LCP, broken images, Shopify cart, warranty math, Arabic, CF detection)
  sites.js                site config (URLs, currency, BNPL list, warranty tiers)
  run-qa.js               orchestrator — dependency-ordered journey runner, JSON+HTML output, dashboard sync
  render-html.js          per-run HTML report renderer
  journeys/
    j1-plp.js             PLP banner, BNPL, empty-state, search, sort
    j2-pdp.js             PDP load+LCP, compare-price math, warranty heading+tier math, cashback
    j3-cart.js            Shopify cart add/verify via /cart/*.js, /cart DOM, /checkout
    j4-navigation.js      homepage load+broken-images, currency, internal-link sample, nav menu
    j5-speed.js           LCP across homepage/PLP/PDP/cart/checkout
    j6-localization.js    Arabic locale load, Arabic Unicode presence, h1 leak detector
reports/                  YYYY-MM-DD.{json,html} per run
docs/                     Pages root: index.html dashboard + reports mirror
.github/workflows/qa.yml  daily cron + workflow_dispatch
```
