# blue dragon

A Chrome extension for crawling and SEO analysis. Opens as a full tab, fetches pages in parallel, and extracts metadata, structured data, and article text into an interactive table.

## Installation

1. `npm install && npm run build`
2. Open `chrome://extensions` → enable Developer mode → **Load unpacked** → select the `dist/` folder
3. Click the dragon icon in the toolbar

## Crawl tab

### Building a URL list

**Spider URL** — enter a page URL and click **fetch**. The extension fetches the page and extracts all linked URLs into the URL list below.

**URL list** — paste or type URLs directly, one per line.

**CSV import** — via the **URLs → CSV** menu. Drag & drop or pick a CSV file. Columns named `URL`, `page`, or `Page` are imported as URLs.

**Sitemap import** — via the **URLs → sitemap** menu. Enter a sitemap XML URL (including `.gz` sitemaps). All `<loc>` entries are appended to the URL list.

### Filtering the URL list

A regex filter can be applied to the URL list before crawling. Write a pattern in the filter field and click **include** (keep only matching) or **exclude** (remove matching). Three quick presets are available: `uuid`, `ends with /`, `ends with .html`. Custom named presets can be saved and managed in the extension Options page and will appear in the same dropdown with their type applied automatically on click.

The URL counter turns **orange** when the number of entered URLs exceeds the configured max pages limit while in list mode.

### Crawling

Click **crawl** to start. Pages are fetched concurrently up to the configured connection limit. A progress bar tracks completion. The results table renders automatically when the queue is empty.

The crawl runs in the background service worker and **survives closing the extension tab** — reopen the tab at any time to reconnect and see current progress.

### Crawl modes

| Mode | Behaviour |
|------|-----------|
| **list** | Crawls exactly the URLs in the list |
| **autonomous** | Recursive spider — discovers and follows internal links, stays on the start hostname. Automatically enables *stay on hostname*. |

In autonomous mode the **max pages limit** caps how many URLs are crawled in total.

An optional **crawl filter regex** (include or exclude) can be set in Configuration to restrict which discovered URLs are added to the queue during a recursive crawl.

In **list mode**, outbound links (links to external hosts) are detected on each page and stored for the link explorer. If **fetch outbound** is enabled in Configuration, those external URLs are also fully crawled (status code, title, H1, etc.) and appear in the results table with the `outbound` column set to `true`. They are not added to the recursive queue.

### Results table

Each row is one crawled URL. Rows are colour-coded by HTTP status: red for 4xx/5xx, amber for 3xx. Columns visible by default are marked with ✓; all others can be enabled via the **columns** toggle button.

| Column | Default | Description |
|--------|:-------:|-------------|
| url | ✓ | Crawled URL |
| status | ✓ | HTTP status code |
| duration (ms) | ✓ | Response time |
| redirected | ✓ | Whether the request was redirected |
| encoded size | ✓ | Compressed response size |
| crawlable | ✓ | Whether the active bot UA is allowed by robots.txt |
| canonical | | `<link rel="canonical">` |
| title | | `<title>` |
| description | | `<meta name="description">` |
| keyword | | `<meta name="keywords">` |
| robots | | `<meta name="robots">` content |
| h1 | | First `<h1>` |
| content-type | | `Content-Type` response header |
| decoded size | | Uncompressed response size |
| deliveryType | | Cache delivery type from Performance API |
| timestamp | | Time of the request |
| ok | | Whether the response was successful (2xx) |
| og:image / og:title / og:site / og:description | | Open Graph tags |
| publisher | | `schema.org` publisher name |
| dateModified / datePublished | | `schema.org` dates |
| authors | | `schema.org` author names |
| headline / altHeadline | | `schema.org` headlines |
| content | | Article body text (requires *extract text* setting) |
| outbound links | | Number of internal links found on the page (autonomous mode) |
| inbound links | | Number of internal links pointing to this page (autonomous mode) |
| outbound | ✓ | Whether this URL was crawled as an outbound-only link (list mode + fetch outbound) |
| broken outbound | | Number of outbound links resolving to a 4xx/5xx response |
| html | | View/copy stored HTML (requires *save HTML to OPFS* setting) |
| clicks / impressions | | Available if a Search Console CSV was imported |

