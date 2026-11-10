// What the rank charts show, worked out from table rows. Pure, so it can be
// tested without a browser. A row counts as ranked when it has a PageRank.

import { hostnameOf } from './url.js';

// Top quarter of a rank: authority (PageRank) or hub (CheiRank). Bottom tenth
// of PageRank: low PageRank.
export const HIGH_PERCENTILE = 75;
export const LOW_PERCENTILE = 10;
const GRID_SIZE = 20;
const MAX_SECTIONS = 12;

// Rank held by what a search engine will not show is rank that indexable pages
// do not get. A page is its first match. Blocked pages are not in the graph.
export const KINDS = ['No response', 'Server error (5xx)', 'Client error (4xx)', 'Redirect', 'Canonicalised', 'Not HTML', 'Noindex', 'Indexable'];

function kindOf(row) {
  if (!row.fetch_status) return 'No response';
  if (row.fetch_status >= 500) return 'Server error (5xx)';
  if (row.fetch_status >= 400) return 'Client error (4xx)';
  if (row.fetch_redirected || row.fetch_status >= 300) return 'Redirect';
  if (row.canonical && row.canonical !== row.href) return 'Canonicalised';
  if (!isHtml(row)) return 'Not HTML';
  return row.indexable ? 'Indexable' : 'Noindex';
}

function isHtml(row) {
  return /html/i.test(row.fetch_contentType ?? '');
}

// The first folder of a URL. Pages directly under the root share "Top level".
export function sectionOf(url) {
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return 'Top level';
  }
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 || (parts.length === 1 && path.endsWith('/')) ? `/${parts[0]}/` : 'Top level';
}

// Per value, the share of values below it in percent. Ties share the lowest.
export function percentiles(values) {
  const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
  const out = new Float64Array(values.length);
  let below = 0;
  order.forEach((index, k) => {
    if (k > 0 && values[index] > values[order[k - 1]]) below = k;
    out[index] = (below * 100) / order.length;
  });
  return out;
}

// Quarter-decade steps around the average, the only scale on which pages from
// 0.01× to 100× the average are all visible. A rank of 0 joins the lowest step.
function histogram(values, ranked) {
  const average = 1 / ranked;
  const steps = new Map();
  let zero = { pages: 0, share: 0 };
  for (const value of values) {
    if (value <= 0) { zero = { pages: zero.pages + 1, share: zero.share + value }; continue; }
    const step = Math.floor(Math.log10(value / average) * 4);
    const entry = steps.get(step) ?? { pages: 0, share: 0 };
    steps.set(step, { pages: entry.pages + 1, share: entry.share + value });
  }
  if (!steps.size && !zero.pages) return [];
  const keys = [...steps.keys()];
  const lo = keys.length ? keys.reduce((a, b) => Math.min(a, b)) : 0;
  const hi = keys.length ? keys.reduce((a, b) => Math.max(a, b)) : 0;
  const bound = k => Math.round(10 ** (k / 4) * 1e4) / 1e4;
  const buckets = [];
  for (let k = lo; k <= hi; k++) {
    const entry = steps.get(k) ?? { pages: 0, share: 0 };
    const extra = k === lo ? zero : { pages: 0, share: 0 };
    buckets.push({ from: bound(k), to: bound(k + 1), pages: entry.pages + extra.pages, share: entry.share + extra.share });
  }
  return buckets;
}

// Index k: the share held by the strongest k percent of pages.
function concentration(values) {
  const sorted = [...values].sort((a, b) => b - a);
  const sums = [0];
  for (const value of sorted) sums.push(sums.at(-1) + value);
  const total = sums.at(-1) || 1;
  return Array.from({ length: 101 }, (_, k) => sums[Math.ceil((k * sorted.length) / 100)] / total);
}

