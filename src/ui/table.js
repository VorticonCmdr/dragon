// Pages table. Built once and fed incrementally. A fixed height gives Tabulator
// its virtual DOM, so only visible rows exist in the page at any crawl size.

import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { bindPopover, toast } from './components.js';
import { $, debounce, el, formatBytes, formatDuration, formatNumber, icon, throttle } from './dom.js';
import { rankSession, statusClass } from './session.js';
import { emit, on, state } from './store.js';

const COLUMNS_KEY = 'visibleColumns';
const FLUSH_MS = 400;

const QUICK_FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'errors', label: 'Errors', test: row => ['4xx', '5xx', 'failed'].includes(statusClass(row)) },
  { id: 'redirects', label: 'Redirects', test: row => statusClass(row) === '3xx' },
  { id: 'nonindexable', label: 'Not indexable', test: row => !row.indexable && !row.isOutbound },
  { id: 'blocked', label: 'Blocked', test: row => row.blockedByRobots },
  { id: 'external', label: 'External', test: row => row.isOutbound },
];

let table = null;
let tableReady = false;
let pendingAdd = [];
let pendingUpdate = [];
let needsFullReload = false;
let writing = false;
let rewrite = false;
let quickFilter = 'all';
let extraFilter = null;      // { label, test } from a drill-down in Overview.
let search = '';
let closeColumns = () => {};

// ── Cell formatters ─────────────────────────────────────────────────────────

export function statusPill(row) {
  const kind = statusClass(row);
  const text = row.blockedByRobots ? 'blocked' : !row.fetch_status ? 'failed'
    : row.fetch_redirectStatus ? `${row.fetch_redirectStatus} → ${row.fetch_status}` : String(row.fetch_status);
  return el('span', { class: `pill pill-${kind}`, title: row.fetch_statusText || row.error || row.blockReason || undefined }, text);
}

// Host recedes and the path leads: on one site, the path is what differs.
export function urlCell(url, onOpen) {
  let host = '';
  let path = url;
  try {
    const parsed = new URL(url);
    host = parsed.host;
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    // Show the raw value.
  }
  return el('button', {
    type: 'button',
    class: 'url-cell',
    title: url,
    onclick: e => { e.stopPropagation(); onOpen(url); },
  }, el('span', { class: 'url-path' }, path), el('span', { class: 'url-host' }, host));
}

const yesNo = cell => {
  const value = cell.getValue();
  return el('span', { class: value ? 'bool bool-yes' : 'bool bool-no' }, icon(value ? 'check' : 'x', 'icon icon-xs'), value ? 'Yes' : 'No');
};
const number = cell => {
  const value = cell.getValue();
  return value === null || value === undefined ? '' : formatNumber(value);
};
const bytes = cell => formatBytes(cell.getValue());

// Raw scores sum to 1 across the crawl and are hard to read. The display is
// relative to the best page (100), which is what the CSV also gets.
export function relativeScore(value, max) {
  if (value === null || value === undefined || !max) return '';
  const score = (value / max) * 100;
  return score >= 10 ? score.toFixed(0) : score >= 1 ? score.toFixed(1) : score.toFixed(2);
}
const rankScore = key => cell => relativeScore(cell.getValue(), state.session?.meta?.ranking?.[key]);
// The CSV gets the same relative score as the screen.
const rankExport = key => value => relativeScore(value, state.session?.meta?.ranking?.[key]);
const duration = cell => formatDuration(cell.getValue());

const text = (title, field, group, extra = {}) => ({ title, field, group, visible: false, sorter: 'string', minWidth: 140, headerFilter: 'input', ...extra });
const num = (title, field, group, extra = {}) => ({ title, field, group, visible: false, sorter: 'number', hozAlign: 'right', headerHozAlign: 'right', width: 110, formatter: number, ...extra });
const bool = (title, field, group, extra = {}) => ({ title, field, group, visible: false, sorter: 'boolean', width: 104, formatter: yesNo, ...extra });

