// The crawler. Manual and scheduled crawls both run through startCrawl().
//
// Memory stays flat over a crawl: page records leave for IndexedDB in small
// batches and only URLs (queue, seen set) and counters are kept here.

import { crawlDB } from '../db.js';
import { normalizeSettings } from '../shared/defaults.js';
import { toRow } from '../shared/row.js';
import { hostnameOf, normalizeUrl } from '../shared/url.js';
import { checkLink, fetchPage, sleep } from './fetchPage.js';
import { startKeepalive, stopKeepalive } from './keepalive.js';
import { broadcast, broadcastProgress, broadcastRow, flushBroadcasts } from './messages.js';
import { openCrawlDir, writeHtml } from './opfs.js';
import { parsePage } from './parsePage.js';
import { createPoliteness } from './politeness.js';
import { takeChain, trackRedirects } from './redirects.js';
import { createRobots } from './robots.js';

const CHECKPOINT_PAGES = 10;
const CHECKPOINT_MS = 5_000;
const STATE_MIN_INTERVAL_MS = 5_000;
const RATE_WINDOW_MS = 10_000;

// Array with a head index: Array.shift() is O(n) on the queues of large sites.
class Queue {
  constructor(items = []) { this.items = items; this.head = 0; }
  get length() { return this.items.length - this.head; }
  push(item) { this.items.push(item); }
  unshift(item) {
    if (this.head > 0) this.items[--this.head] = item;
    else this.items.unshift(item);
  }
  shift() {
    if (!this.length) return undefined;
    const item = this.items[this.head];
    this.items[this.head++] = undefined;
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
  clear() { this.items = []; this.head = 0; }
  toArray() { return this.items.slice(this.head); }
}

let active = null;
let onFinished = () => {};

export function setFinishedHandler(handler) {
  onFinished = handler;
}

export function isBusy() {
  return active !== null;
}

const emptyCounts = () => ({ crawled: 0, ok: 0, failed: 0, blocked: 0, outbound: 0, queued: 0, total: 0 });

function compileFilter(settings) {
  if (!settings.filterRegex || !settings.filterType) return null;
  try {
    const re = new RegExp(settings.filterRegex, 'i');
    return url => re.test(url) === (settings.filterType === 'include');
  } catch {
    return null; // The page validates before starting; stale schedules land here.
  }
}

async function readRobotsConfig() {
  const { userAgent = '', robotsOverrides = {} } = await chrome.storage.local.get(['userAgent', 'robotsOverrides']);
  return { userAgent, overrides: robotsOverrides };
}

async function createRuntime(meta, stateRecord) {
  const settings = normalizeSettings(meta.settings);
  const inflight = new Map(); // url → queue item, so a checkpoint can keep its depth
  trackRedirects(inflight);
  return {
    id: meta.id,
    name: meta.name,
    source: meta.source,
    startedAt: meta.createdAt,
    status: 'running',
    settings,
    startHost: hostnameOf(meta.startURL),
    queue: new Queue(stateRecord?.queue ?? []),
    outboundQueue: new Queue(stateRecord?.outboundQueue ?? []),
    seen: new Set(),
    inflight,
    mainInFlight: 0,
    counts: { ...emptyCounts(), ...meta.counts },
    pending: [],
    lastCheckpointAt: Date.now(),
    lastStateAt: 0,
    stateWriteMs: 0,
    checkpointing: null,
    looping: false,
    abort: new AbortController(),
    filter: compileFilter(settings),
    robots: createRobots(await readRobotsConfig()),
    politeness: createPoliteness(),
    archiveDir: null,
    doneTimes: [],
  };
}

function progressSnapshot(run) {
  const now = Date.now();
  while (run.doneTimes.length && now - run.doneTimes[0] > RATE_WINDOW_MS) run.doneTimes.shift();
  const queued = run.queue.length + run.outboundQueue.length + run.inflight.size;
  const window = Math.min(RATE_WINDOW_MS, now - Date.parse(run.startedAt)) / 1000;
  return {
    type: 'crawlProgress',
    crawlId: run.id,
    status: run.status,
    ...run.counts,
    queued,
    total: run.counts.crawled + queued,
    rate: window > 0 ? run.doneTimes.length / window : 0,
  };
}

export function getActiveState() {
  if (!active) return null;
  return {
    crawlId: active.id,
    name: active.name,
    status: active.status,
    startedAt: active.startedAt,
    source: active.source,
    progress: progressSnapshot(active),
  };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function startCrawl({ crawlId, name, seeds, settings, source = { type: 'manual' }, extra }) {
  if (active) throw new Error('A crawl is already in progress.');
  const urls = [...new Set(seeds.map(seed => normalizeUrl(seed)).filter(Boolean))];
  if (!urls.length) throw new Error('No valid URLs to crawl.');

  const createdAt = new Date().toISOString();
  const meta = {
    id: crawlId,
    name,
    createdAt,
    updatedAt: createdAt,
    status: 'running',
    source,
    startURL: urls[0],
    settings: normalizeSettings(settings),
    counts: { ...emptyCounts(), queued: urls.length, total: urls.length },
    schemaVersion: 2,
    ...extra,
  };
  const queue = urls.map(url => ({ url, depth: 0 }));
  active = await createRuntime(meta, { queue });
  active.seen = new Set(urls);
  await crawlDB.putMeta(meta);
  await crawlDB.commit({ crawlId, state: { queue, outboundQueue: [] } });
  broadcast({ type: 'crawlState', active: getActiveState() });
  launch(active);
  return crawlId;
}

// Runs on every service-worker start. Pages, not the possibly older checkpoint,
// decide what is done; links found after the last checkpoint are re-derived.
export async function resumeIfNeeded() {
  if (active) return;
  const [meta] = await crawlDB.findByStatus('running');
  const [paused] = meta ? [] : await crawlDB.findByStatus('paused');
  const target = meta ?? paused;
  if (!target) return;

  const stateRecord = await crawlDB.getState(target.id);
  const runtime = await createRuntime(target, stateRecord);
  await reconcile(runtime);
  if (active) return; // A crawl was started while this one was being restored.
  active = runtime;
  if (paused) {
    active.status = 'paused';
    broadcast({ type: 'crawlState', active: getActiveState() });
    return;
  }
  launch(active);
}

async function reconcile(runtime) {
  const counts = emptyCounts();
  const links = [];
  await crawlDB.iteratePages(runtime.id, batch => {
    for (const page of batch) {
      runtime.seen.add(page.url);
      if (page.fetch?.finalUrl) runtime.seen.add(page.fetch.finalUrl);
      tally(counts, page);
      if (page.depth === 0 && isSingleSeedSpider(runtime) && page.fetch?.finalUrl) {
        runtime.startHost = hostnameOf(page.fetch.finalUrl);
      }
      if (runtime.settings.crawlMode === 'recursive' && page.fetch?.ok) {
        for (const link of page.links ?? []) links.push({ url: link.url, depth: (page.depth ?? 0) + 1 });
      }
    }
  });
  runtime.counts = counts;

  const unfinished = queue => new Queue(queue.toArray().filter(item => !runtime.seen.has(item.url)));
  runtime.queue = unfinished(runtime.queue);
  runtime.outboundQueue = unfinished(runtime.outboundQueue);
  for (const item of [...runtime.queue.toArray(), ...runtime.outboundQueue.toArray()]) runtime.seen.add(item.url);
  for (const { url, depth } of links) enqueueDiscovered(runtime, url, depth);
}

// Stored right away: if the worker dies before the in-flight pages drain, the
// crawl must come back paused, not running.
export async function pauseCrawl(crawlId) {
  if (!matches(crawlId) || active.status !== 'running') return;
  active.status = 'paused';
  announce();
  await crawlDB.updateMeta(active.id, { status: 'paused' });
}

export async function resumeCrawl(crawlId) {
  if (!matches(crawlId) || active.status !== 'paused') return;
  active.status = 'running';
  await crawlDB.updateMeta(active.id, { status: 'running' });
  announce();
  launch(active);
}

export async function stopCrawl(crawlId) {
  if (!matches(crawlId) || active.status === 'stopped') return;
  const wasIdle = !active.looping;
  active.status = 'stopped';
  active.abort.abort(new DOMException('Crawl stopped', 'AbortError'));
  announce();
  if (wasIdle) await finish(active); // Paused: no loop is left to finish it.
}

function matches(crawlId) {
  return active && (!crawlId || active.id === crawlId);
}

function announce() {
  broadcastProgress(progressSnapshot(active));
}

// ── Main loop ───────────────────────────────────────────────────────────────

function hasWork(run) {
  return run.queue.length > 0 || run.outboundQueue.length > 0;
}

function launch(runtime) {
  run(runtime).catch(e => console.error('crawl loop failed', e));
}

async function run(runtime) {
  if (runtime.looping) return;
  runtime.looping = true;
  startKeepalive();
  try {
    await prepareArchive(runtime);
    for (;;) {
      const workers = Array.from({ length: runtime.settings.maxConnections }, () => worker(runtime));
      await Promise.all(workers);
      await checkpoint(runtime, { force: true });
      // Resumed while the workers were draining: carry on. Decided after the last
      // await, so no resume can slip between this check and leaving the loop.
      if (!(runtime.status === 'running' && hasWork(runtime))) break;
    }
  } catch (e) {
    console.error('crawl failed', e);
    await fail(runtime, e);
    return;
  } finally {
    runtime.looping = false;
  }

  if (runtime.status === 'paused') {
    await crawlDB.updateMeta(runtime.id, { status: 'paused', counts: runtime.counts });
    await stopKeepalive();
    return;
  }
  await finish(runtime);
}

async function prepareArchive(runtime) {
  const { opfsEnabled, opfsRootDir } = runtime.settings;
  if (!opfsEnabled || runtime.archiveDir) return;
  try {
    runtime.archiveDir = await openCrawlDir(opfsRootDir, runtime.id);
  } catch (e) {
    console.error('OPFS unavailable', e);
    broadcast({ type: 'crawlError', crawlId: runtime.id, message: `HTML archive is unavailable: ${e.message}` });
  }
}

function nextItem(run) {
  if (run.status !== 'running') return null;
  const { crawlMode, maxPages } = run.settings;
  if (crawlMode === 'recursive' && run.counts.crawled - run.counts.outbound + run.mainInFlight >= maxPages) {
    run.queue.clear();
  }
  return run.queue.shift() ?? run.outboundQueue.shift() ?? null;
}

async function worker(run) {
  for (;;) {
    const item = nextItem(run);
    if (!item) {
      // In-flight pages may still discover links; wait instead of retiring.
      if (run.status !== 'running' || run.inflight.size === 0) return;
      await sleep(50);
      continue;
    }
    await processItem(run, item);
    if (run.pending.length >= CHECKPOINT_PAGES || Date.now() - run.lastCheckpointAt > CHECKPOINT_MS) {
      await checkpoint(run);
    }
  }
}

async function processItem(run, item) {
  const { url, outbound } = item;
  run.inflight.set(url, item);
  if (!outbound) run.mainInFlight++;
  try {
    const page = outbound ? await checkOutbound(run, item) : await crawlPage(run, item);
    if (page) record(run, page);
  } catch (e) {
    if (!run.abort.signal.aborted) record(run, failedPage(run, item, e));
  } finally {
    takeChain(url); // Nothing else collects the chain of a failed fetch.
    run.inflight.delete(url);
    if (!outbound) run.mainInFlight--;
  }
}

function basePage(run, { url, depth }) {
  return { crawlId: run.id, url, depth: depth ?? 0 };
}

function failedPage(run, item, error) {
  return {
    ...basePage(run, item),
    isOutbound: !!item.outbound,
    crawlable: true,
    indexable: false,
    fetch: {
      status: 0,
      ok: false,
      timestamp: new Date().toISOString(),
      retries: error.retries ?? 0,
    },
    error: error.message,
  };
}

// Waits for this origin's turn. Returns false, with the item back in its queue,
// if the crawl was paused meanwhile, so no URL is lost across a pause.
async function waitForTurn(run, item, minIntervalMs) {
  const wait = run.politeness.waitMs(new URL(item.url).origin, minIntervalMs);
  if (wait > 0) await sleep(wait, run.abort.signal);
  if (run.status === 'running') return true;
  if (run.status === 'paused') (item.outbound ? run.outboundQueue : run.queue).unshift(item);
  return false;
}

async function crawlPage(run, item) {
  const { settings } = run;
  const { url, depth } = item;
  const origin = new URL(url).origin;

  let minInterval = settings.delay;
  if (settings.respectRobots) {
    const robots = await run.robots.get(origin);
    if (!robots.allowed(url)) return blockedPage(run, item, robots);
    minInterval = Math.max(minInterval, robots.crawlDelayMs);
  }
  if (!(await waitForTurn(run, item, minInterval))) return null;

  const result = await fetchPage(url, settings, { signal: run.abort.signal });
  const finalUrl = result.fetch.finalUrl ?? url;
  const parsed = result.html ? parsePage(limitForParsing(result.html, settings), finalUrl, result.headers) : null;

  const chain = takeChain(url);
  if (chain) result.fetch.redirectChain = chain;
  if (finalUrl !== url) run.seen.add(finalUrl);
  // A spider started on example.com that lands on www.example.com stays on www.
  if (depth === 0 && isSingleSeedSpider(run)) run.startHost = hostnameOf(finalUrl);

  const page = buildPage(run, item, result, parsed);
  if (parsed) {
    if (result.fetch.ok && settings.crawlMode === 'recursive') {
      for (const link of parsed.links) enqueueDiscovered(run, link.url, depth + 1);
    }
    if (settings.fetchOutbound) {
      for (const link of parsed.links) enqueueOutbound(run, link);
    }
  }
  if (run.archiveDir && result.html && result.fetch.ok) {
    page.opfs_path = await writeHtml(run.archiveDir, settings.opfsRootDir, run.id, url, result.html)
      .catch(e => { console.error('OPFS write failed', e); return undefined; });
  }
  return page;
}

function isSingleSeedSpider(run) {
  return run.settings.crawlMode === 'recursive';
}

function limitForParsing(html, settings) {
  return html.length > settings.maxParseBytes ? html.slice(0, settings.maxParseBytes) : html;
}

function buildPage(run, item, result, parsed) {
  const meta = parsed?.meta;
  const isHtmlPage = result.html !== null;
  return {
    ...basePage(run, item),
    crawlable: true,
    fetch: result.fetch,
    headers: result.headers,
    title: meta?.title ?? '',
    description: meta?.description ?? '',
    h1: meta?.h1 ?? '',
    canonical: meta?.canonical ?? '',
    canonicalCount: meta?.canonicalCount ?? 0,
    keyword: meta?.keyword ?? '',
    robots: meta?.robots ?? '',
    xRobotsTag: meta?.xRobotsTag ?? '',
    hreflang: meta?.hreflang ?? [],
    og: meta?.og,
    schema: meta?.schema,
    indexable: !!(result.fetch.ok && isHtmlPage && !meta?.noindex),
    links: parsed?.links,
  };
}

function blockedPage(run, item, robots) {
  return {
    ...basePage(run, item),
    crawlable: false,
    blockedByRobots: true,
    blockReason: robots.reason,
    indexable: false,
    fetch: { status: null, ok: false, timestamp: new Date().toISOString() },
  };
}

async function checkOutbound(run, item) {
  if (!(await waitForTurn(run, item, run.settings.delay))) return null;
  const result = await checkLink(item.url, run.settings, { signal: run.abort.signal });
  const chain = takeChain(item.url);
  if (chain) result.fetch.redirectChain = chain;
  return {
    ...basePage(run, item),
    isOutbound: true,
    crawlable: true,
    indexable: false,
    fetch: result.fetch,
    headers: result.headers,
  };
}

function enqueueDiscovered(run, url, depth) {
  const { settings } = run;
  if (run.seen.has(url)) return;
  if (settings.stayonhostname && hostnameOf(url) !== run.startHost) return;
  if (run.filter && !run.filter(url)) return;
  run.seen.add(url);
  run.queue.push({ url, depth });
}

function enqueueOutbound(run, link) {
  if (link.internal || run.seen.has(link.url)) return;
  run.seen.add(link.url);
  run.outboundQueue.push({ url: link.url, outbound: true });
}

function tally(counts, page) {
  counts.crawled++;
  if (page.blockedByRobots) counts.blocked++;
  else if (page.fetch?.ok) counts.ok++;
  else counts.failed++;
  if (page.isOutbound) counts.outbound++;
}

function record(run, page) {
  tally(run.counts, page);
  run.pending.push(page);
  run.doneTimes.push(Date.now());
  broadcastRow(run.id, toRow(page));
  broadcastProgress(progressSnapshot(run));
}

// ── Persistence ─────────────────────────────────────────────────────────────

function countsWithQueue(run) {
  const queued = run.queue.length + run.outboundQueue.length + run.inflight.size;
  return { ...run.counts, queued, total: run.counts.crawled + queued };
}

// Serialized: workers call this concurrently, and overlapping commits could
// write an older queue over a newer one. The queue is only rewritten when due,
// since a huge frontier is the one record whose size grows with the crawl.
function checkpoint(run, { force = false } = {}) {
  run.checkpointing = (run.checkpointing ?? Promise.resolve()).then(async () => {
    const pages = run.pending;
    if (!pages.length && !force) return;
    run.pending = [];
    run.lastCheckpointAt = Date.now();

    const dueIn = Math.max(STATE_MIN_INTERVAL_MS, run.stateWriteMs * 20);
    const writeState = force || Date.now() - run.lastStateAt >= dueIn;
    const state = writeState
      ? {
        // In-flight URLs count as still to do: a worker dying with them must not lose them.
        queue: [...run.inflight.values(), ...run.queue.toArray()].filter(item => !item.outbound),
        outboundQueue: [
          ...[...run.inflight.values()].filter(item => item.outbound),
          ...run.outboundQueue.toArray(),
        ],
      }
      : undefined;

    const started = performance.now();
    await crawlDB.commit({ crawlId: run.id, pages, state, counts: countsWithQueue(run) });
    if (writeState) {
      run.stateWriteMs = performance.now() - started;
      run.lastStateAt = Date.now();
    }
    performance.clearResourceTimings();
  });
  return run.checkpointing;
}

async function finish(run) {
  const status = run.status === 'stopped' ? 'stopped' : 'done';
  run.status = status;
  await checkpoint(run, { force: true });
  await crawlDB.updateMeta(run.id, { status, counts: { ...run.counts, queued: 0, total: run.counts.crawled } });
  await crawlDB.deleteState(run.id);
  await stopKeepalive();
  if (active === run) active = null;

  flushBroadcasts();
  broadcast({ type: 'crawlComplete', crawlId: run.id, status, counts: run.counts, source: run.source });
  if (status === 'done') notifyDone(run);
  onFinished({ crawlId: run.id, status, counts: run.counts, name: run.name, source: run.source });
}

async function fail(run, error) {
  await crawlDB.updateMeta(run.id, { status: 'error', error: error.message }).catch(() => {});
  await crawlDB.deleteState(run.id).catch(() => {});
  await stopKeepalive();
  if (active === run) active = null;
  flushBroadcasts();
  broadcast({ type: 'crawlError', crawlId: run.id, message: error.message, fatal: true });
  onFinished({ crawlId: run.id, status: 'error', counts: run.counts, name: run.name, source: run.source });
}

function notifyDone(run) {
  const { crawled, ok } = run.counts;
  chrome.notifications.create(`crawl-done-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/dragon64.png',
    title: `Crawl complete: ${run.name}`,
    message: `${crawled} URLs — ${ok} OK`,
  });
}
