// The crawl on screen. Holds flat rows only; full page records stay in
// IndexedDB and are read on demand, so a large crawl stays light in the page.

import { crawlDB } from '../db.js';
import { computeRanks } from '../shared/rank.js';
import { toRow } from '../shared/row.js';
import { emit, state } from './store.js';

function createSession(meta, live) {
  return {
    id: meta.id,
    meta,
    live,
    rows: new Map(),
    links: null,
    csv: meta.csv ?? null,
    loading: true,
  };
}

function withCsv(session, row) {
  const extra = session.csv?.[row.href];
  return extra ? { ...row, ...extra } : row;
}

export function addRows(session, rows) {
  const added = [];
  const updated = [];
  for (const raw of rows) {
    const row = withCsv(session, raw);
    (session.rows.has(row.href) ? updated : added).push(row);
    session.rows.set(row.href, row);
  }
  emit('rows', { session, added, updated });
}

// One pass, then one render. Announcing each batch would rebuild the table and
// every statistic per batch while the crawl is only being read back.
async function loadRows(session) {
  await crawlDB.iteratePages(session.id, pages => {
    for (const page of pages) {
      const row = withCsv(session, toRow(page));
      if (!session.rows.has(row.href)) session.rows.set(row.href, row);
    }
  });
}

async function switchTo(meta, live) {
  const session = createSession(meta, live);
  state.session = session;
  emit('session', session);
  await loadRows(session);
  if (!live) await ensureLinks(session);
  session.loading = false;
  if (state.session === session) emit('rows-replaced', session);
  return session;
}

// Follows the live crawl. Stored rows come first; live rows that arrive while
// they load are upserts, so the order of the two does not matter.
export async function followCrawl(crawlId) {
  if (state.session?.id === crawlId) return state.session;
  const meta = await crawlDB.getMeta(crawlId);
  return meta ? switchTo(meta, true) : null;
}

export async function openCrawl(crawlId) {
  const meta = await crawlDB.getMeta(crawlId);
  if (!meta) throw new Error('This crawl no longer exists.');
  return switchTo(meta, state.active?.crawlId === crawlId);
}

export function closeSession() {
  state.session = null;
  emit('session', null);
}

export async function finishSession(session, status) {
  session.live = false;
  session.meta = { ...session.meta, ...(await crawlDB.getMeta(session.id)), status };
  emit('session-updated', session);
  await ensureLinks(session, { force: true });
}

// Link graph, built once when a crawl is complete instead of every time a view
// needs an answer. Only the shape of each edge is kept in memory.
export async function ensureLinks(session, { force = false } = {}) {
  if (session.links && !force) return session.links;
  const edges = [];
  const inbound = new Map();
  const outboundCount = new Map();

  await crawlDB.iteratePages(session.id, pages => {
    for (const page of pages) {
      for (const link of page.links ?? []) {
        const edge = {
          source: page.url,
          target: link.url,
          follow: link.follow ?? '',
          directive_source: link.directive_source ?? '',
          internal: link.internal !== false,
        };
        edges.push(edge);
        if (!inbound.has(link.url)) inbound.set(link.url, []);
        inbound.get(link.url).push(edge);
      }
      outboundCount.set(page.url, page.links?.length ?? 0);
    }
  });

  const broken = new Map();
  for (const edge of edges) {
    const status = session.rows.get(edge.target)?.fetch_status;
    edge.status = status ?? null;
    if (status >= 400 || status === 0) broken.set(edge.source, (broken.get(edge.source) ?? 0) + 1);
  }
  for (const [url, row] of session.rows) {
    row.inbound_count = inbound.get(url)?.length ?? 0;
    row.broken_outbound = broken.get(url) ?? 0;
    row.outbound_count = outboundCount.get(url) ?? row.outbound_count;
  }

  session.links = { edges, inbound };
  emit('links', session);
  return session.links;
}

// ── Ranking ─────────────────────────────────────────────────────────────────

