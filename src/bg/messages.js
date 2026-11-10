// Connection to the dragon.html tabs. Crawl progress is broadcast to all of them.

const ports = new Set();
const PROGRESS_INTERVAL_MS = 250;
const ROW_FLUSH_MS = 150;

let handlers = { onPortMessage: () => {}, onConnect: () => {} };
let lastProgressAt = 0;
let progressTimer = null;
let latestProgress = null;
let rowBuffer = [];
let rowCrawlId = null;
let rowTimer = null;

export function initPorts(portHandlers) {
  handlers = portHandlers;
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'dragon-ui') return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener(msg => handlers.onPortMessage(msg, port));
    handlers.onConnect(port);
  });
}

export function send(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    ports.delete(port);
  }
}

export function broadcast(msg) {
  for (const port of ports) send(port, msg);
}

function sendProgress() {
  progressTimer = null;
  lastProgressAt = Date.now();
  if (latestProgress) broadcast(latestProgress);
}

// At most one message per interval, with the latest values always delivered.
export function broadcastProgress(snapshot) {
  latestProgress = snapshot;
  if (progressTimer) return;
  const wait = Math.max(0, PROGRESS_INTERVAL_MS - (Date.now() - lastProgressAt));
  progressTimer = setTimeout(sendProgress, wait);
}

function flushRows() {
  rowTimer = null;
  if (!rowBuffer.length) return;
  broadcast({ type: 'pageDone', crawlId: rowCrawlId, rows: rowBuffer });
  rowBuffer = [];
}

// Rows are grouped, so a fast crawl costs the page one table update per flush.
export function broadcastRow(crawlId, row) {
  rowCrawlId = crawlId;
  rowBuffer.push(row);
  rowTimer ??= setTimeout(flushRows, ROW_FLUSH_MS);
}

// Pending rows and progress go out first, so 'crawlComplete' is really the last word.
export function flushBroadcasts() {
  clearTimeout(rowTimer);
  flushRows();
  if (progressTimer) {
    clearTimeout(progressTimer);
    sendProgress();
  }
  latestProgress = null;
}

// runtime.sendMessage request/response. Every request is answered, including
// failures, so callers are never left waiting on a closed channel.
export function initRequests(routes) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const route = routes[msg?.type];
    if (!route) return false;
    Promise.resolve()
      .then(() => route(msg))
      .then(value => sendResponse({ ok: true, ...value }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  });
}
