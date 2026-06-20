// Shared IndexedDB helper for crawl blobs.
// Loaded as a classic script in both contexts:
//   - service worker: importScripts('db.js')
//   - UI page: <script src="./db.js"></script>
// Exposes globalThis.crawlDB.

(function () {
  const DB_NAME = 'blue-dragon';
  const DB_VERSION = 1;
  const STORE_CRAWLS = 'crawls';
  const STORE_META = 'crawlMeta';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CRAWLS)) db.createObjectStore(STORE_CRAWLS);
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(db, stores, mode) {
    return db.transaction(stores, mode);
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(storageKey, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = tx(db, [STORE_CRAWLS, STORE_META], 'readwrite');
      t.objectStore(STORE_CRAWLS).put(blob, storageKey);
      t.objectStore(STORE_META).put({ id: storageKey, name: blob.name }, storageKey);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function get(storageKey) {
    const db = await openDB();
    return reqToPromise(tx(db, STORE_CRAWLS, 'readonly').objectStore(STORE_CRAWLS).get(storageKey));
  }

  async function list() {
    const db = await openDB();
    return reqToPromise(tx(db, STORE_META, 'readonly').objectStore(STORE_META).getAll());
  }

  async function remove(storageKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = tx(db, [STORE_CRAWLS, STORE_META], 'readwrite');
      t.objectStore(STORE_CRAWLS).delete(storageKey);
      t.objectStore(STORE_META).delete(storageKey);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function rename(storageKey, newName) {
    const blob = await get(storageKey);
    if (!blob) throw new Error('Crawl not found');
    blob.name = newName;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = tx(db, [STORE_CRAWLS, STORE_META], 'readwrite');
      t.objectStore(STORE_CRAWLS).put(blob, storageKey);
      t.objectStore(STORE_META).put({ id: storageKey, name: newName }, storageKey);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  globalThis.crawlDB = { put, get, list, remove, rename };
})();