**Search** — filter visible rows by any text.  
**Export CSV** — downloads all rows and all columns (including hidden ones, except the internal HTML file path). The filename follows the crawl-save naming convention: `{hostname}_{datetime}.csv`.

### URL detail view

Click any row to open a detail panel for that URL. The panel shows:

- All crawled fields grouped by category (fetch metadata, Open Graph, Schema.org, custom data, …)
- **Outbound links** — every link found on the page, with its HTTP status, `follow` attribute, and directive source. Rows are colour-coded (red = broken, amber = redirect). Click a row to drill into that URL's detail view.
- **Inbound links** — every crawled page that links to this URL, with the same columns and drill-down behaviour.

### Internal link explorer

After an autonomous crawl, the **links** button opens a modal table of every internal link edge discovered: source URL → target URL, the `follow` status (`follow`, `nofollow`, `ugc`, `sponsored`), and the directive source (`anchor` rel attribute, `meta` robots tag, or `header` X-Robots-Tag). The table is searchable and paginated.

### Saving and loading crawls

Use the **Crawls** menu to save the current crawl, load a previous one, or delete saved crawls. Crawls are stored in `chrome.storage.local`. Scheduled crawls are automatically saved here after each run. Saved crawls are named `{hostname} {datetime}` by default.

## Issues tab

After a crawl, the **Issues** tab runs a set of SEO checks across all crawled HTML pages and lists findings grouped by severity.

| Check | Severity | Description |
|-------|----------|-------------|
| Broken pages | Error | Pages returning 4xx or 5xx |
| Robots-blocked | Error | Pages blocked by robots.txt for the active UA |
| Redirects | Warning | Pages returning 3xx |
| Missing title | Warning | HTML pages with no `<title>` |
| Missing H1 | Warning | HTML pages with no `<h1>` |
| Missing description | Warning | HTML pages with no meta description |
| Missing canonical | Info | HTML pages with no canonical tag |
| Duplicate titles | Warning | Title text shared by more than one HTML page |
| Broken outbound links | Warning | Pages that link to URLs returning 4xx/5xx |

Checks for title, H1, description, canonical, and duplicate titles are only applied to pages with a `text/html` content type. Clicking an issue row opens the URL detail view for that page.

## Configuration

Open via the **Configuration** button in the navbar.

| Setting | Default | Description |
|---------|---------|-------------|
| crawl mode | list | `list` or `autonomous` (recursive spider) |
| max pages limit | 500 | Upper bound for autonomous mode |
| crawl filter regex | — | Regex applied to discovered URLs in autonomous mode |
| crawl filter type | off | `include` or `exclude` the regex matches |
| max retries | 2 | How many times to retry a failed URL |
| crawl delay | 0 ms | Pause between requests |
| max connections | 5 | Concurrent fetch limit |
| stay on hostname | off | Skip URLs from other hostnames (auto-enabled in autonomous mode) |
| respect robots.txt | on | Honour robots.txt rules for the active bot User-Agent |
| fetch outbound | off | In list mode: fully crawl discovered outbound links (all stats) without adding them to the queue |
| credentials | omit | Cookie/auth handling (`omit`, `same-origin`, `include`) |
| cache | no-store | Browser cache behaviour |
| document charset | utf-8 | Encoding used to decode response bodies |
| extract text | off | Extract article body with Mozilla Readability |
| save HTML to OPFS | off | Save raw HTML responses to the browser's Origin Private File System |
| OPFS root directory | crawl_archive | Folder name within OPFS |

A **manage overrides →** link in the robots.txt row opens the robots.txt management page.

## robots.txt management

A dedicated page (`robots.txt management`) is accessible from the Configuration modal. It lets you view and override the robots.txt content for any crawled hostname, so you can control crawl behaviour without modifying the live server.

