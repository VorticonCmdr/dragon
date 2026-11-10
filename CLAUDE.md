# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Blue Dragon** is a Manifest V3 Chrome extension (Chrome 121+) that functions as a web crawler and SEO analysis tool. Click the extension icon → opens `dragon.html` as a new tab.

## Build

```bash
npm install          # first time
npm run build        # production build → dist/
npm run dev          # watch mode (rebuilds on change)
npm test             # unit tests (test/unit, node:test)
npm run test:e2e     # builds, then runs test/e2e in Chrome for Testing
npm run screenshots  # retakes docs/screenshots from the demo shop
```

**Load in Chrome:** `chrome://extensions` → "Load unpacked" → select `dist/`. Reload extension after each `npm run build`.

**Release:** raise the version in `public/manifest.json` and `package.json` (they must match), then push a tag `v<version>`. `.github/workflows/release.yml` tests, builds, zips the *contents* of `dist/` (manifest at the root, as the Chrome Web Store requires) and attaches the ZIP to a GitHub release. GitHub Pages serves `docs/` from `main`.

## Tech stack

| Layer | Tech |
|-------|------|
| Bundler | Vite (root: `src/`, output: `dist/`) |
| CSS | Tailwind CSS v3 base + hand-written components on CSS tokens (`src/style.css`) |
| Table | Tabulator v6 (`TabulatorFull`) |
| HTML parsing | `node-html-parser` (service workers have no DOM) |
| robots.txt | `google-robotstxt-parser` |
| CSV parsing | PapaParse |
| ZIP | fflate, streaming `Zip` (async mode needs blob workers, which the CSP forbids) |
| Modals | Native `<dialog>` with `showModal()`/`close()` |
| JS | Vanilla ES modules (no framework) |

## File structure

```
src/
  background.js      # SW entry: registers listeners synchronously, boots, routes messages
  bg/
    engine.js        # THE crawler: start/pause/resume/stop, worker pool, checkpoints
    fetchPage.js     # one fetch: retries, timeout, content gate, size cap, charset
    parsePage.js     # the only HTML parse: metadata + links
    robots.js        # per-crawl robots cache, overrides, crawl-delay
    politeness.js    # per-origin request spacing
    redirects.js     # redirect hops via webRequest
    scheduler.js     # schedules, alarms, pending queue; starts crawls through engine.js
    messages.js      # port registry, throttled broadcasts, request routing
    keepalive.js     # keeps the SW alive during a crawl
    opfs.js          # HTML archive
  shared/
    defaults.js      # DEFAULT_SETTINGS + normalizeSettings: the only settings source
    row.js           # page record → flat table row
    sitemap.js       # sitemap fetch/parse/gunzip (used by SW and page)
    url.js           # normalizeUrl, parseUrlList, name templates
    rank.js          # PageRank + CheiRank by power iteration
    rankSummary.js   # the rank charts' statistics, from table rows
  ui/
    app.js           # bootstrap, wiring of SW messages, keyboard, command list
    store.js         # `state` + on/emit bus
    session.js       # the crawl on screen: rows, link graph, statistics
    port.js          # SW connection with reconnect
    setup.js status.js table.js overview.js issues.js links.js detail.js
    saved.js schedules.js palette.js exports.js
    charts.js        # hand-drawn SVG charts (line, bars, histogram, cell grid)
    rankCharts.js    # the Overview's rank charts
    components.js    # dialogs, popovers, tabs, toasts
    dom.js theme.js
  db.js              # IndexedDB layer (SW, dragon page, options page)
  metadata.js        # metadata extraction from a parsed document
  dragon.html/.js    # main page  (dragon.js only imports ui/app.js)
  options.html/.js   # UA, filter presets, storage manager
  robots.html/.js    # robots.txt overrides
  style.css          # tokens and all components
public/
  manifest.json      # copied to dist/ as-is
  theme-init.js      # sets a stored theme before first paint
  icons/
test/
  unit/              # pure modules
  e2e/               # the real extension: engine, ui, imports, rank, rank-charts
scripts/
  docs-screenshots.mjs
dist/                # built extension, gitignored
```

## Architecture

**One crawler.** Manual and scheduled crawls both run through `engine.startCrawl()`; schedules only add a trigger. Only one crawl runs at a time. A due schedule waits in `pendingScheduleIds` until `onCrawlFinished`.

**Storage** (`db.js`, IndexedDB `blue-dragon` v2):
- `crawls`: crawl metadata, key `crawl-<ts>` (out-of-line: v1 created the store that way). The key equals the OPFS directory name; the options page joins on it.
- `pages`: one record per URL, key `[crawlId, url]`, links embedded.
- `state`: resume checkpoint (queues only).

v1 stored one blob per crawl; `migrateBlobs()` converts them in `onupgradeneeded`.

**Memory model:** the SW keeps only queues, the seen set and counters. Pages go to IndexedDB in batches. The page keeps flat rows; full records are read on demand. Keep both properties: rewriting whole crawls or holding page records makes a crawl quadratic.

**SW lifetime:** the worker can die at any moment. `background.js` boots on every start, and `resumeIfNeeded()` rebuilds a running or paused crawl. `reconcile()` treats `pages` as the truth and the checkpoint as a hint, so a stale checkpoint is safe. Pause is stored immediately. `timeoutMs` stays below 30 s because Chrome kills a SW waiting longer on a fetch.

**Messages** (port `dragon-ui`; every crawl message carries `crawlId`):
- SW → page: `crawlState {active}`, `crawlProgress` (≤4/s), `pageDone {rows}` (batched; upsert by URL), `crawlComplete {status, counts}`, `crawlError`, `error`, `scheduleStart`, `scheduleComplete`, `crawlDeleted`.
- Page → SW: `startCrawl`, `pauseCrawl`, `resumeCrawl`, `stopCrawl`, `getState`.
- `runtime.sendMessage` requests, always answered `{ok, ...}`: `setSchedule`, `deleteSchedule`, `runSchedule`, `discoverLinks`, `deleteCrawl`.

A session starts from `crawlState`, on the same path as reopening a tab during a crawl. Background events never change the user's view or replace the crawl on screen.

**Table:** built once in `initTable()`, with a fixed height for Tabulator's virtual DOM. Write through `flush()`, which never overlaps: new rows with `addData`, not `updateOrAddData` (a linear lookup per row). Hidden columns need `download: true` to reach the CSV. Saved crawls load in one pass and render once (`rows-replaced`).

**Ranking** runs on demand after a crawl (`rankSession`), over crawled internal pages and followed links. Page records get `rank`, the crawl's meta gets `ranking`, and rows get raw scores: the UI shows them relative to the best page. The rank charts follow ferricrawl's definitions (percentile ties share the lowest, quarter-decade histogram steps, 20×20 grid), with top-level folders in place of segments. `session.rankSummary` caches the statistics and must be cleared when ranks change.

**Security:** everything from a crawled page is untrusted. Render it through `el()`/`textContent`, never `innerHTML`. Archived HTML is shown only in the `sandbox=""` iframe.

**Design:** colours are CSS tokens on `:root`, defined for both themes (three blocks: light, `[data-theme=dark]`, system dark). Text tokens must keep 4.5:1. Tabulator's CSS loads after `style.css`, so overrides need `.tabulator` in the selector to win.

**Accessibility:** dialogs are native and labelled, tabs follow the WAI-ARIA pattern (`initTabs`), and table rows are reached through the URL button in each row.