function columnDefinitions() {
  return [
    {
      title: 'URL', field: 'href', group: 'Essentials', locked: true, visible: true, minWidth: 300, widthGrow: 3,
      sorter: 'string', headerFilter: 'input', formatter: cell => urlCell(cell.getValue(), url => emit('open-page', url)),
    },
    {
      title: 'Status', field: 'fetch_status', group: 'Essentials', visible: true, width: 118, sorter: 'number',
      headerFilter: 'input', formatter: cell => statusPill(cell.getData()),
    },
    text('Title', 'title', 'Essentials', { visible: true, widthGrow: 2 }),
    bool('Indexable', 'indexable', 'Essentials', { visible: true }),
    num('Depth', 'depth', 'Essentials', { visible: true, width: 84 }),
    num('Time', 'fetch_duration', 'Essentials', { visible: true, width: 92, formatter: duration }),
    num('Size', 'fetch_encodedBodySize', 'Essentials', { visible: true, width: 92, formatter: bytes }),

    text('H1', 'h1', 'SEO'),
    text('Meta description', 'description', 'SEO'),
    text('Canonical', 'canonical', 'SEO'),
    text('Robots meta', 'robots', 'SEO'),
    text('X-Robots-Tag', 'xRobotsTag', 'SEO'),
    text('Keywords', 'keyword', 'SEO'),
    num('Hreflang tags', 'hreflang_count', 'SEO'),
    bool('Crawlable', 'crawlable', 'SEO'),

    bool('Redirected', 'fetch_redirected', 'Response'),
    num('First hop status', 'fetch_redirectStatus', 'Response'),
    text('Redirect target', 'fetch_finalUrl', 'Response'),
    text('Content type', 'fetch_contentType', 'Response'),
    text('Content encoding', 'fetch_contentEncoding', 'Response'),
    text('Charset', 'fetch_charset', 'Response'),
    num('Decoded size', 'fetch_decodedBodySize', 'Response', { formatter: bytes }),
    bool('Truncated', 'fetch_truncated', 'Response'),
    num('Retries', 'fetch_retries', 'Response'),
    text('Fetched at', 'fetch_timestamp', 'Response'),
    text('Error', 'error', 'Response'),

    num('Inbound links', 'inbound_count', 'Links'),
    num('Outbound links', 'outbound_count', 'Links'),
    num('Broken links', 'broken_outbound', 'Links'),
    bool('External', 'isOutbound', 'Links'),

    text('OG title', 'og_title', 'Open Graph'),
    text('OG description', 'og_description', 'Open Graph'),
    text('OG image', 'og_image', 'Open Graph'),
    text('OG site name', 'og_site_name', 'Open Graph'),

    text('Headline', 'schema_headline', 'Structured data'),
    text('Alternate headline', 'schema_alternateHeadline', 'Structured data'),
    text('Authors', 'schema_authors', 'Structured data'),
    text('Publisher', 'schema_publisher', 'Structured data'),
    text('Date published', 'schema_datePublished', 'Structured data'),
    text('Date modified', 'schema_dateModified', 'Structured data'),

    num('PageRank', 'pagerank', 'Ranking', { formatter: rankScore('maxPagerank'), accessorDownload: rankExport('maxPagerank'), width: 118 }),
    num('PageRank #', 'pagerank_rank', 'Ranking', { width: 110 }),
    num('CheiRank', 'cheirank', 'Ranking', { formatter: rankScore('maxCheirank'), accessorDownload: rankExport('maxCheirank'), width: 118 }),
    num('CheiRank #', 'cheirank_rank', 'Ranking', { width: 110 }),

    num('Clicks', 'clicks', 'Search data'),
    num('Impressions', 'impressions', 'Search data'),
  ];
}

// ── Column visibility ───────────────────────────────────────────────────────

function savedColumns() {
  try {
    return JSON.parse(localStorage.getItem(COLUMNS_KEY));
  } catch {
    return null;
  }
}

