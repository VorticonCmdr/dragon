# blue dragon

A Chrome extension for crawling and SEO analysis. Opens as a full tab, fetches pages in parallel, and extracts metadata, links, and structured data into an interactive table.

**[Getting started guide →](https://vorticoncmdr.github.io/dragon/)** · [Chrome Web Store](https://chromewebstore.google.com/detail/blue-dragon/lnohkjclhmcmnadllpmgmpgchgihjehp)

## Installation

Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/blue-dragon/lnohkjclhmcmnadllpmgmpgchgihjehp), or build it yourself:

1. `npm install && npm run build`
2. Open `chrome://extensions` → enable Developer mode → **Load unpacked** → select the `dist/` folder
3. Click the dragon icon in the toolbar

Every [release](https://github.com/VorticonCmdr/dragon/releases) also has a built ZIP: unzip it and load that folder the same way.

Requires Chrome 121 or later.

## The workspace

One screen holds everything: the **setup panel** on the left, a **status bar** that always shows what the crawler is doing, and the results in four tabs: **Pages**, **Overview**, **Issues** and **Links**. Results appear row by row while the crawl runs.

Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to search every action, and <kbd>/</kbd> to filter the table. The theme follows your system; the moon icon overrides it.

### What to crawl

| Source | What it does |
|--------|--------------|
| **Website** | Starts at a URL and follows links, up to the page limit. Stays on the start hostname by default; if the start URL redirects to another host (such as `www`), the crawl stays on that one. |
| **URL list** | Crawls exactly these URLs, one per line. Duplicates and invalid lines are dropped and counted. *Add links from a page* imports every link on one page. |
| **Sitemap** | Loads a URL or file, including `.xml.gz` and sitemap indexes, into the URL list. |
| **CSV** | Loads a file with a `URL`, `Page`, `Address`, `Top pages` or `Landing page` column into the URL list. `Clicks` and `Impressions` columns become table columns. |

### URL filter

*Only matching* or *Skip matching* with a regular expression. It limits discovered links in a website crawl, and in a URL list it shows how many URLs will be crawled without changing the list. Presets from the Options page appear below the field.

### Crawling

Crawls run in the background service worker. They **survive closing the tab**, and if Chrome stops the worker the crawl resumes from its last checkpoint. **Pause** holds the crawl, also across a reload, and **Stop** ends it and keeps what was found.

### Pages

One row per URL. **Columns** opens a searchable list of every available column, grouped by topic, and remembers your choice.

| Group | Columns |
|-------|---------|
| Essentials (shown by default) | URL, status, title, indexable, depth, time, size |
| SEO | H1, meta description, canonical, robots meta, X-Robots-Tag, keywords, hreflang tags, crawlable |
| Response | Redirected, first hop status, redirect target, content type, content encoding, charset, decoded size, truncated, retries, fetched at, error |
| Links | Inbound, outbound and broken links, external |
| Open Graph | Title, description, image, site name |
| Structured data | Headline, alternate headline, authors, publisher, dates |
| Ranking | PageRank, CheiRank and their positions (after *Rank pages*) |
| Search data | Clicks, impressions (from an imported CSV) |

Redirects show every hop's first status, such as `301 → 200`. Only HTML is downloaded: other files are recorded from their headers, and HTML is capped at 5 MB.

**Quick filters** narrow the table to errors, redirects, non-indexable, blocked or external URLs, and each column has its own filter.

**Export CSV** downloads the rows currently shown, with all columns including hidden ones, and opens correctly in Excel. **HTML ZIP** appears for crawls with an HTML archive.

### Page details

Click a row to open a panel beside the table: redirect chain, response, SEO fields with length hints, links in and out, hreflang, Open Graph, structured data and response headers. Archived HTML can be previewed in a sandboxed frame. Arrows step back through the pages you visited.

### Overview

Tiles and charts for response classes, response times, status codes and content types. Everything is clickable and filters the Pages tab to the rows behind the number.

### PageRank and CheiRank

**Rank pages** (in the Pages toolbar, the Overview, or ⌘K) scores every crawled page from the crawl's internal link graph, on demand once a crawl has ended:

- **PageRank** is high for pages that many strong pages link to.
- **CheiRank** is PageRank of the reversed graph: high for hubs whose links reach the most.

Both use the random-surfer model with damping 0.85. Links marked `nofollow`, `ugc` or `sponsored` carry no score, external URLs and pages blocked by robots.txt are left out, and a page without links out spreads its score evenly. Scores are shown relative to the best page (100), with the position (`#1`, `#2`, …) beside them, in the table, the page details and the Overview's top-ten lists. The result is stored with the crawl and exported to CSV.

Once ranked, the Overview also shows where the rank sits:

| Chart | What it answers |
|-------|-----------------|
| **By level** | How pages and rank are distributed over clicks from the start URL, per level and cumulative, with a table. Only for crawls started from one URL. |
| **By site section** | Each top-level folder's share of pages against its share of each rank. |
| **What kind of pages hold the rank** | How much rank sits on errors, redirects, canonicalised, non-HTML and noindex pages instead of indexable ones. |
| **How the rank is spread** | Histograms in multiples of the average rank, and how much the strongest pages hold. |
| **Authorities and hubs** | Pages by PageRank and CheiRank percentile. The top quarter of PageRank are authorities, of CheiRank hubs, and the bottom tenth of PageRank is low PageRank. Click a cell or a button to list those pages. |

### Links

Every link in the crawl: source, target, target status, internal or external, and its `follow` directive (`follow`, `nofollow`, `ugc`, `sponsored`) with where that came from (`anchor` or `meta`). Available once a crawl has ended.

### Saved crawls

Every crawl is saved automatically while it runs, including partial ones. **Saved crawls** in the top bar opens, renames and deletes them; scheduled crawls are marked. Data lives in IndexedDB, one record per URL, and crawls from older versions are converted on first start.

## Issues

The **Issues** tab reports what needs attention, most serious first. Click a row to open that page's details.

| Check | Severity | Description |
|-------|----------|-------------|
| Broken pages | Error | Pages answering 4xx or 5xx, or not at all |
| Pages linking to broken URLs | Error | Links from crawled pages to failing URLs |
| Broken external links | Error | External URLs that failed the link check |
| Redirected pages | Warning | Requested URLs that redirect |
| Blocked by robots.txt | Warning | URLs not fetched because of robots.txt |
| Missing title | Warning | HTML pages without `<title>` |
| Duplicate titles | Warning | Title text shared by several pages |
| Multiple canonicals | Warning | More than one canonical declaration, from tags or the `Link` header |
| Noindex pages | Notice | Excluded through robots meta, `googlebot` meta or `X-Robots-Tag` |
| Missing H1 / meta description / canonical | Notice | HTML pages without them |
| Truncated pages | Notice | Pages over the 5 MB limit |

## Advanced settings

Under **Advanced** in the setup panel.

| Setting | Default | Description |
|---------|---------|-------------|
| Parallel requests | 5 | Requests in flight at once, up to 32 |
| Delay per host | none | Minimum time between requests to one host. A larger robots.txt `Crawl-delay` wins. |
| Retries | 2 | Retries after network errors, 5xx and 429, with backoff. `Retry-After` is honoured. |
| Respect robots.txt | on | Blocked URLs are listed but not fetched. A 4xx robots.txt allows everything; a 5xx or unreachable one blocks the host, per RFC 9309. |
| Check external links | off | Checks the status of each external link. External URLs are not crawled further. |
| Archive HTML of each page | off | Stores raw HTML in the browser's Origin Private File System |
| Archive folder | crawl_archive | Folder name within OPFS |
| Cookies and credentials | Never send | Cookie and auth handling |
| HTTP cache | Always fetch, keep cache untouched | Browser cache behaviour |
| Fallback charset | utf-8 | Used when neither the header nor `<meta>` declare a charset |

## robots.txt management

A dedicated page, linked under **Advanced** in the setup panel, lets you view and override the robots.txt content for any crawled hostname, so you can control crawl behaviour without modifying the live server.

- **Fetched robots.txt** — the file last retrieved from the server (read-only).
- **Override** — replaces the fetched file during crawls. Leave it empty to allow everything.
- **Save override** — takes effect on the next crawl.
- **Remove override** — goes back to the live file.
- **Fetch again** — downloads the live file again.
- **Add an override** — enter any site, optionally click **Fetch current file**, edit, and save.

## Options page

Use the gear icon in the top bar, or right-click the dragon icon → **Options**.

### User-Agent

Lets you override the browser's User-Agent for all extension requests. Presets include common bots:

- Googlebot Desktop / Smartphone
- Googlebot-Image, Googlebot-Video, Google-Other
- Bingbot Desktop / Mobile
- YandexBot, Baiduspider, DuckDuckBot
- GPTBot, ClaudeBot
- Custom (free-text input)
- Default (browser UA)

The active bot name is extracted from the selected UA and used for robots.txt evaluation.

### URL filter presets

Named regular expressions that appear as chips under the URL filter. Each stores a name, a pattern and a mode; clicking one fills in the filter.

| Field | Description |
|-------|-------------|
| Name | Display label for the preset |
| Regex | Regular expression pattern |
| Mode | *Only matching* or *Skip matching* |

### Storage

- **Storage bar** — total browser storage used and available.
- **Crawl list** — all saved crawls and HTML archives. Archives whose crawl no longer exists are flagged.
- **Rename** — renames the crawl.
- **↓ ZIP** — downloads the crawl's HTML archive.
- **Delete data**, **Delete HTML archive**, **Delete everything** — remove the crawl's data, its archive, or both.

## Schedules

Recurring crawls run in the background while Chrome is open, even with the tab closed. They use the same crawler and the same *Advanced* settings as manual crawls.

**New schedule** asks for a name (`{hostname}` and `{datetime}` are filled in at run time), a mode, a start URL or list of URLs and sitemaps, a page limit, an optional URL filter, and how often to run.

Each schedule shows its next run and last result, with **Open last result**, **Run now**, **Pause** and delete. Only one crawl runs at a time: if a schedule comes due during another crawl, even a paused one, it is queued and starts when that crawl ends. Finished runs appear in **Saved crawls**.

## Tech stack

| | |
|--|--|
| Bundler | Vite 5 |
| CSS | Tailwind CSS v3 |
| Table | Tabulator v6 |
| CSV parsing | PapaParse |
| Robots.txt parsing | google-robotstxt-parser |
| HTML parsing | node-html-parser |
| Sitemap gzip, ZIP export | `DecompressionStream`, fflate |
| Background scheduling | `chrome.alarms` API (Manifest V3) |
| Storage | IndexedDB, `chrome.storage.local`, Origin Private File System (OPFS) |

## Development

```bash
npm test             # unit tests, no browser needed
npm run test:e2e     # builds, then runs the extension in Chrome for Testing
npm run screenshots  # retakes the images in docs/screenshots
```

The end-to-end suites need Chrome for Testing, since branded Chrome ignores `--load-extension`. Install it with `npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer`, or set `CHROME` to its path. They only talk to local servers and load a temporary copy of `dist/`. `node test/e2e/run-all.mjs rank ui` runs a selection.

Timing checks report `SLOW` under load instead of failing.

### Releasing

1. Raise `version` in both `public/manifest.json` and `package.json`.
2. Commit, then tag and push: `git tag v0.1.0 && git push origin main v0.1.0`.

The *Build & Release* workflow runs the unit tests, builds, and attaches `blue-dragon-<version>.zip` to a GitHub release. It refuses to release when the tag, the manifest and `package.json` disagree. The ZIP has `manifest.json` at its root, so it uploads to the Chrome Web Store as it is. Pushes to `main` run the same build and keep the ZIP as a workflow artifact.

## License

Apache 2.0 — see [LICENSE](LICENSE).
