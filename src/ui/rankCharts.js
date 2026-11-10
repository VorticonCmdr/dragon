// The rank charts of the Overview: where a crawl's PageRank and CheiRank sit, by
// level, by section, by kind of page, how evenly, and which pages are authorities
// or hubs. The grid and the quadrant buttons list their pages in the Pages tab.

import { summariseRanks } from '../shared/rankSummary.js';
import { barRows, cellGrid, columnChart, lineChart, percent } from './charts.js';
import { el, formatNumber } from './dom.js';
import { emit } from './store.js';
import { setExtraFilter } from './table.js';

const PR = 'var(--pr)';
const CR = 'var(--cr)';
const URLS = 'var(--text-muted)';
const GRID_HIGH_CELL = 15; // Cells are 5 percentile points wide.
const GRID_LOW_CELL = 2;

function card(title, note, ...children) {
  return el('section', { class: 'card rank-card' },
    el('h3', { class: 'card-title' }, title),
    note ? el('p', { class: 'hint rank-note' }, note) : null,
    ...children);
}

function timesAverage(v) {
  if (v >= 1) return `${Math.round(v).toLocaleString('en-US')}×`;
  return `${Number(v.toPrecision(1))}×`;
}

// ── By level ────────────────────────────────────────────────────────────────

function levelTable(levels) {
  const head = ['Level', 'HTML pages', '%', 'Ranked', 'PageRank', 'CheiRank', 'Pages total', '% total', 'PageRank total', 'CheiRank total'];
  return el('div', { class: 'tablewrap' }, el('table', { class: 'rank-table' },
    el('thead', {}, el('tr', {}, head.map(text => el('th', { scope: 'col' }, text)))),
    el('tbody', {}, levels.map(l => el('tr', {},
      el('th', { scope: 'row' }, String(l.level)),
      [formatNumber(l.html), percent(l.share), formatNumber(l.ranked), percent(l.pagerank), percent(l.cheirank),
        formatNumber(l.pagesTotal), percent(l.shareTotal), percent(l.pagerankTotal), percent(l.cheirankTotal)]
        .map(text => el('td', {}, text)))))));
}

function levelSection({ levels }) {
  const note = 'Levels count the clicks from the start URL. Rank piling up on shallow levels while the pages that should rank sit deeper is what to look for.';
  if (levels.length < 2) {
    return card('By level', null, el('p', { class: 'hint' }, 'This crawl has no levels: it did not spider from a start URL.'));
  }
  const labels = levels.map(l => String(l.level));
  const tipTitle = label => `Level ${label}`;
  const xTitle = 'Clicks from the start URL';
  const ranks = (pages, pagerank, cheirank) => [
    { name: 'HTML pages', color: URLS, values: levels.map(pages) },
    { name: 'PageRank', color: PR, values: levels.map(pagerank), area: true },
    { name: 'CheiRank', color: CR, values: levels.map(cheirank), area: true },
  ];
  return card('By level', note,
    el('div', { class: 'chartgrid chartgrid-2' },
      lineChart({ title: 'HTML pages per level', labels, tipTitle, xTitle, format: v => formatNumber(Math.round(v)), series: [{ name: 'HTML pages', color: URLS, values: levels.map(l => l.html), area: true }] }),
      lineChart({ title: 'HTML pages up to each level', labels, tipTitle, xTitle, format: percent, max: 1, series: [{ name: 'HTML pages', color: URLS, values: levels.map(l => l.shareTotal), area: true }] }),
      lineChart({ title: 'Share of rank per level', labels, tipTitle, xTitle, format: percent, series: ranks(l => l.share, l => l.pagerank, l => l.cheirank) }),
      lineChart({ title: 'Share of rank up to each level', labels, tipTitle, xTitle, format: percent, max: 1, series: ranks(l => l.shareTotal, l => l.pagerankTotal, l => l.cheirankTotal) })),
    levelTable(levels));
}

// ── By group ────────────────────────────────────────────────────────────────

function groupSection(title, note, rows, ranked) {
  if (!rows.length) return null;
  return card(title, note, barRows({
    caption: title,
    labels: rows.map(row => `${row.name} (${formatNumber(row.ranked)})`),
    measures: [
      { name: 'Ranked pages', color: URLS, values: rows.map(row => row.ranked / ranked) },
      { name: 'PageRank', color: PR, values: rows.map(row => row.pagerank) },
      { name: 'CheiRank', color: CR, values: rows.map(row => row.cheirank) },
    ],
  }));
}

// ── Spread ──────────────────────────────────────────────────────────────────

function histogramColumns(buckets, rank) {
  return buckets.map(bucket => ({
    label: timesAverage(bucket.from),
    value: bucket.pages,
    // A label at each power of ten.
    tick: Math.abs(Math.log10(bucket.from) - Math.round(Math.log10(bucket.from))) < 0.01,
    detail: `${timesAverage(bucket.from)}–${timesAverage(bucket.to)} the average: ${formatNumber(bucket.pages)} pages with ${percent(bucket.share)} of ${rank}`,
  }));
}

