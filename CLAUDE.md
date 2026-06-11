# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Blue Dragon** is a Manifest V3 Chrome extension that functions as a web crawler and SEO analysis tool. Click the extension icon → opens `dragon.html` as a new tab.

## Build

```bash
npm install          # first time
npm run build        # production build → dist/
npm run dev          # watch mode (rebuilds on change)
```

**Load in Chrome:** `chrome://extensions` → "Load unpacked" → select `dist/`. Reload extension after each `npm run build`.

## Tech stack

| Layer | Tech |
|-------|------|
| Bundler | Vite (root: `src/`, output: `dist/`) |
| CSS | Tailwind CSS v3 (light mode, purge scans `src/**`) |
| Table | Tabulator v6 (`TabulatorFull`) |
| CSV parsing | PapaParse |
| Text extraction | `@mozilla/readability` |
| Modals | Native `<dialog>` with `showModal()`/`close()` |
| JS | Vanilla ES modules (no jQuery, no framework) |

## File structure

```
src/
  dragon.html     # single crawler page (Tailwind, <dialog> modals)
  dragon.js       # all crawler logic (ES module, entry point)
  style.css       # Tailwind directives + Tabulator overrides
public/
  manifest.json   # MV3 manifest (copied to dist/ as-is)
  background.js   # opens dragon.html on icon click
  icons/          # extension icons
dist/             # built extension — gitignored, load this into Chrome
```

## Architecture

**State object** (`crawl` in `dragon.js`): holds `data.queue`, `data.results`, `data.alreadyFetched`, `settings`, `csv.data`. Saved to `chrome.storage.local` keyed as `crawl-<timestamp>`.

**Crawl flow:**
1. Spider button: fetch one URL → extract all links into queue
2. Crawl button: process queue with `fetchURL()` concurrently (up to `maxConnections`)
3. Each page: extract metadata → store in `crawl.data.results[href]`
4. Queue empty → `parseData()` flattens results and renders Tabulator table

**Table** (`parseData()`): `dict2flatarray()` flattens nested objects (e.g. `{og: {title}}` → `{og_title}`). Creates/updates a Tabulator instance in `#jsonTable`. Export via `table.download('csv', ...)`. Column visibility via `column.toggle()`.

**Readability mode**: when `crawl.settings.readability` is on, `@mozilla/readability` extracts article text after removing `<header>`, `<footer>`, `<nav>`. Stored as `metadata.content` and `metadata.paragraphs`.

**Dialogs**: all modals are native `<dialog>` elements. Open with `el.showModal()`, close with `el.close()` or backdrop click. No JS framework needed.

**Dropdowns**: custom via `data-menu` attribute + `closeAllMenus()` on document click. `data-dialog` attribute wires buttons to open dialogs.

## Tabulator customization

Tabulator CSS is imported in `dragon.js` and overridden in `style.css` to match the Tailwind palette (`slate-*`, `blue-*`). Column definitions in `parseData()` — hidden columns are still exported in CSV via `table.download()`.
