// Overview: the crawl at a glance. Every number leads to the pages behind it.

import { $, el, formatBytes, formatDuration, formatNumber, icon, throttle } from './dom.js';
import { LATENCY_BUCKETS, STATUS_CLASSES, computeStats, statusClass } from './session.js';
import { emit, on, state } from './store.js';
import { rankCharts } from './rankCharts.js';
import { rankPages, relativeScore, setExtraFilter, setQuickFilter } from './table.js';

const MAX_CONTENT_TYPES = 8;

function showPages(apply) {
  apply();
  emit('show-tab', 'pages');
}

function tile({ label, value, note, onClick }) {
  return el('button', { type: 'button', class: 'tile', onclick: onClick },
    el('span', { class: 'tile-label' }, label),
    el('span', { class: 'tile-value' }, value),
    el('span', { class: 'tile-note' }, note ?? ''));
}

function percent(part, total) {
  return total ? `${Math.round((part / total) * 100)}%` : '–';
}

function tiles(stats) {
  const { classes, total, internal, indexable } = stats;
  const errors = classes['4xx'] + classes['5xx'] + classes.failed;
  return el('div', { class: 'tiles' },
    tile({ label: 'URLs crawled', value: formatNumber(total), note: `${formatNumber(stats.external)} external`, onClick: () => showPages(() => setQuickFilter('all')) }),
    tile({ label: 'Errors', value: formatNumber(errors), note: percent(errors, total), onClick: () => showPages(() => setQuickFilter('errors')) }),
    tile({ label: 'Redirects', value: formatNumber(classes['3xx']), note: percent(classes['3xx'], total), onClick: () => showPages(() => setQuickFilter('redirects')) }),
    tile({ label: 'Indexable', value: percent(indexable, internal), note: `${formatNumber(indexable)} of ${formatNumber(internal)} pages`, onClick: () => showPages(() => setQuickFilter('nonindexable')) }),
    tile({ label: 'Blocked by robots', value: formatNumber(classes.blocked), note: percent(classes.blocked, total), onClick: () => showPages(() => setQuickFilter('blocked')) }),
    tile({ label: 'Median response', value: formatDuration(stats.medianMs), note: `${formatBytes(stats.bytes)} downloaded`, onClick: () => showPages(() => setQuickFilter('all')) }),
  );
}

function statusSection(stats) {
  const present = STATUS_CLASSES.filter(c => stats.classes[c.id] > 0);
  const bar = el('div', { class: 'stack', role: 'img', 'aria-label': present.map(c => `${c.label}: ${stats.classes[c.id]}`).join(', ') },
    present.map(c => el('div', {
      class: `stack-seg tone-${c.tone}`,
      style: `flex-grow:${stats.classes[c.id]}`,
      title: `${c.label}: ${formatNumber(stats.classes[c.id])}`,
    })));
  const legend = el('ul', { class: 'legend' }, present.map(c => el('li', {},
    el('button', {
      type: 'button',
      class: 'legend-item',
      onclick: () => showPages(() => setExtraFilter(c.label, row => statusClass(row) === c.id)),
    },
    el('span', { class: `legend-mark tone-${c.tone}` }, icon(c.icon, 'icon icon-xs')),
    el('span', { class: 'legend-label' }, c.label),
    el('span', { class: 'legend-value' }, formatNumber(stats.classes[c.id])),
    el('span', { class: 'legend-share' }, percent(stats.classes[c.id], stats.total))))));
  return card('Response classes', bar, legend);
}

function rankedList(entries, total, onPick) {
  const max = Math.max(...entries.map(([, count]) => count), 1);
  return el('ul', { class: 'ranked' }, entries.map(([label, count]) => el('li', {},
    el('button', { type: 'button', class: 'ranked-row', onclick: () => onPick(label) },
      el('span', { class: 'ranked-label' }, label),
      el('span', { class: 'ranked-value' }, formatNumber(count)),
      el('span', { class: 'ranked-track' }, el('span', { class: 'ranked-bar', style: `width:${(count / max) * 100}%` }))),
  )));
}