function saveColumns() {
  const visible = table.getColumns().filter(col => col.isVisible()).map(col => col.getField());
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(visible));
  } catch {
    // Column choice then only lasts for this page view.
  }
}

function resetColumns() {
  const defaults = columnDefinitions();
  for (const column of table.getColumns()) {
    const wanted = defaults.find(def => def.field === column.getField())?.visible;
    if (wanted) column.show(); else column.hide();
  }
  try {
    localStorage.removeItem(COLUMNS_KEY);
  } catch {
    // Nothing stored to remove.
  }
  renderColumnsPanel();
}

function renderColumnsPanel(query = '') {
  const panel = $('#columnsPanel');
  const q = query.toLowerCase();
  const groups = new Map();
  for (const column of table.getColumns()) {
    const def = column.getDefinition();
    if (def.locked || !def.title.toLowerCase().includes(q)) continue;
    if (!groups.has(def.group)) groups.set(def.group, []);
    groups.get(def.group).push(column);
  }

  const list = $('.columns-list', panel) ?? el('div', { class: 'columns-list' });
  list.replaceChildren(...[...groups].map(([group, columns]) => el('fieldset', { class: 'columns-group' },
    el('legend', {}, group),
    columns.map(column => el('label', { class: 'check' },
      el('input', {
        type: 'checkbox',
        checked: column.isVisible(),
        onchange: event => {
          if (event.target.checked) column.show(); else column.hide();
          saveColumns();
        },
      }),
      el('span', {}, column.getDefinition().title))),
  )));

  if (!panel.firstChild) {
    panel.append(
      el('div', { class: 'columns-head' },
        el('input', {
          type: 'search',
          class: 'input',
          placeholder: 'Find a column',
          'aria-label': 'Find a column',
          oninput: e => renderColumnsPanel(e.target.value),
        }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: resetColumns }, 'Reset')),
      list,
    );
  }
}

// ── Filtering ───────────────────────────────────────────────────────────────

function rowMatches(row) {
  const quick = QUICK_FILTERS.find(filter => filter.id === quickFilter);
  if (!quick.test(row)) return false;
  if (extraFilter && !extraFilter.test(row)) return false;
  if (!search) return true;
  return [row.href, row.title, row.h1].some(value => value?.toLowerCase().includes(search));
}

function applyFilters() {
  if (!tableReady) return;
  if (quickFilter === 'all' && !extraFilter && !search) table.clearFilter();
  else table.setFilter(rowMatches);
  updateEmptyState();
}

export function setQuickFilter(id) {
  quickFilter = id;
  extraFilter = null;
  renderQuickFilters();
  applyFilters();
}

export function setExtraFilter(label, test) {
  quickFilter = 'all';
  extraFilter = { label, test };
  renderQuickFilters();
  applyFilters();
}

function renderQuickFilters() {
  const rows = state.session ? [...state.session.rows.values()] : [];
  const counts = new Map(QUICK_FILTERS.map(filter => [filter.id, rows.filter(filter.test).length]));
  const chips = QUICK_FILTERS
    .filter(filter => filter.id === 'all' || counts.get(filter.id) > 0 || filter.id === quickFilter)
    .map(filter => el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(!extraFilter && quickFilter === filter.id),
      onclick: () => setQuickFilter(filter.id),
    }, filter.label, el('span', { class: 'chip-count' }, formatNumber(counts.get(filter.id)))));
  if (extraFilter) {
    chips.push(el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': 'true',
      'aria-label': `Remove filter ${extraFilter.label}`,
      onclick: () => setQuickFilter('all'),
    }, extraFilter.label, icon('x', 'icon icon-xs')));
  }
  $('#quickFilters').replaceChildren(...chips);
}

// A throttle, not a debounce: during a crawl rows never stop arriving.
const refreshChips = throttle(() => {
  renderQuickFilters();
  $('#countPages').textContent = formatNumber(state.session?.rows.size ?? 0);
}, 500);

