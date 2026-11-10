// IndexedDB layer shared by the service worker, dragon.html and options.html.
//
//   crawls  'crawl-<ts>' → crawl metadata (counts, settings, status)
//   pages   [crawlId, url] → one record per URL
//   state   crawlId → resume checkpoint of the crawl in progress
//
// Writing a page touches only that page, which keeps the cost of a crawl linear.

const DB_NAME = 'blue-dragon';
const DB_VERSION = 2;
const CRAWLS = 'crawls';
const PAGES = 'pages';
const STATE = 'state';
const LEGACY_META = 'crawlMeta';

let dbPromise = null;

function forgetConnection() {
  dbPromise = null;
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = event => upgrade(req.result, req.transaction, event.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); forgetConnection(); };
      db.onclose = forgetConnection;
      resolve(db);
    };
    req.onerror = () => { forgetConnection(); reject(req.error); };
    req.onblocked = () => console.warn('blue dragon: database upgrade is waiting for another tab to close');
  });
  return dbPromise;
}

function upgrade(db, tx, oldVersion) {
  // Keys stay out-of-line: v1 created the store that way and IndexedDB cannot
  // change the key of an existing store.
  const crawls = db.objectStoreNames.contains(CRAWLS) ? tx.objectStore(CRAWLS) : db.createObjectStore(CRAWLS);
  if (!crawls.indexNames.contains('byStatus')) crawls.createIndex('byStatus', 'status');
  if (!crawls.indexNames.contains('byCreatedAt')) crawls.createIndex('byCreatedAt', 'createdAt');

  if (!db.objectStoreNames.contains(PAGES)) {
    db.createObjectStore(PAGES, { keyPath: ['crawlId', 'url'] }).createIndex('byCrawl', 'crawlId');
  }
  if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE, { keyPath: 'crawlId' });

  if (oldVersion === 1) migrateBlobs(crawls, tx.objectStore(PAGES));
  if (db.objectStoreNames.contains(LEGACY_META)) db.deleteObjectStore(LEGACY_META);
}

// v1 kept a crawl as one blob: { id, name, settings, data: { results: {url: page} } }.
// One blob at a time is loaded, and a damaged record is skipped rather than
// aborting the upgrade (which would lock the user out of every other crawl).
function migrateBlobs(crawls, pages) {
  crawls.openCursor().onsuccess = event => {
    const cursor = event.target.result;
    if (!cursor) return;
    const id = String(cursor.key);
    const blob = cursor.value;
    if (blob?.data) {
      try {
        cursor.update(migrateBlob(id, blob, pages));
      } catch (e) {
        console.error(`blue dragon: could not migrate ${id}`, e);
      }
    }
    cursor.continue();
  };
}

function migrateBlob(id, blob, pages) {
  const results = Object.entries(blob.data.results ?? {});
  const counts = { crawled: 0, ok: 0, failed: 0, blocked: 0, outbound: 0, queued: 0, total: 0 };
  for (const [key, result] of results) {
    const page = migratePage(id, key, result);
    if (!page) continue;
    pages.put(page);
    counts.crawled++;
    if (page.blockedByRobots) counts.blocked++;
    else if (page.fetch?.ok) counts.ok++;
    else counts.failed++;
    if (page.isOutbound) counts.outbound++;
  }
  counts.total = counts.crawled;
  const timestamp = Number.parseInt(id.replace('crawl-', ''), 10);
  const createdAt = new Date(Number.isNaN(timestamp) ? Date.now() : timestamp).toISOString();
  const startURL = blob.data.startURL;
  return {
    id,
    name: blob.name || id,
    createdAt,
    updatedAt: createdAt,
    // A blob with a remaining queue was interrupted mid-crawl.
    status: blob.data.queue?.length ? 'stopped' : 'done',
    source: { type: 'manual' },
    startURL: typeof startURL === 'object' ? startURL?.href ?? '' : startURL ?? '',
    settings: blob.settings ?? {},
    counts,
    schemaVersion: 2,
  };
}

