// Issues: what the crawl means, most serious first. Lists render when opened,
// and in pages: a site can have tens of thousands of "missing canonical" rows.

import { $, el, formatNumber, icon, throttle } from './dom.js';
import { ensureLinks } from './session.js';
import { emit, on, state } from './store.js';

const PAGE_SIZE = 100;
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Notice' };
const SEVERITY_ICON = { error: 'alert', warning: 'alert', info: 'info' };

const isHtml = row => row.fetch_contentType.toLowerCase().includes('text/html');
const isOkHtml = row => !row.isOutbound && row.fetch_status > 0 && row.fetch_status < 400 && isHtml(row);

function buildIssues(session) {
  const rows = [...session.rows.values()];
  const internal = rows.filter(row => !row.isOutbound);
  const healthy = internal.filter(isOkHtml);
  const issues = [];
  const add = (title, severity, help, items) => {
    if (items.length) issues.push({ title, severity, help, items });
  };
  const missing = field => healthy.filter(row => !row[field]).map(row => ({ url: row.href }));

  add('Broken pages', 'error', 'These URLs answered with an error, or did not answer at all.',
    internal.filter(row => row.fetch_status === 0 || row.fetch_status >= 400).map(row => ({
      url: row.href,
      detail: row.fetch_status ? `${row.fetch_status} ${row.fetch_statusText}`.trim() : row.error,
    })));

  if (session.links) {
    add('Pages linking to broken URLs', 'error', 'Each entry is a link from a crawled page to a URL that failed.',
      session.links.edges.filter(edge => edge.status === 0 || edge.status >= 400).map(edge => ({
        url: edge.source,
        detail: `→ ${edge.target} (${edge.status || 'failed'})`,
      })));
  }

  add('Broken external links', 'error', 'External URLs that failed the link check.',
    rows.filter(row => row.isOutbound && (row.fetch_status === 0 || row.fetch_status >= 400)).map(row => ({
      url: row.href,
      detail: row.fetch_status ? String(row.fetch_status) : row.error,
    })));

  add('Redirected pages', 'warning', 'Link directly to the final URL to avoid the extra hop.',
    internal.filter(row => row.fetch_redirected).map(row => ({
      url: row.href,
      detail: `${row.fetch_redirectStatus ? `${row.fetch_redirectStatus} ` : ''}→ ${row.fetch_finalUrl}`,
    })));

  add('Blocked by robots.txt', 'warning', 'Not fetched, because robots.txt disallows them.',
    internal.filter(row => row.blockedByRobots).map(row => ({ url: row.href, detail: row.blockReason })));

  add('Missing title', 'warning', 'Pages without a <title>.', missing('title'));

  const byTitle = new Map();
  for (const row of healthy) {
    if (!row.title) continue;
    if (!byTitle.has(row.title)) byTitle.set(row.title, []);
    byTitle.get(row.title).push(row.href);
  }
  add('Duplicate titles', 'warning', 'Several pages share one title.',
    [...byTitle].filter(([, urls]) => urls.length > 1)
      .flatMap(([title, urls]) => urls.map(url => ({ url, detail: title }))));

  add('Multiple canonicals', 'warning', 'Search engines may ignore conflicting canonical declarations.',
    healthy.filter(row => row.canonicalCount > 1).map(row => ({ url: row.href, detail: `${row.canonicalCount} canonicals` })));

  add('Noindex pages', 'info', 'Pages that ask search engines not to index them.',
    healthy.filter(row => !row.indexable && !row.fetch_truncated).map(row => ({
      url: row.href,
      detail: row.xRobotsTag || row.robots,
    })));

  add('Missing H1', 'info', 'Pages without an <h1> heading.', missing('h1'));
  add('Missing meta description', 'info', 'Pages without a meta description.', missing('description'));
  add('Missing canonical', 'info', 'Pages without a canonical URL.', missing('canonical'));

  add('Truncated pages', 'info', 'Larger than the 5 MB limit: only the beginning was analysed.',
    internal.filter(row => row.fetch_truncated).map(row => ({ url: row.href })));

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function issueRow(item) {
  return el('li', {},
    el('button', { type: 'button', class: 'issue-row', onclick: () => emit('open-page', item.url) },
      el('span', { class: 'issue-url' }, item.url),
      item.detail ? el('span', { class: 'issue-detail', title: item.detail }, item.detail) : null));
}

function renderItems(issue, list, footer, shown) {
  list.append(...issue.items.slice(shown, shown + PAGE_SIZE).map(issueRow));
  const total = Math.min(issue.items.length, shown + PAGE_SIZE);
  footer.replaceChildren();
  if (total < issue.items.length) {
    footer.append(el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      onclick: () => renderItems(issue, list, footer, total),
    }, `Show ${formatNumber(Math.min(PAGE_SIZE, issue.items.length - total))} more of ${formatNumber(issue.items.length - total)}`));
  }
}

function issueCard(issue, wasOpen) {
  const list = el('ul', { class: 'issue-list' });
  const footer = el('div', { class: 'issue-footer' });
  let rendered = false;
  const fill = () => {
    if (rendered) return;
    rendered = true;
    renderItems(issue, list, footer, 0);
  };
  const details = el('details', {
    class: `issue issue-${issue.severity}`,
    dataset: { title: issue.title },
    ontoggle: e => { if (e.target.open) fill(); },
  },
  el('summary', {},
    icon('chevron', 'icon icon-sm chevron'),
    el('span', { class: `severity tone-${issue.severity}` }, icon(SEVERITY_ICON[issue.severity], 'icon icon-xs'), SEVERITY_LABEL[issue.severity]),
    el('span', { class: 'issue-title' }, issue.title),
    el('span', { class: 'issue-count' }, formatNumber(issue.items.length))),
  el('p', { class: 'issue-help' }, issue.help),
  list,
  footer);
  if (wasOpen) { details.open = true; fill(); }
  return details;
}

function render() {
  const session = state.session;
  const issues = session ? buildIssues(session) : [];
  const total = issues.reduce((sum, issue) => sum + (issue.severity === 'info' ? 0 : issue.items.length), 0);
  $('#countIssues').textContent = formatNumber(total);
  if (state.view !== 'results' || state.tab !== 'issues') return;

  const panel = $('#panelIssues');
  const openTitles = new Set([...panel.querySelectorAll('details[open]')].map(node => node.dataset.title));
  if (!session?.rows.size) {
    panel.replaceChildren(el('div', { class: 'empty' },
      el('h3', {}, 'No data yet'),
      el('p', {}, 'Run or open a crawl to see what needs attention.')));
    return;
  }
  if (!issues.length) {
    panel.replaceChildren(el('div', { class: 'empty' },
      el('img', { src: 'icons/dragon128.png', alt: '', width: 96, height: 96 }),
      el('h3', {}, session.live ? 'No issues so far' : 'No issues found'),
      el('p', {}, session.live ? 'This updates while the crawl runs.' : 'Every page passed these checks.')));
    return;
  }
  panel.replaceChildren(el('div', { class: 'issues' }, issues.map(issue => issueCard(issue, openTitles.has(issue.title)))));
}

export function initIssues() {
  const update = throttle(render, 2000);
  on('rows', update);
  on('links', session => { if (!session.loading) render(); });
  on('rows-replaced', render);
  on('session', render);
  on('tab', tab => {
    if (tab === 'issues' && state.session && !state.session.live) ensureLinks(state.session);
    render();
  });
}