function spreadSection(s) {
  const pr = s.pagerankConcentration;
  const cr = s.cheirankConcentration;
  const note = `The strongest 1% of the ranked pages hold ${percent(pr[1])} of PageRank, the strongest 10% ${percent(pr[10])} and half of them ${percent(pr[50])}; for CheiRank ${percent(cr[1])}, ${percent(cr[10])} and ${percent(cr[50])}. A rank spread evenly would follow the diagonal.`;
  return card('How the rank is spread', note, el('div', { class: 'chartgrid chartgrid-3' },
    columnChart({ title: 'Pages by PageRank', columns: histogramColumns(s.pagerankHistogram, 'PageRank'), color: PR, xTitle: 'Times the average PageRank' }),
    columnChart({ title: 'Pages by CheiRank', columns: histogramColumns(s.cheirankHistogram, 'CheiRank'), color: CR, xTitle: 'Times the average CheiRank' }),
    lineChart({
      title: 'Share held by the strongest pages',
      labels: Array.from({ length: 101 }, (_, i) => `${i}%`),
      every: 20,
      format: percent,
      max: 1,
      xTitle: 'Strongest pages, % of the ranked pages',
      series: [
        { name: 'Even spread', color: URLS, values: Array.from({ length: 101 }, (_, i) => i / 100), dashed: true },
        { name: 'PageRank', color: PR, values: pr },
        { name: 'CheiRank', color: CR, values: cr },
      ],
    })));
}

// ── Authorities and hubs ────────────────────────────────────────────────────

function showQuadrant(label, urls) {
  setExtraFilter(label, row => urls.has(row.href));
  emit('show-tab', 'pages');
}

function quadrantOfCell(s, col, row) {
  const [authority, hub] = [col >= GRID_HIGH_CELL, row >= GRID_HIGH_CELL];
  if (authority && hub) return ['Authorities and hubs', s.quadrants.both];
  if (authority) return ['Authorities', s.quadrants.authorities];
  if (hub) return ['Hubs', s.quadrants.hubs];
  return col < GRID_LOW_CELL ? ['Low PageRank', s.quadrants.low] : null;
}

function quadrantSection(s) {
  const grid = cellGrid({
    title: 'Pages by PageRank and CheiRank percentile',
    cells: s.grid,
    color: PR,
    xTitle: 'PageRank percentile',
    yTitle: 'CheiRank percentile',
    lines: [{ x: GRID_HIGH_CELL }, { y: GRID_HIGH_CELL }, { x: GRID_LOW_CELL }],
    marks: [
      { col: 19.8, row: 19, text: 'Both', anchor: 'end' },
      { col: 19.8, row: 0, text: 'Authorities', anchor: 'end' },
      { col: 2.3, row: 19, text: 'Hubs' },
      { col: 0.2, row: 0, text: 'Low' },
    ],
    describe: (col, row, count) => {
      const quadrant = quadrantOfCell(s, col, row);
      return `PageRank percentile ${col * 5}–${col * 5 + 5}, CheiRank ${row * 5}–${row * 5 + 5}: ${formatNumber(count)} pages${quadrant ? ` (${quadrant[0]})` : ''}`;
    },
    onPick: {
      isPickable: (col, row) => !!quadrantOfCell(s, col, row),
      pick: (col, row) => {
        const quadrant = quadrantOfCell(s, col, row);
        if (quadrant) showQuadrant(...quadrant);
      },
    },
  });
  // The grid is mouse-only; these are the same four lists for the keyboard.
  const lists = [['Authorities', s.quadrants.authorities], ['Hubs', s.quadrants.hubs], ['Authorities and hubs', s.quadrants.both], ['Low PageRank', s.quadrants.low]];
  return card('Authorities and hubs',
    'Pages by their PageRank and CheiRank percentile. The top quarter of PageRank are authorities, of CheiRank hubs; the bottom tenth of PageRank has low PageRank. Click a cell to list its pages.',
    el('div', { class: 'rank-quadrant-layout' },
      grid,
      el('div', { class: 'rank-quadrants', role: 'group', 'aria-label': 'List pages' }, lists.map(([label, urls]) => el('button', {
        type: 'button',
        class: 'chip',
        disabled: !urls.size,
        onclick: () => showQuadrant(label, urls),
      }, label, el('span', { class: 'chip-count' }, formatNumber(urls.size)))))));
}

// Worked out once per calculation: the Overview redraws on every visit.
function summaryOf(session, rows) {
  session.rankSummary ??= summariseRanks(rows);
  return session.rankSummary;
}

export function rankCharts(session, rows) {
  const s = summaryOf(session, rows);
  if (!s.ranked) return null;
  return el('div', { class: 'rank-charts' },
    levelSection(s),
    s.sections.length > 1 ? groupSection('By site section', 'Each top-level folder\'s share of the ranked pages against its share of each rank: a section far above its share of pages gathers more rank than its size suggests.', s.sections, s.ranked) : null,
    groupSection('What kind of pages hold the rank', 'Rank held by pages a search engine will not show (errors, redirects, canonicalised pages, files, noindex) is rank the indexable pages do not get.', s.kinds, s.ranked),
    spreadSection(s),
    quadrantSection(s));
}
