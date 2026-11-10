// Links: every edge of the crawl's link graph. The table is created when this
// tab first opens, since many sessions never need it.

import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { $, debounce, el, formatNumber, icon } from './dom.js';
import { ensureLinks } from './session.js';
import { emit, on, state } from './store.js';
import { fixGridRoles, urlCell } from './table.js';

let table = null;
let ready = false;
let shownSession = null;

function linkStatus(cell) {
  const status = cell.getValue();
  if (status === null || status === undefined) return '';
  const kind = status === 0 ? 'failed' : status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';
  return el('span', { class: `pill pill-${kind}` }, status === 0 ? 'failed' : String(status));
}

function createTable() {
  const url = cell => urlCell(cell.getValue(), target => emit('open-page', target));
  table = new Tabulator('#linksTable', {
    height: '100%',
    layout: 'fitColumns',
    data: [],
    placeholder: '',
    columns: [
      { title: 'Source', field: 'source', minWidth: 260, widthGrow: 1, sorter: 'string', formatter: url },
      { title: 'Target', field: 'target', minWidth: 260, widthGrow: 1, sorter: 'string', formatter: url },
      { title: 'Status', field: 'status', width: 96, sorter: 'number', formatter: linkStatus },
      { title: 'Type', field: 'internal', width: 100, sorter: 'boolean', formatter: cell => (cell.getValue() ? 'Internal' : 'External') },
      { title: 'Follow', field: 'follow', width: 110, sorter: 'string' },
      { title: 'Directive', field: 'directive_source', width: 110, sorter: 'string' },
    ],
  });
  return new Promise(resolve => table.on('tableBuilt', () => {
    ready = true;
    fixGridRoles('#linksTable');
    resolve();
  }));
}

function showEmpty(title, text) {
  $('#linksTable').hidden = true;
  const empty = $('#linksEmpty');
  empty.hidden = false;
  empty.replaceChildren(el('h3', {}, title), el('p', {}, text));
  $('#linksCount').textContent = '';
}

async function render() {
  const session = state.session;
  if (state.view !== 'results' || state.tab !== 'links') return;
  if (!session?.rows.size) { showEmpty('No data yet', 'Run or open a crawl to explore its links.'); return; }
  if (session.live) { showEmpty('Available when the crawl ends', 'The link graph is built once all pages are in.'); return; }

  const { edges } = await ensureLinks(session);
  if (!edges.length) { showEmpty('No links recorded', 'This crawl has no HTML pages with links.'); return; }

  $('#linksEmpty').hidden = true;
  $('#linksTable').hidden = false;
  if (!table) await createTable();
  if (shownSession !== session) {
    shownSession = session;
    await table.replaceData(edges);
  }
  table.redraw(true);
  $('#linksCount').textContent = `${formatNumber(table.getDataCount('active'))} links`;
}

export function initLinks() {
  $('#linksSearchIcon').replaceChildren(icon('search'));
  $('#linksSearch').addEventListener('input', debounce(e => {
    if (!ready) return;
    const value = e.target.value.trim();
    if (value) table.setFilter([[{ field: 'source', type: 'like', value }, { field: 'target', type: 'like', value }]]);
    else table.clearFilter();
    $('#linksCount').textContent = `${formatNumber(table.getDataCount('active'))} links`;
  }, 200));
  on('tab', render);
  on('session', () => { shownSession = null; render(); });
  on('rows-replaced', render);
  on('links', session => { if (!session.loading) render(); });
}