function statusCodesSection(stats) {
  const entries = [...stats.statusCodes].sort((a, b) => b[1] - a[1]);
  return card('Status codes', rankedList(entries, stats.total, code => showPages(() => {
    if (code === 'blocked') setExtraFilter('Blocked', row => row.blockedByRobots);
    else if (code === 'failed') setExtraFilter('Failed', row => !row.blockedByRobots && !row.fetch_status);
    else setExtraFilter(`Status ${code}`, row => String(row.fetch_status) === code);
  })));
}

function contentTypesSection(stats) {
  const entries = [...stats.contentTypes].sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, MAX_CONTENT_TYPES);
  const rest = entries.slice(MAX_CONTENT_TYPES).reduce((sum, [, count]) => sum + count, 0);
  if (rest) shown.push(['Other', rest]);
  return card('Content types', rankedList(shown, stats.total, type => {
    if (type === 'Other') return;
    showPages(() => setExtraFilter(type, row => row.fetch_contentType.toLowerCase().startsWith(type)));
  }));
}

function latencySection(stats) {
  const max = Math.max(...stats.latency, 1);
  const peak = stats.latency.indexOf(max);
  return card('Response time', el('div', { class: 'histogram', role: 'list' }, LATENCY_BUCKETS.map((bucket, i) => el('div', {
    class: 'histogram-col',
    role: 'listitem',
    title: `${bucket.label}: ${formatNumber(stats.latency[i])} pages`,
  },
  el('span', { class: 'histogram-value', hidden: i !== peak || !stats.latency[i] }, formatNumber(stats.latency[i])),
  el('span', { class: 'histogram-bar', style: `height:${Math.max(stats.latency[i] ? 3 : 0, (stats.latency[i] / max) * 100)}%` }),
  el('span', { class: 'histogram-label' }, bucket.label)))));
}

function topList(rows, field, maxKey, note) {
  const ranking = state.session.meta.ranking;
  const top = rows.filter(row => row[field] !== null).sort((a, b) => b[field] - a[field]).slice(0, 10);
  return [
    el('ol', { class: 'top-list' }, top.map(row => el('li', {},
      el('button', { type: 'button', class: 'top-row', onclick: () => emit('open-page', row.href) },
        el('span', { class: 'top-url', title: row.href }, row.href.replace(/^https?:\/\/[^/]+/, '') || '/'),
        el('span', { class: 'top-value' }, relativeScore(row[field], ranking[maxKey])))))),
    el('p', { class: 'hint' }, note),
  ];
}

function rankingSection(rows) {
  const session = state.session;
  if (session.live) return null;
  const { ranking } = session.meta;
  if (!ranking) {
    return card('Link authority',
      el('p', { class: 'hint' }, 'PageRank scores a page by the pages linking to it; CheiRank by what it links out to. Both are computed from this crawl\'s internal links, on demand.'),
      el('button', { type: 'button', class: 'btn', style: 'margin-top:10px', onclick: rankPages }, icon('rank'), 'Rank pages'));
  }
  return [
    card('Top pages by PageRank', ...topList(rows, 'pagerank', 'maxPagerank', 'Most linked-to pages. Score relative to the best page.')),
    card('Top pages by CheiRank', ...topList(rows, 'cheirank', 'maxCheirank', 'Strongest hubs: pages whose links reach the most.')),
  ];
}

function card(title, ...children) {
  return el('section', { class: 'card' }, el('h3', { class: 'card-title' }, title), ...children);
}

function render() {
  if (state.view !== 'results' || state.tab !== 'overview') return;
  const panel = $('#panelOverview');
  const rows = state.session ? [...state.session.rows.values()] : [];
  if (!rows.length) {
    panel.replaceChildren(el('div', { class: 'empty' },
      el('h3', {}, 'No data yet'),
      el('p', {}, 'Run or open a crawl to see its overview.')));
    return;
  }
  const stats = computeStats(rows);
  panel.replaceChildren(
    tiles(stats),
    el('div', { class: 'card-grid' },
      statusSection(stats),
      latencySection(stats),
      statusCodesSection(stats),
      stats.contentTypes.size ? contentTypesSection(stats) : null,
      rankingSection(rows)),
    !state.session.live && state.session.meta.ranking ? rankCharts(state.session, rows) : null,
  );
}

export function initOverview() {
  const update = throttle(render, 1000);
  on('rows', update);
  on('rows-replaced', render);
  on('ranked', render);
  on('session', render);
  on('tab', render);
}