function migratePage(crawlId, key, result) {
  const url = result?.href || key;
  if (!url) return null;
  const { href, content, paragraphs, ...rest } = result;
  const ct = (rest.fetch?.contentType ?? '').toLowerCase();
  const noindex = /noindex|\bnone\b/.test((rest.robots ?? '').toLowerCase());
  return {
    indexable: !!(rest.fetch?.ok && ct.includes('text/html') && !noindex),
    ...rest,
    crawlId,
    url,
    depth: rest.depth ?? 0,
    links: (rest.links ?? []).map(link => ({ internal: true, ...link })),
  };
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function pageRange(crawlId) {
  return IDBKeyRange.only(crawlId);
}

async function list() {
  const db = await openDB();
  const records = await result(db.transaction(CRAWLS).objectStore(CRAWLS).getAll());
  return records
    .filter(record => record?.schemaVersion === 2)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getMeta(id) {
  const db = await openDB();
  return result(db.transaction(CRAWLS).objectStore(CRAWLS).get(id));
}

async function putMeta(meta) {
  const db = await openDB();
  const tx = db.transaction(CRAWLS, 'readwrite');
  tx.objectStore(CRAWLS).put(meta, meta.id);
  return done(tx);
}

// Read-modify-write inside one transaction, so a rename from the options page
// cannot be overwritten by an engine checkpoint and vice versa.
async function updateMeta(id, patch) {
  const db = await openDB();
  const tx = db.transaction(CRAWLS, 'readwrite');
  const store = tx.objectStore(CRAWLS);
  store.get(id).onsuccess = event => {
    const meta = event.target.result;
    if (meta) store.put({ ...meta, ...patch, updatedAt: new Date().toISOString() }, id);
  };
  return done(tx);
}

// Applies a per-URL patch to a crawl's pages in one transaction.
async function patchPages(crawlId, patchByUrl) {
  const db = await openDB();
  const tx = db.transaction(PAGES, 'readwrite', { durability: 'relaxed' });
  const store = tx.objectStore(PAGES);
  store.index('byCrawl').openCursor(pageRange(crawlId)).onsuccess = event => {
    const cursor = event.target.result;
    if (!cursor) return;
    const patch = patchByUrl.get(cursor.value.url);
    if (patch) cursor.update({ ...cursor.value, ...patch });
    cursor.continue();
  };
  return done(tx);
}

function rename(id, name) {
  return updateMeta(id, { name });
}

// One atomic checkpoint: pages, resume state and counters land together or not
// at all. `relaxed` durability, since a lost checkpoint is simply re-crawled.
async function commit({ crawlId, pages = [], state, counts }) {
  const db = await openDB();
  const stores = [PAGES, CRAWLS];
  if (state) stores.push(STATE);
  const tx = db.transaction(stores, 'readwrite', { durability: 'relaxed' });
  const pageStore = tx.objectStore(PAGES);
  for (const page of pages) pageStore.put(page);
  if (state) tx.objectStore(STATE).put({ ...state, crawlId, updatedAt: Date.now() });
  if (counts) {
    const store = tx.objectStore(CRAWLS);
    store.get(crawlId).onsuccess = event => {
      const meta = event.target.result;
      if (meta) store.put({ ...meta, counts, updatedAt: new Date().toISOString() }, crawlId);
    };
  }
  return done(tx);
}

async function putPages(pages) {
  if (!pages.length) return;
  const db = await openDB();
  const tx = db.transaction(PAGES, 'readwrite', { durability: 'relaxed' });
  const store = tx.objectStore(PAGES);
  for (const page of pages) store.put(page);
  return done(tx);
}

async function getPage(crawlId, url) {
  const db = await openDB();
  return result(db.transaction(PAGES).objectStore(PAGES).get([crawlId, url]));
}

async function countPages(crawlId) {
  const db = await openDB();
  return result(db.transaction(PAGES).objectStore(PAGES).index('byCrawl').count(pageRange(crawlId)));
}

// Reads in chunks over short transactions, so a large crawl neither holds a
// transaction open across `onBatch` nor needs to fit in memory at once.
async function iteratePages(crawlId, onBatch, { batchSize = 500 } = {}) {
  const db = await openDB();
  let after = null;
  for (;;) {
    const store = db.transaction(PAGES).objectStore(PAGES);
    const range = after === null
      ? IDBKeyRange.bound([crawlId, ''], [crawlId, '￿'])
      : IDBKeyRange.bound([crawlId, after], [crawlId, '￿'], true);
    const batch = await result(store.getAll(range, batchSize));
    if (!batch.length) return;
    await onBatch(batch);
    if (batch.length < batchSize) return;
    after = batch.at(-1).url;
  }
}

async function getPages(crawlId) {
  const pages = [];
  await iteratePages(crawlId, batch => { pages.push(...batch); });
  return pages;
}

async function getState(crawlId) {
  const db = await openDB();
  return result(db.transaction(STATE).objectStore(STATE).get(crawlId));
}

async function deleteState(crawlId) {
  const db = await openDB();
  const tx = db.transaction(STATE, 'readwrite');
  tx.objectStore(STATE).delete(crawlId);
  return done(tx);
}

async function findByStatus(status) {
  const db = await openDB();
  const records = await result(db.transaction(CRAWLS).objectStore(CRAWLS).index('byStatus').getAll(status));
  return records.filter(record => record?.schemaVersion === 2);
}

async function deleteOpfsDir(rootDir, crawlId) {
  if (!rootDir) return;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(rootDir);
    await dir.removeEntry(crawlId, { recursive: true });
  } catch (e) {
    if (e.name !== 'NotFoundError') console.warn(`blue dragon: could not delete archive of ${crawlId}`, e);
  }
}

// Removes the crawl and its pages. Archived HTML is removed only when
// `opfsRootDir` is passed: the options page can keep the two apart.
async function remove(id, { opfsRootDir } = {}) {
  const db = await openDB();
  const tx = db.transaction([CRAWLS, PAGES, STATE], 'readwrite');
  tx.objectStore(CRAWLS).delete(id);
  tx.objectStore(STATE).delete(id);
  const pages = tx.objectStore(PAGES);
  pages.index('byCrawl').openKeyCursor(pageRange(id)).onsuccess = event => {
    const cursor = event.target.result;
    if (!cursor) return;
    pages.delete(cursor.primaryKey);
    cursor.continue();
  };
  await done(tx);
  await deleteOpfsDir(opfsRootDir, id);
}

export const crawlDB = {
  list,
  getMeta,
  putMeta,
  updateMeta,
  rename,
  commit,
  putPages,
  patchPages,
  getPage,
  getPages,
  iteratePages,
  countPages,
  getState,
  deleteState,
  findByStatus,
  remove,
};
