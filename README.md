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

### Filtering

A regex filter can be applied to the URL list before crawling. Write a pattern in the filter field and choose **include** (keep only matching URLs) or **exclude** (remove matching URLs). Three presets are available: `uuid`, `ends with slash`, `ends with .html`.

### Crawling

Click **crawl** to start. Pages are fetched concurrently up to the configured connection limit. A progress bar tracks completion. The results table is rendered automatically when the queue is empty.

### Results table

Each row is one URL. The following columns are available (some hidden by default, toggleable via the **columns** button):

| Column | Description |
|--------|-------------|
| href | Crawled URL |
| status | HTTP status code |
| ok | Whether the response was successful |
| redirected | Whether the request was redirected |
| timestamp | Time of the request |
| canonical | `<link rel="canonical">` |
| title | `<title>` |
| description | `<meta name="description">` |
| h1 | First `<h1>` |
| og:title / og:description / og:image / og:site | Open Graph tags |
| publisher | `schema.org` publisher |
| dateModified / datePublished | `schema.org` dates |
| authors | `schema.org` author names |
| headline / altHeadline | `schema.org` headlines |
| content | Article body text (requires *extract text* setting) |
| clicks / impressions | Available if a Search Console CSV was imported |

**Search** — filter visible rows by any text.  
**Export CSV** — downloads all rows and all columns (including hidden ones).

### Saving and loading crawls

Use the **Crawls** menu to save the current crawl, load a previous one, or delete saved crawls. Crawls are stored in `chrome.storage.local`. Scheduled crawls (see below) are automatically saved here after each run.

## Configuration

Open via the **Configuration** button in the navbar.

| Setting | Default | Description |
|---------|---------|-------------|
| max retries | 0 | How many times to retry a failed URL |
| crawl delay | 288 ms | Pause between requests |
| max connections | 20 | Concurrent fetch limit |
| stay on hostname | off | Skip URLs from other hostnames |
| credentials | omit | Cookie/auth handling (`omit`, `same-origin`, `include`) |
| cache | no-store | Browser cache behaviour |
| document charset | utf-8 | Encoding used to decode response bodies |
| extract text | off | Extract article body with Mozilla Readability |

## Schedules tab

Scheduled crawls run in the background at a fixed interval — even when the extension page is closed.

### Creating a schedule

1. **Name** — a label for this schedule. `{hostname}` and `{datetime}` are replaced with the actual hostname and local time at the moment each crawl runs. Default: `{hostname} {datetime}`.
2. **URL sources** — one or more of:
   - *Spider URL* — fetches the page and crawls all linked URLs found on it
   - *URL list* — a fixed list of URLs, one per line
   - *Sitemap URL* — fetches the sitemap XML and crawls all `<loc>` entries
3. **Regex filter** — optionally filter the resolved URL list by include or exclude before crawling.
4. **Interval** — how often to run: minutes, hours, or days (minimum 1 minute).

Click **add** to save the schedule.

### Schedule cards

Each schedule shows:
- The resolved name from the last run (or the name template if not yet run)
- The configured sources and regex filter
- The crawl interval
- Last run summary: number of successful URLs, errors, and total

**Controls per card:**

| Button | Action |
|--------|--------|
| load | Loads the last crawl result directly into the table and switches to the Crawl tab |
| run now | Triggers an immediate crawl (disabled while a crawl is running) |
| on toggle | Enables or disables the scheduled interval |
| × | Deletes the schedule |

A pulsing blue dot and *crawling…* status indicate a crawl is currently in progress in the background.

Completed scheduled crawls are automatically added to **Crawls → Load** so they can be accessed later.

## Tech stack

| | |
|--|--|
| Bundler | Vite 5 |
| CSS | Tailwind CSS v3 |
| Table | Tabulator v6 |
| CSV parsing | PapaParse |
| Text extraction | @mozilla/readability |
| Background scheduling | `chrome.alarms` API (Manifest V3) |
| Storage | `chrome.storage.local` |
