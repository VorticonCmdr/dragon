// Detail drawer. Sits beside the table instead of over it, so rows can be
// clicked through without losing the list.

import { crawlDB } from '../db.js';
import { toast, openDialog } from './components.js';
import { $, downloadBlob, el, formatBytes, formatDuration, formatNumber, icon } from './dom.js';
import { on, state } from './store.js';
import { relativeScore, statusPill } from './table.js';
import { toRow } from '../shared/row.js';

const MAX_LINKS_SHOWN = 200;
const TITLE_RANGE = [30, 60];
const DESCRIPTION_RANGE = [70, 160];

let history = [];
let position = -1;
let returnFocus = null;

const drawer = () => $('#drawer');

function facts(entries) {
  const shown = entries.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!shown.length) return null;
  return el('dl', { class: 'facts' }, shown.flatMap(([label, value]) => [
    el('dt', {}, label),
    el('dd', {}, value),
  ]));
}

function section(title, ...children) {
  const content = children.filter(Boolean);
  if (!content.length) return null;
  return el('section', { class: 'drawer-section' }, el('h3', {}, title), ...content);
}

function lengthNote(text, [min, max]) {
  const { length } = text;
  const inRange = length >= min && length <= max;
  return el('span', { class: inRange ? 'length' : 'length length-off' }, `${length} characters`);
}

function textFact(text, range) {
  if (!text) return el('span', { class: 'missing' }, 'Missing');
  return el('span', { class: 'stacked' }, text, lengthNote(text, range));
}

function pageButton(url, note) {
  const known = state.session?.rows.has(url);
  const label = el('span', { class: 'link-url' }, url);
  const noteNode = note ? el('span', { class: 'link-note' }, note) : null;
  if (known) return el('button', { type: 'button', class: 'link-row', onclick: () => navigate(url) }, label, noteNode);
  return el('a', { class: 'link-row', href: url, target: '_blank', rel: 'noreferrer' }, label, noteNode);
}

function linkList(links, render) {
  const shown = links.slice(0, MAX_LINKS_SHOWN);
  return [
    el('ul', { class: 'link-list' }, shown.map(link => el('li', {}, render(link)))),
    links.length > shown.length
      ? el('p', { class: 'hint' }, `Showing ${MAX_LINKS_SHOWN} of ${formatNumber(links.length)}. The Links tab has all of them.`)
      : null,
  ];
}

function redirectChain(page) {
  const chain = page.fetch?.redirectChain;
  if (!page.fetch?.finalUrl) return null;
  const hops = chain?.length
    ? chain.map(hop => ({ status: hop.status, url: hop.url }))
    : [{ status: null, url: page.url }];
  return section('Redirects',
    el('ol', { class: 'chain' },
      hops.map(hop => el('li', {}, el('span', { class: 'chain-status' }, hop.status ?? '3xx'), el('span', { class: 'chain-url' }, hop.url))),
      el('li', { class: 'chain-final' }, el('span', { class: 'chain-status' }, page.fetch.status), el('span', { class: 'chain-url' }, page.fetch.finalUrl))));
}

function responseSection(page) {
  const f = page.fetch ?? {};
  return section('Response', facts([
    ['Time', f.duration !== undefined ? formatDuration(f.duration) : ''],
    ['Size', f.encodedBodySize ? formatBytes(f.encodedBodySize) : ''],
    ['Type', f.contentType],
    ['Encoding', f.contentEncoding],
    ['Charset', f.charset],
    ['Depth', page.depth],
    ['Retries', f.retries || ''],
    ['Fetched', f.timestamp ? new Date(f.timestamp).toLocaleString() : ''],
    ['Error', page.error],
    ['Blocked', page.blockReason],
  ]), f.truncated ? el('p', { class: 'hint' }, 'Larger than the 5 MB limit: only the beginning was analysed.') : null);
}

function seoSection(page) {
  if (page.isOutbound || page.blockedByRobots || !page.fetch?.contentType?.includes('html')) return null;
  const canonicalSelf = page.canonical === (page.fetch.finalUrl ?? page.url);
  return section('SEO', facts([
    ['Title', textFact(page.title, TITLE_RANGE)],
    ['Description', textFact(page.description, DESCRIPTION_RANGE)],
    ['H1', page.h1 || el('span', { class: 'missing' }, 'Missing')],
    ['Canonical', page.canonical
      ? el('span', { class: 'stacked' }, page.canonical, el('span', { class: 'length' }, canonicalSelf ? 'Self-referencing' : 'Points elsewhere'))
      : el('span', { class: 'missing' }, 'Missing')],
    ['Indexable', page.indexable ? 'Yes' : 'No'],
    ['Robots', page.robots],
    ['X-Robots-Tag', page.xRobotsTag],
    ['Keywords', page.keyword],
  ]));
}

function rankSection(page) {
  const ranking = state.session?.meta?.ranking;
  if (!page.rank || !ranking) return null;
  const total = ranking.nodes;
  return section('Ranking', facts([
    ['PageRank', el('span', { class: 'stacked' }, relativeScore(page.rank.pagerank, ranking.maxPagerank),
      el('span', { class: 'length' }, `#${formatNumber(page.rank.pagerankRank)} of ${formatNumber(total)} by links in`))],
    ['CheiRank', el('span', { class: 'stacked' }, relativeScore(page.rank.cheirank, ranking.maxCheirank),
      el('span', { class: 'length' }, `#${formatNumber(page.rank.cheirankRank)} of ${formatNumber(total)} by links out`))],
  ]));
}

