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

A regex filter can be applied to the URL list before crawling. Write a pattern in the filter field and click **include** (keep only matching) or **exclude** (remove matching). Three quick presets are available: `uuid`, `ends with /`, `ends with .html`.

### Crawling

Click **crawl** to start. Pages are fetched concurrently up to the configured connection limit. A progress bar tracks completion. The results table renders automatically when the queue is empty.

### Crawl modes

| Mode | Behaviour |
|------|-----------|
| **list** | Crawls exactly the URLs in the list |
| **autonomous** | Recursive spider — discovers and follows internal links, stays on the start hostname. Automatically enables *stay on hostname*. |

In autonomous mode the **max pages limit** caps how many URLs are crawled in total.

An optional **crawl filter regex** (include or exclude) can be set in Configuration to restrict which discovered URLs are added to the queue during a recursive crawl.

### Results table

Each row is one crawled URL. Columns visible by default are marked with ✓; all others can be enabled via the **columns** toggle button.

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
| html | | View/copy stored HTML (requires *save HTML to OPFS* setting) |
| clicks / impressions | | Available if a Search Console CSV was imported |

**Search** — filter visible rows by any text.  
**Export CSV** — downloads all rows and all columns (including hidden ones).

### Internal link explorer

After an autonomous crawl, the **links** button opens a modal table of every internal link edge discovered: source URL → target URL, the `follow` status (`follow`, `nofollow`, `ugc`, `sponsored`), and the directive source (`anchor` rel attribute, `meta` robots tag, or `header` X-Robots-Tag). The table is searchable and paginated.

### Saving and loading crawls

Use the **Crawls** menu to save the current crawl, load a previous one, or delete saved crawls. Crawls are stored in `chrome.storage.local`. Scheduled crawls are automatically saved here after each run.

## Configuration

Open via the **Configuration** button in the navbar.

| Setting | Default | Description |
|---------|---------|-------------|
| crawl mode | list | `list` or `autonomous` (recursive spider) |
| max pages limit | 500 | Upper bound for autonomous mode |
| crawl filter regex | — | Regex applied to discovered URLs in autonomous mode |
| crawl filter type | off | `include` or `exclude` the regex matches |
| max retries | 0 | How many times to retry a failed URL |
| crawl delay | 288 ms | Pause between requests |
| max connections | 20 | Concurrent fetch limit |
| stay on hostname | off | Skip URLs from other hostnames (auto-enabled in autonomous mode) |
| respect robots.txt | on | Honour robots.txt rules for the active bot User-Agent |
| credentials | omit | Cookie/auth handling (`omit`, `same-origin`, `include`) |
| cache | no-store | Browser cache behaviour |
| document charset | utf-8 | Encoding used to decode response bodies |
| extract text | off | Extract article body with Mozilla Readability |
| save HTML to OPFS | off | Save raw HTML responses to the browser's Origin Private File System |
| OPFS root directory | crawl_archive | Folder name within OPFS |

## User-Agent

The extension options page (right-click the dragon icon → **Options**) lets you override the browser's User-Agent for all extension requests. Presets include common bots:

- Googlebot Desktop / Smartphone
- Googlebot-Image, Googlebot-Video, Google-Other
- Bingbot Desktop / Mobile
- YandexBot, Baiduspider, DuckDuckBot
- GPTBot, ClaudeBot
- Custom (free-text input)
- Default (browser UA)

The active bot name is extracted from the selected UA and used for robots.txt evaluation.

## Schedules tab

Scheduled crawls run in the background at a fixed interval — even when the extension page is closed.

### Creating a schedule

1. **Name** — a label for this schedule. `{hostname}` and `{datetime}` are replaced at runtime. Default: `{hostname} {datetime}`.
2. **URL sources** — one or more of:
   - *Spider URL* — fetches the page and crawls all linked URLs found on it
   - *URL list* — a fixed list of URLs, one per line
   - *Sitemap URL* — fetches the sitemap XML and crawls all `<loc>` entries
3. **Regex filter** — optionally filter the resolved URL list by include or exclude.
4. **Interval** — how often to run: minutes, hours, or days (minimum 1 minute).

Click **add** to save the schedule.

### Schedule cards

Each card shows the name, sources, regex filter, interval, and last-run summary (successful URLs, errors, total).

| Button | Action |
|--------|--------|
| load | Loads the last result into the table and switches to the Crawl tab |
| run now | Triggers an immediate crawl |
| on toggle | Enables or disables the scheduled interval |
| × | Deletes the schedule |

A pulsing blue dot and *crawling…* status indicate an in-progress background crawl. Completed crawls are automatically saved to **Crawls → Load**.

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
| Background scheduling | `chrome.alarms` API (Manifest V3) |
| Storage | `chrome.storage.local` + Origin Private File System (OPFS) |

## License

Apache 2.0 — see [LICENSE](LICENSE).