function addTo(groups, name, row) {
  const group = groups.get(name) ?? { name, ranked: 0, pagerank: 0, cheirank: 0 };
  group.ranked++;
  group.pagerank += row.pagerank;
  group.cheirank += row.cheirank;
  groups.set(name, group);
}

function sectionRows(ranked) {
  const groups = new Map();
  for (const row of ranked) addTo(groups, sectionOf(row.href), row);
  const sorted = [...groups.values()].sort((a, b) => b.pagerank - a.pagerank);
  if (sorted.length <= MAX_SECTIONS) return sorted;
  const rest = sorted.slice(MAX_SECTIONS).reduce((sum, group) => ({
    name: 'Other sections',
    ranked: sum.ranked + group.ranked,
    pagerank: sum.pagerank + group.pagerank,
    cheirank: sum.cheirank + group.cheirank,
  }), { ranked: 0, pagerank: 0, cheirank: 0 });
  return [...sorted.slice(0, MAX_SECTIONS), rest];
}

function levelRows(rows) {
  const internal = rows.filter(row => !row.isOutbound && row.depth !== null && row.depth !== undefined);
  const levels = new Map();
  for (const row of internal) {
    const level = levels.get(row.depth) ?? { level: row.depth, html: 0, ranked: 0, pagerank: 0, cheirank: 0 };
    if (isHtml(row)) level.html++;
    if (row.pagerank !== null && row.pagerank !== undefined) {
      level.ranked++;
      level.pagerank += row.pagerank;
      level.cheirank += row.cheirank;
    }
    levels.set(row.depth, level);
  }
  const sorted = [...levels.values()].sort((a, b) => a.level - b.level);
  const allHtml = sorted.reduce((sum, level) => sum + level.html, 0);
  let [pages, pagerank, cheirank] = [0, 0, 0];
  return sorted.map(level => {
    pages += level.html;
    pagerank += level.pagerank;
    cheirank += level.cheirank;
    return {
      ...level,
      share: allHtml ? level.html / allHtml : 0,
      pagesTotal: pages,
      shareTotal: allHtml ? pages / allHtml : 0,
      pagerankTotal: pagerank,
      cheirankTotal: cheirank,
    };
  });
}

export function summariseRanks(rows) {
  const ranked = rows.filter(row => row.pagerank !== null && row.pagerank !== undefined);
  const pagerank = ranked.map(row => row.pagerank);
  const cheirank = ranked.map(row => row.cheirank);
  const pagerankPercentile = percentiles(pagerank);
  const cheirankPercentile = percentiles(cheirank);

  const grid = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(0));
  const quadrants = { authorities: new Set(), hubs: new Set(), both: new Set(), low: new Set() };
  const kinds = new Map();
  ranked.forEach((row, i) => {
    const pr = pagerankPercentile[i];
    const cr = cheirankPercentile[i];
    const bin = percentile => Math.min(GRID_SIZE - 1, Math.floor(percentile / 5));
    grid[bin(pr)][bin(cr)]++;
    const [authority, hub] = [pr >= HIGH_PERCENTILE, cr >= HIGH_PERCENTILE];
    if (authority && hub) quadrants.both.add(row.href);
    else if (authority) quadrants.authorities.add(row.href);
    else if (hub) quadrants.hubs.add(row.href);
    else if (pr < LOW_PERCENTILE) quadrants.low.add(row.href);
    addTo(kinds, kindOf(row), row);
  });

  return {
    ranked: ranked.length,
    levels: levelRows(rows),
    sections: sectionRows(ranked),
    kinds: KINDS.filter(kind => kinds.has(kind)).map(kind => kinds.get(kind)),
    hosts: new Set(ranked.map(row => hostnameOf(row.href))).size,
    pagerankHistogram: histogram(pagerank, ranked.length),
    cheirankHistogram: histogram(cheirank, ranked.length),
    pagerankConcentration: concentration(pagerank),
    cheirankConcentration: concentration(cheirank),
    grid,
    quadrants,
  };
}