// Nodes are the crawled internal pages; edges are their followed links to each
// other. nofollow links pass no authority, so they stay out of the graph.
function buildGraph(session) {
  const index = new Map();
  const nodes = [];
  for (const row of session.rows.values()) {
    if (row.isOutbound || row.blockedByRobots) continue;
    index.set(row.href, nodes.length);
    nodes.push(row.href);
  }
  const seen = new Set();
  const edges = [];
  for (const edge of session.links.edges) {
    if (!edge.internal || edge.follow !== 'follow') continue;
    const from = index.get(edge.source);
    const to = index.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    const key = from * nodes.length + to;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([from, to]);
  }
  return { nodes, edges };
}

export async function rankSession(session, onProgress) {
  await ensureLinks(session);
  const { nodes, edges } = buildGraph(session);
  const { byNode, stats } = await computeRanks(nodes, edges, { onProgress });
  if (state.session !== session) return null;

  const patches = new Map();
  for (const [url, rank] of byNode) {
    patches.set(url, { rank });
    const row = session.rows.get(url);
    if (row) {
      row.pagerank = rank.pagerank;
      row.cheirank = rank.cheirank;
      row.pagerank_rank = rank.pagerankRank;
      row.cheirank_rank = rank.cheirankRank;
    }
  }
  const ranking = { ...stats, at: new Date().toISOString() };
  session.meta = { ...session.meta, ranking };
  session.rankSummary = null;
  await crawlDB.patchPages(session.id, patches);
  await crawlDB.updateMeta(session.id, { ranking });
  emit('ranked', session);
  return ranking;
}

// ── Statistics ──────────────────────────────────────────────────────────────

export const STATUS_CLASSES = [
  { id: '2xx', label: 'Success', tone: 'ok', icon: 'check' },
  { id: '3xx', label: 'Redirect', tone: 'info', icon: 'redirect' },
  { id: '4xx', label: 'Client error', tone: 'warn', icon: 'alert' },
  { id: '5xx', label: 'Server error', tone: 'danger', icon: 'alert' },
  { id: 'failed', label: 'Failed', tone: 'danger', icon: 'x' },
  { id: 'blocked', label: 'Blocked', tone: 'neutral', icon: 'ban' },
];

export function statusClass(row) {
  if (row.blockedByRobots) return 'blocked';
  const status = row.fetch_status;
  if (!status) return 'failed';
  if (row.fetch_redirected) return '3xx';
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}

export const LATENCY_BUCKETS = [
  { label: '<200 ms', max: 200 },
  { label: '200–500', max: 500 },
  { label: '0.5–1 s', max: 1000 },
  { label: '1–2 s', max: 2000 },
  { label: '2–5 s', max: 5000 },
  { label: '>5 s', max: Infinity },
];

export function computeStats(rows) {
  const stats = {
    total: 0, internal: 0, external: 0, indexable: 0, nonIndexable: 0, bytes: 0,
    classes: Object.fromEntries(STATUS_CLASSES.map(c => [c.id, 0])),
    statusCodes: new Map(),
    contentTypes: new Map(),
    latency: LATENCY_BUCKETS.map(() => 0),
    medianMs: null,
  };
  const durations = [];
  for (const row of rows) {
    stats.total++;
    stats.classes[statusClass(row)]++;
    stats[row.isOutbound ? 'external' : 'internal']++;
    if (!row.isOutbound) stats[row.indexable ? 'indexable' : 'nonIndexable']++;
    stats.bytes += row.fetch_decodedBodySize ?? 0;

    const code = row.blockedByRobots ? 'blocked' : row.fetch_status ? String(row.fetch_status) : 'failed';
    stats.statusCodes.set(code, (stats.statusCodes.get(code) ?? 0) + 1);
    if (row.fetch_contentType) {
      const type = row.fetch_contentType.replace(/;.*/, '').trim().toLowerCase();
      stats.contentTypes.set(type, (stats.contentTypes.get(type) ?? 0) + 1);
    }
    if (row.fetch_duration !== null && !row.isOutbound) {
      durations.push(row.fetch_duration);
      stats.latency[LATENCY_BUCKETS.findIndex(bucket => row.fetch_duration < bucket.max)]++;
    }
  }
  if (durations.length) {
    durations.sort((a, b) => a - b);
    stats.medianMs = durations[Math.floor(durations.length / 2)];
  }
  return stats;
}
