# Autonomous task queue

This directory lets you queue work for Claude to do unattended. The
`.github/workflows/claude-tasks.yml` workflow runs every 4 hours and on every
push that touches `.tasks/inbox/`. It picks the **oldest** task file, hands the
content to Claude Code in headless mode, and opens a PR with the result.

## Flow

```
.tasks/inbox/             ← drop new task .md files here
.tasks/completed/         ← processed files land here, prefixed with date
.tasks/failed/            ← rare; tasks that crashed mid-run
```

## How to queue a task

1. Create a markdown file in `.tasks/inbox/` with a descriptive name:
   `.tasks/inbox/add-arabic-pdp-checks.md`
2. Write a clear prompt (see template below).
3. Commit and push. The workflow fires immediately, or waits for the next
   4-hour tick if multiple tasks are queued.
4. Within ~10–20 minutes, a PR titled `claude: <task-name>` appears.
5. Review the PR locally; merge when you're satisfied.

## Task file template

```markdown
# <one-line goal>

## Context
<2–4 sentences about what you're trying to achieve and why>

## Concrete asks
- <Bullet 1: specific, testable>
- <Bullet 2>
- <Bullet 3>

## Acceptance
- Files that must be changed (or created)
- Specific check IDs / RVB IDs (if known) that should be covered
- Anything Claude should NOT do (out of scope)

## References
- Sheet rows: <if applicable>
- Existing files to base on: <e.g. scripts/journeys/j06-plp-deep.js>
```

## What Claude can and can't do

**Can**
- Read/write any file in the repo
- Run `node --check` to syntax-test
- Add/modify journey files, helpers, sites config
- Create new workflows if the task explicitly asks

**Won't (by design)**
- Run `npm run qa` (5+ min, would slow the queue significantly — the daily cron handles execution)
- Push directly to `main` (it always opens a PR)
- Touch CI secrets or workflow tokens

## Cost

Each task uses the `ANTHROPIC_API_KEY` secret. A typical small task (add a
journey, add a few checks) is roughly a few cents in API spend. A large task
(refactor across many files) can run higher. Watch your Anthropic billing
dashboard if you queue many tasks per day.

## Disabling / pausing

To pause the queue:
1. Comment out the cron in `.github/workflows/claude-tasks.yml`, OR
2. Move queued files out of `.tasks/inbox/` temporarily

## Worked examples

### Example: add coverage for J05 Analytics

```markdown
# Add J05 Analytics & Tracking journey

## Context
J05 has zero coverage today. The sheet has 8 deterministic test cases. Goal:
land a working j05-analytics.js with 3-5 parameterised checks that cover most
of them.

## Concrete asks
- Create scripts/journeys/j05-analytics.js with:
  - journeyCode 'J05', frequency 'daily', priority 'major'
- Add 3 checks:
  1. ga4-script-loaded: verify gtag/GA4 script src appears on homepage
  2. gtm-container-loaded: same for GTM
  3. meta-pixel-loaded: same for Meta Pixel
- Wire it into scripts/run-qa.js JOURNEYS array

## Acceptance
- node --check scripts/journeys/j05-analytics.js passes
- scripts/run-qa.js imports j05 and includes it in JOURNEYS

## References
- Sheet: rows where Journey == J05
- Pattern: scripts/journeys/j04-commerce-smoke.js
```

### Example: add a new site

```markdown
# Add hk.revibe.me to sites.js

## Context
Adding Hong Kong storefront. Currency HKD; languages en + zh-HK; BNPL providers
to confirm with team but Atome is the main one in HK.

## Concrete asks
- Add a 4th entry to SITES in scripts/sites.js:
  - id: 'hk', name: 'hk.revibe.me', baseUrl: 'https://hk.revibe.me'
  - plpPath: '/collections/all'
  - region: 'Hong Kong', language: 'en', rtl: false
  - currency: { code: 'HKD', symbols: ['HK$', 'HKD'] }
  - bnpl: ['Atome']
  - warrantyTiers: <leave as 5-entry placeholder with TODO comment>

## Acceptance
- scripts/sites.js has 4 SITES entries
- Running the harness against HK should at least pass homepage-loads

## References
- Pattern: existing UAE entry in scripts/sites.js
```