// Tabulator's scroll container sits between role=grid and its row group. It has
// no meaning of its own, and the URL buttons in each row are the keyboard path.
export function fixGridRoles(selector) {
  const holder = $(`${selector} .tabulator-tableholder`);
  holder?.setAttribute('role', 'presentation');
  holder?.removeAttribute('tabindex');
}

// ── Data flow ───────────────────────────────────────────────────────────────

function updateEmptyState() {
  const empty = $('#pagesEmpty');
  const session = state.session;
  const hasRows = !!session?.rows.size;
  const nothingMatches = hasRows && tableReady && table.getDataCount('active') === 0;
  $('#pagesTable').hidden = !hasRows;
  empty.hidden = hasRows && !nothingMatches;
  if (empty.hidden) return;

  if (nothingMatches) {
    empty.replaceChildren(
      el('h3', {}, 'No pages match'),
      el('p', {}, 'Try a different filter.'),
      el('button', {
        class: 'btn',
        onclick: () => { search = ''; $('#tableSearch').value = ''; setQuickFilter('all'); },
      }, 'Clear filters'),
    );
  } else if (session?.loading) {
    empty.replaceChildren(el('h3', {}, 'Opening crawl…'));
  } else if (session?.live) {
    empty.replaceChildren(el('h3', {}, 'Waiting for the first page…'));
  } else {
    empty.replaceChildren(
      el('img', { src: 'icons/dragon128.png', alt: '', width: 96, height: 96 }),
      el('h3', {}, 'Nothing crawled yet'),
      el('p', {}, 'Results appear here as soon as a crawl starts, page by page.'),
      el('button', { class: 'btn btn-primary', onclick: () => emit('focus-setup') }, 'Set up a crawl'),
    );
  }
}

function isVisible() {
  return state.view === 'results' && state.tab === 'pages' && tableReady && !$('#pagesTable').hidden;
}

async function writeToTable() {
  if (needsFullReload) {
    needsFullReload = false;
    pendingAdd = [];
    pendingUpdate = [];
    await table.replaceData([...state.session.rows.values()]);
    updateEmptyState();
    return;
  }
  // addData and updateData separately: updateOrAddData looks up each row with a
  // linear scan, which turns a long crawl quadratic.
  const add = pendingAdd;
  const update = pendingUpdate;
  pendingAdd = [];
  pendingUpdate = [];
  if (add.length) await table.addData(add);
  if (update.length) await table.updateData(update);
}

// Table writes are asynchronous and must not overlap. Whatever arrives during
// one is picked up by a single follow-up.
const flush = throttle(async () => {
  if (!isVisible() || !state.session) return;
  if (writing) { rewrite = true; return; }
  writing = true;
  try {
    await writeToTable();
  } finally {
    writing = false;
  }
  if (rewrite) { rewrite = false; flush(); }
}, FLUSH_MS);

function onRows({ session, added, updated }) {
  if (session !== state.session) return;
  pendingAdd.push(...added);
  pendingUpdate.push(...updated);
  if ($('#pagesTable').hidden) {
    updateEmptyState();
    needsFullReload = true;
  }
  flush();
  refreshChips();
}

function onSession() {
  pendingAdd = [];
  pendingUpdate = [];
  needsFullReload = false;
  quickFilter = 'all';
  extraFilter = null;
  search = '';
  $('#tableSearch').value = '';
  if (tableReady) {
    table.clearData();
    table.clearFilter();
  }
  renderQuickFilters();
  updateEmptyState();
  $('#countPages').textContent = '0';
  const archived = !!state.session?.meta?.settings?.opfsEnabled;
  $('#exportZipBtn').hidden = !archived;
}

const RANK_FIELDS = ['pagerank', 'pagerank_rank', 'cheirank', 'cheirank_rank'];

function showRankColumns() {
  for (const field of RANK_FIELDS) table.getColumn(field)?.show();
  saveColumns();
}