- **Fetched** column — the robots.txt retrieved from the server (read-only).
- **Override** column — editable content that replaces the fetched robots.txt during crawls. Leave empty to allow all.
- **Save override** — stores the override in `chrome.storage.local`; takes effect on the next crawl.
- **Clear override** — removes the override and reverts to the fetched robots.txt.
- **Re-fetch** — re-downloads the live robots.txt from the server.
- **Add override for new origin** — enter any origin URL, optionally click **Fetch** to populate the textarea with the live robots.txt, edit as needed, and click **Save override**.

## Options page

Right-click the dragon icon → **Options** (or navigate to the options URL from `chrome://extensions`).

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

### URL-Filter Presets

Named regex presets that appear in the **regex** dropdown on the crawl page. Each preset stores a name, a pattern, and a type (include or exclude). Clicking a saved preset applies it to the URL list immediately.

| Field | Description |
|-------|-------------|
| Name | Display label for the preset |
| Regex | Regular expression pattern |
| Type | `include` (keep matching) or `exclude` (remove matching) |

### Saved Crawls

Storage management for all IndexedDB (IDB) and OPFS crawl data.

- **Storage quota bar** — shows total browser storage used vs. available.
- **Crawl list** — unified view of all IDB entries and OPFS directories matched by crawl ID. Newest crawls appear first; OPFS directories without a matching IDB entry are flagged as **orphans**.
- **Rename** — inline rename of the crawl name in IDB (press Enter or click away to save).
- **↓ ZIP** — downloads all HTML files stored in the OPFS directory for that crawl as a ZIP archive.
- **Delete IDB** — removes the JSON result blob from IndexedDB; OPFS files are kept.
- **Delete OPFS** — removes the HTML archive directory from OPFS; IDB entry is kept.
- **Delete all** — removes both IDB and OPFS data for the crawl.

## Schedules tab

Scheduled crawls run in the background at a fixed interval — even when the extension page is closed.

### Creating a schedule

1. **Name** — a label for this schedule. `{hostname}` and `{datetime}` are replaced at runtime. Default: `{hostname} {datetime}`.
2. **URL sources** — one or more of:
   - *Spider URL* — fetches the page and crawls all linked URLs found on it
   - *URL list* — a fixed list of URLs, one per line
   - *Sitemap URL* — fetches the sitemap XML and crawls all `<loc>` entries
3. **Regex filter** — optionally filter the resolved URL list by include or exclude.
4. **Frequency** — how often to run: Hourly, Every 2h / 4h / 6h / 12h, Daily, or Weekly.
5. **At time** — anchor the run to a specific time of day (e.g. `03:00`). Hourly and multi-hour schedules use this as the starting point on the period grid; daily schedules fire at exactly this time each day.
6. **Day** — (Weekly only) the day of the week to run.

Click **add** to save the schedule.

### Schedule table

Each row shows: property (the crawl target), interval, last run time with ok/total stats, next scheduled run, and status.

| Status | Meaning |
|--------|---------|
| `active` (green) | Schedule is enabled and waiting for its next run |
| `N/M pages` (blue, pulsing) | Crawl is running — live page count updated in real time |
| `paused` (grey) | Schedule is disabled |

| Button | Action |
|--------|--------|
| ↓ | Loads the last result into the table and switches to the Crawl tab |
| ⚡ | Triggers an immediate crawl (disabled while a run is in progress) |
| pause / resume | Enables or disables the scheduled interval |
| ✕ | Deletes the schedule |

Completed crawls are automatically saved to **Crawls → Load**. If a scheduled crawl fires while a manual crawl is already running, it is queued and starts as soon as the manual crawl finishes.

## Log tab

Live feed of all fetch events during a crawl — URL, status code, duration, and any errors.

## Tech stack

| | |
|--|--|
| Bundler | Vite 5 |
| CSS | Tailwind CSS v3 |
| Table | Tabulator v6 |
| CSV parsing | PapaParse |
| Text extraction | @mozilla/readability |
| Robots.txt parsing | google-robotstxt-parser |
| HTML parsing | node-html-parser |
| Background scheduling | `chrome.alarms` API (Manifest V3) |
| Storage | `chrome.storage.local` + Origin Private File System (OPFS) |

## License

Apache 2.0 — see [LICENSE](LICENSE).