function hreflangSection(page) {
  if (!page.hreflang?.length) return null;
  return section(`Hreflang (${page.hreflang.length})`, facts(page.hreflang.map(({ lang, href }) => [lang, href])));
}

function dataSection(title, object) {
  if (!object) return null;
  return section(title, facts(Object.entries(object)));
}

function headersSection(page) {
  if (!page.headers || !Object.keys(page.headers).length) return null;
  return section('Headers', facts(Object.entries(page.headers)));
}

function linkSections(page) {
  const internal = (page.links ?? []).filter(link => link.internal !== false);
  const external = (page.links ?? []).filter(link => link.internal === false);
  const inbound = state.session?.links?.inbound.get(page.url) ?? [];
  const note = link => (link.follow && link.follow !== 'follow' ? link.follow : '');
  return [
    section(`Links in (${formatNumber(inbound.length)})`,
      inbound.length ? null : el('p', { class: 'hint' }, state.session?.links ? 'No crawled page links here.' : 'Available when the crawl ends.'),
      ...(inbound.length ? linkList(inbound, edge => pageButton(edge.source, note(edge))) : [])),
    internal.length ? section(`Internal links out (${formatNumber(internal.length)})`, ...linkList(internal, link => pageButton(link.url, note(link)))) : null,
    external.length ? section(`External links out (${formatNumber(external.length)})`, ...linkList(external, link => pageButton(link.url, note(link)))) : null,
  ];
}

async function readArchive(path) {
  const parts = path.split('/');
  let dir = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts.at(-1))).getFile();
}

function archiveSection(page) {
  if (!page.opfs_path) return null;
  const guarded = action => async () => {
    try {
      await action(await readArchive(page.opfs_path));
    } catch (e) {
      toast(`The archived file could not be read: ${e.message}`, 'error');
    }
  };
  return section('Archived HTML',
    el('div', { class: 'button-row' },
      el('button', {
        class: 'btn btn-sm',
        // Rendered in a fully sandboxed frame: crawled pages must never run
        // with this extension's privileges.
        onclick: guarded(async file => {
          $('#previewFrame').srcdoc = await file.text();
          openDialog($('#previewDialog'));
        }),
      }, icon('eye'), 'Preview'),
      el('button', {
        class: 'btn btn-sm',
        onclick: guarded(file => downloadBlob(file, file.name)),
      }, icon('download'), 'Download')));
}

function header(page) {
  const row = toRow(page);
  const back = el('button', { class: 'icon-btn', 'aria-label': 'Previous page', disabled: position <= 0, onclick: () => step(-1) }, icon('arrow-left'));
  const forward = el('button', { class: 'icon-btn', 'aria-label': 'Next page', disabled: position >= history.length - 1, onclick: () => step(1) }, icon('arrow-right'));
  const close = el('button', { class: 'icon-btn', 'aria-label': 'Close details', onclick: closeDetail }, icon('x'));
  return el('header', { class: 'drawer-head' },
    el('div', { class: 'drawer-nav' },
      back, forward,
      el('span', { class: 'drawer-spacer' }),
      el('a', { class: 'icon-btn', href: page.url, target: '_blank', rel: 'noreferrer', 'aria-label': 'Open this URL in a new tab' }, icon('external')),
      close),
    el('div', { class: 'drawer-title' },
      statusPill(row),
      el('h2', {}, page.title || 'Untitled')),
    el('p', { class: 'drawer-url' }, page.url));
}

async function loadPage(url) {
  const session = state.session;
  const stored = await crawlDB.getPage(session.id, url);
  if (stored) return stored;
  // A live page may not have reached its checkpoint yet: the row has the basics.
  const row = session.rows.get(url);
  if (!row) return null;
  return {
    url,
    title: row.title,
    description: row.description,
    h1: row.h1,
    depth: row.depth,
    canonical: row.canonical,
    robots: row.robots,
    indexable: row.indexable,
    fetch: {
      status: row.fetch_status,
      statusText: row.fetch_statusText,
      duration: row.fetch_duration,
      contentType: row.fetch_contentType,
      redirected: row.fetch_redirected,
    },
  };
}

async function show(url) {
  const page = await loadPage(url);
  if (!page) {
    toast('This URL was linked to, but it was not crawled.');
    return;
  }
  const panel = drawer();
  panel.replaceChildren(
    header(page),
    el('div', { class: 'drawer-body' },
      redirectChain(page),
      responseSection(page),
      seoSection(page),
      archiveSection(page),
      rankSection(page),
      ...linkSections(page),
      hreflangSection(page),
      dataSection('Open Graph', page.og),
      dataSection('Structured data', page.schema),
      headersSection(page)),
  );
  panel.hidden = false;
  $('.drawer-body', panel).scrollTop = 0;
  panel.focus({ preventScroll: true });
}

function navigate(url) {
  history = [...history.slice(0, position + 1), url];
  position = history.length - 1;
  show(url);
}

function step(delta) {
  position += delta;
  show(history[position]);
}

export function openDetail(url) {
  if (drawer().hidden) {
    returnFocus = document.activeElement;
    history = [];
    position = -1;
  }
  navigate(url);
}

export function closeDetail() {
  if (drawer().hidden) return false;
  drawer().hidden = true;
  drawer().replaceChildren();
  if (returnFocus?.isConnected) returnFocus.focus();
  return true;
}

export function initDetail() {
  on('open-page', openDetail);
  on('session', closeDetail);
}