function syncRankButton() {
  const session = state.session;
  const button = $('#rankBtn');
  const ready = !!session && !session.live && !session.loading && session.rows.size > 0;
  button.hidden = !session;
  button.disabled = !ready || ranking;
  $('#rankBtnLabel').textContent = ranking ? 'Ranking…' : session?.meta?.ranking ? 'Recalculate ranks' : 'Rank pages';
  button.title = session?.live ? 'Available when the crawl ends' : 'PageRank and CheiRank of the internal link graph';
}

let ranking = false;

export async function rankPages() {
  const session = state.session;
  if (!session || session.live || ranking) return;
  ranking = true;
  syncRankButton();
  try {
    const result = await rankSession(session);
    if (!result) return;
    if (!result.nodes) {
      toast('No internal pages to rank.');
      return;
    }
    showRankColumns();
    needsFullReload = true;
    flush();
    table.setSort('pagerank', 'desc');
    toast(`Ranked ${formatNumber(result.nodes)} pages over ${formatNumber(result.edges)} links.`, 'success');
  } catch (e) {
    toast(`Ranking failed: ${e.message}`, 'error');
  } finally {
    ranking = false;
    syncRankButton();
  }
}

export function exportCsv() {
  if (!tableReady || !state.session?.rows.size) {
    toast('There is nothing to export yet.');
    return;
  }
  const name = state.session.meta.name.replace(/[/\\:*?"<>|,]/g, '-').replace(/\s+/g, '_');
  table.download('csv', `${name}.csv`, { bom: true });
}

export function initTable() {
  const hidden = savedColumns();
  const columns = columnDefinitions().map(def => ({
    ...def,
    download: true,
    headerFilterParams: def.headerFilter ? { elementAttributes: { 'aria-label': `Filter by ${def.title}` } } : undefined,
    visible: def.locked || (hidden ? hidden.includes(def.field) : def.visible),
    resizable: true,
  }));

  $('#pagesTable').hidden = false;
  table = new Tabulator('#pagesTable', {
    height: '100%',
    index: 'href',
    layout: 'fitColumns',
    data: [],
    columns,
    movableColumns: true,
    headerFilterLiveFilterDelay: 300,
    placeholder: '',
    downloadRowRange: 'active',
  });
  table.on('tableBuilt', () => {
    tableReady = true;
    fixGridRoles('#pagesTable');
    updateEmptyState();
    flush();
  });
  table.on('rowClick', (e, row) => {
    if (!e.target.closest('button, a, input')) emit('open-page', row.getData().href);
  });
  table.on('dataFiltered', debounce(updateEmptyState, 50));

  $('#tableSearch').addEventListener('input', debounce(e => {
    search = e.target.value.trim().toLowerCase();
    applyFilters();
  }, 200));
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#rankBtn').addEventListener('click', rankPages);
  $('#rankIcon').replaceChildren(icon('rank'));

  closeColumns = bindPopover($('#columnsBtn'), $('#columnsPanel'), {
    onOpen: () => { renderColumnsPanel(); $('#columnsPanel input').focus(); },
  });

  $('#searchIcon').replaceChildren(icon('search'));
  $('#columnsIcon').replaceChildren(icon('columns'));
  $('#exportIcon').replaceChildren(icon('download'));
  $('#zipIcon').replaceChildren(icon('archive'));

  on('rows', onRows);
  on('session', onSession);
  const reloadAll = session => {
    if (session !== state.session || session.loading) return;
    needsFullReload = true;
    updateEmptyState();
    flush();
    refreshChips();
  };
  on('links', reloadAll);
  on('rows-replaced', session => { reloadAll(session); syncRankButton(); });
  on('session', syncRankButton);
  on('session-updated', syncRankButton);
  on('tab', tab => {
    if (tab !== 'pages' || !tableReady) return;
    closeColumns();
    table.redraw(true);
    if (pendingAdd.length || pendingUpdate.length || needsFullReload) {
      needsFullReload = true;
      flush();
    }
  });
  renderQuickFilters();
}
