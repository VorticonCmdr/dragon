import '@fontsource-variable/plus-jakarta-sans';
import { zipSync } from 'fflate';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_simple.min.css';
import Papa from 'papaparse';
import { Readability } from '@mozilla/readability';
import { RobotsMatcher } from 'google-robotstxt-parser';
import { extractPageMetadata } from './metadata.js';

// ── State ──────────────────────────────────────────────────────────────────

let table = null;
let linksTable = null;
let detailOutboundTable = null;
let detailInboundTable = null;
let crawlPaused = false;
let crawlStopped = false;
let crawlAbortController = null;

function setCrawlState(state) {
  const crawlBtn = document.getElementById('crawlBtn');
  const controls = document.getElementById('crawlControls');
  const pauseBtn = document.getElementById('pauseBtn');
  if (state === 'idle') {
    crawlBtn.classList.remove('hidden');
    controls.classList.add('hidden');
  } else {
    crawlBtn.classList.add('hidden');
    controls.classList.remove('hidden');
    pauseBtn.textContent = state === 'paused' ? 'resume' : 'pause';
  }
}
let urlsTxt = '';

const urlFormatter = (cell) => {
  const url = cell.getValue();
  if (!url) return '';
  const div = document.createElement('div');
  div.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;';
  div.textContent = url + '‎';
  return div;
};

let crawl = {
  id: new Date().getTime(),
  name: '',
  data: {
    startURL: '',
    queue: [],
    queueMaxLength: 1,
    alreadyFetched: {},
    depth: {},
    outboundOnly: {},
    results: {},
    responseHeaders: {},
  },
  settings: {
    stayonhostname: false,
    readability: false,
    charset: 'utf-8',
    maxRetries: 2,
    delay: 0,
    maxConnections: 5,
    credentials: 'omit',
    cache: 'no-store',
    crawlMode: 'list',
    maxPages: 500,
    filterRegex: '',
    filterType: '',
    respectRobots: true,
    fetchOutbound: false,
  },
  csv: { data: {} },
};

// ── DOM refs ───────────────────────────────────────────────────────────────

const urlListTextarea = document.getElementById('urlListTextarea');
const urlListCount = document.getElementById('urlListCount');

function updateUrlListCount() {
  const n = urlListTextarea.value.split('\n').filter(l => l.trim()).length;
  urlListCount.textContent = n > 0 ? `${n} URLs` : '';
  const overLimit = crawl.settings.crawlMode === 'list' && n > crawl.settings.maxPages;
  urlListCount.style.color = overLimit ? '#f97316' : '';
}
urlListTextarea.addEventListener('input', updateUrlListCount);

// ── Dropdowns ──────────────────────────────────────────────────────────────

document.querySelectorAll('[data-menu]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const menu = document.getElementById(btn.dataset.menu);
    if (!menu) return;
    const wasHidden = menu.classList.contains('hidden');
    closeAllMenus();
    if (wasHidden) menu.classList.remove('hidden');
  });
});

document.addEventListener('click', closeAllMenus);

function closeAllMenus() {
  document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.add('hidden'));
  document.getElementById('columnsPanel').classList.add('hidden');
}

// ── Dialogs ────────────────────────────────────────────────────────────────

document.querySelectorAll('[data-dialog]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.dialog)?.showModal();
  });
});

document.querySelectorAll('[data-dialog-close]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close();
  });
});

// ── Settings ───────────────────────────────────────────────────────────────

function saveSettings() {
  chrome.storage.local.set({ crawlSettings: crawl.settings });
}

function applySettings(s) {
  Object.assign(crawl.settings, s);
  document.getElementById('maxRetries').value = s.maxRetries ?? 2;
  document.getElementById('maxRetriesValue').textContent = s.maxRetries ?? 2;
  document.getElementById('maxConnections').value = s.maxConnections ?? 5;
  document.getElementById('maxConnectionsValue').textContent = s.maxConnections ?? 5;
  document.getElementById('delay').value = s.delay ?? 0;
  document.getElementById('delayValue').textContent = s.delay ?? 0;
  document.getElementById('credentials').value = s.credentials ?? 'omit';
  document.getElementById('cache').value = s.cache ?? 'no-store';
  document.getElementById('charset').value = s.charset ?? 'utf-8';
  document.getElementById('readability').checked = s.readability ?? false;
  document.getElementById('stayonhostname').checked = s.stayonhostname ?? false;
  document.getElementById('respectRobots').checked = s.respectRobots ?? true;
  document.getElementById('fetchOutbound').checked = s.fetchOutbound ?? false;
  document.getElementById('crawlMode').value = s.crawlMode ?? 'list';
  document.getElementById('maxPages').value = s.maxPages ?? 500;
  document.getElementById('filterRegex').value = s.filterRegex ?? '';
  document.getElementById('filterType').value = s.filterType ?? '';
  updateUIForCrawlMode();
}

(async () => {
  const { crawlSettings } = await chrome.storage.local.get('crawlSettings');
  if (crawlSettings) applySettings(crawlSettings);
})();

document.getElementById('maxRetries').addEventListener('input', function () {
  crawl.settings.maxRetries = parseInt(this.value);
  document.getElementById('maxRetriesValue').textContent = this.value;
  saveSettings();
});

document.getElementById('maxConnections').addEventListener('input', function () {
  crawl.settings.maxConnections = parseInt(this.value);
  document.getElementById('maxConnectionsValue').textContent = this.value;
  saveSettings();
});

document.getElementById('delay').addEventListener('input', function () {
  crawl.settings.delay = parseInt(this.value);
  document.getElementById('delayValue').textContent = this.value;
  saveSettings();
});

document.getElementById('credentials').addEventListener('change', function () {
  crawl.settings.credentials = this.value;
  saveSettings();
});

document.getElementById('cache').addEventListener('change', function () {
  crawl.settings.cache = this.value;
  saveSettings();
});

document.getElementById('charset').addEventListener('input', function () {
  crawl.settings.charset = this.value;
  saveSettings();
});

document.getElementById('readability').addEventListener('change', function () {
  crawl.settings.readability = this.checked;
  saveSettings();
});

document.getElementById('stayonhostname').addEventListener('change', function () {
  crawl.settings.stayonhostname = this.checked;
  saveSettings();
});

document.getElementById('respectRobots').addEventListener('change', function () {
  crawl.settings.respectRobots = this.checked;
  saveSettings();
});

document.getElementById('fetchOutbound').addEventListener('change', function () {
  crawl.settings.fetchOutbound = this.checked;
  saveSettings();
});

document.getElementById('crawlMode').addEventListener('change', function () {
  crawl.settings.crawlMode = this.value;
  if (this.value === 'recursive') {
    crawl.settings.stayonhostname = true;
    document.getElementById('stayonhostname').checked = true;
  }
  updateUIForCrawlMode();
  updateUrlListCount();
  saveSettings();
});

document.getElementById('maxPages').addEventListener('input', function () {
  crawl.settings.maxPages = parseInt(this.value, 10) || 500;
  updateUrlListCount();
  saveSettings();
});

document.getElementById('filterRegex').addEventListener('input', function () {
  crawl.settings.filterRegex = this.value.trim();
  saveSettings();
});

document.getElementById('filterType').addEventListener('change', function () {
  crawl.settings.filterType = this.value;
  saveSettings();
});

function updateUIForCrawlMode() {
  const isRecursive = crawl.settings.crawlMode === 'recursive';
  const textarea = document.getElementById('urlListTextarea');
  const spiderBtn = document.getElementById('spiderBtn');
  const spiderURL = document.getElementById('spiderURL');
  
  if (isRecursive) {
    textarea.setAttribute('readonly', 'true');
    textarea.classList.add('bg-slate-50', 'text-slate-500');
    textarea.placeholder = 'Autonomous crawl - URLs will be populated here in real-time as they are discovered';
    spiderURL.placeholder = 'Enter Start URL to crawl from';
    spiderBtn.classList.add('opacity-50', 'pointer-events-none');
  } else {
    textarea.removeAttribute('readonly');
    textarea.classList.remove('bg-slate-50', 'text-slate-500');
    textarea.placeholder = 'input URLs here line by line';
    spiderURL.placeholder = 'enter source URL to fetch URL list from';
    spiderBtn.classList.remove('opacity-50', 'pointer-events-none');
  }
}

// ── OPFS settings (persisted in chrome.storage.local) ──────────────────────

(async () => {
  const { opfsSettings = {} } = await chrome.storage.local.get('opfsSettings');
  document.getElementById('opfsEnabled').checked = opfsSettings.enabled ?? false;
  document.getElementById('opfsRootDir').value = opfsSettings.rootDir ?? 'crawl_archive';
})();

['opfsEnabled', 'opfsRootDir'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    chrome.storage.local.set({
      opfsSettings: {
        enabled: document.getElementById('opfsEnabled').checked,
        rootDir: document.getElementById('opfsRootDir').value.trim() || 'crawl_archive',
      },
    });
  });
});

let opfsWorker = null;

function startOpfsWorkerIfNeeded() {
  if (!document.getElementById('opfsEnabled').checked || opfsWorker) return;
  opfsWorker = new Worker(chrome.runtime.getURL('opfs-worker.js'));
  opfsWorker.onmessage = ({ data }) => {
    if (data.type === 'done' && crawl.data.results[data.url]) {
      crawl.data.results[data.url].opfs_path = data.path;
    }
  };
}

// ── Spider (fetch links from a start URL) ──────────────────────────────────

document.getElementById('spiderBtn').addEventListener('click', async () => {
  try {
    crawl.data.startURL = new URL(document.getElementById('spiderURL').value.trim());
  } catch (e) {
    console.log(e.message);
    return;
  }
  if (!crawl.data.startURL.href) return;
  startOpfsWorkerIfNeeded();
  await initialize(crawl.data.startURL.href);
  urlListTextarea.value = crawl.data.queue.join('\n');
  updateUrlListCount();
  setProgressbar();
});

// ── Crawl ──────────────────────────────────────────────────────────────────

document.getElementById('crawlBtn').addEventListener('click', async () => {
  document.getElementById('resultsArea').classList.add('hidden');
  crawl.data.alreadyFetched = {};
  crawl.data.depth = {};
  crawl.data.outboundOnly = {};
  crawl.data.results = {};
  crawl.data.responseHeaders = {};
  crawl.id = new Date().getTime();
  if (table) table.replaceData([]);

  const { opfsSettings = {} } = await chrome.storage.local.get('opfsSettings');

  if (crawl.settings.crawlMode === 'recursive') {
    const startVal = document.getElementById('spiderURL').value.trim();
    try {
      crawl.data.startURL = new URL(startVal);
    } catch (e) {
      alert('Please enter a valid Start URL');
      return;
    }
    crawl.data.queue = [crawl.data.startURL.href];
    crawl.data.depth[crawl.data.startURL.href] = 0;
  } else {
    const lines = urlListTextarea.value.split('\n');
    if (!crawl.data.startURL?.href) {
      try {
        crawl.data.startURL = new URL(lines[0]);
      } catch (e) {
        return;
      }
    }
    crawl.data.queue = [];
    lines.forEach(item => {
      if (!item) return;
      const href = absoluteLink(item);
      if (href) {
        crawl.data.queue.push(href);
        crawl.data.depth[href] = 0;
      }
    });
  }

  const hostname = crawl.data.startURL?.hostname || 'crawl';
  const datetime = new Date().toLocaleString();
  const crawlName = `${hostname} ${datetime}`;

  setCrawlState('running');
  document.getElementById('progressContainer').classList.remove('hidden');
  document.getElementById('progressLabel').textContent = `0 / ${crawl.data.queue.length} pages (0%)`;
  document.getElementById('progress').style.width = '0%';

  sendBgMessage({
    type: 'startCrawl',
    crawlId: crawl.id,
    name: crawlName,
    settings: {
      ...crawl.settings,
      opfsEnabled: !!(opfsSettings.enabled && opfsSettings.rootDir),
      opfsRootDir: opfsSettings.rootDir || 'crawl_archive',
    },
    queue: [...crawl.data.queue],
    depth: { ...crawl.data.depth },
    outboundOnly: {},
  });
});

document.getElementById('pauseBtn').addEventListener('click', () => {
  if (crawlPaused) {
    crawlPaused = false;
    setCrawlState('running');
    sendBgMessage({ type: 'resumeCrawl' });
  } else {
    crawlPaused = true;
    setCrawlState('paused');
    sendBgMessage({ type: 'pauseCrawl' });
  }
});

document.getElementById('stopBtn').addEventListener('click', () => {
  crawlPaused = false;
  sendBgMessage({ type: 'stopCrawl' });
  setCrawlState('idle');
  // crawlComplete message from SW will trigger table render with partial results
});

// ── Regex filter ───────────────────────────────────────────────────────────

function applyUrlListFilter(regexStr, type) {
  if (!regexStr) return;
  const re = new RegExp(regexStr, 'i');
  let queue = urlListTextarea.value.split('\n');
  if (type === 'include') {
    queue = queue.filter(u => re.test(u));
  } else if (type === 'exclude') {
    queue = queue.filter(u => !re.test(u));
  }
  crawl.data.queue = queue;
  crawl.data.queueMaxLength = 1;
  urlListTextarea.value = queue.join('\n');
  updateUrlListCount();
  setProgressbar();
}

document.getElementById('predefinedRegex').addEventListener('click', e => {
  const btn = e.target.closest('[data-regex]');
  if (!btn) return;
  const regex = btn.dataset.regex;
  const type = btn.dataset.type;
  document.getElementById('regexFilter').value = regex;
  // Saved presets have a defined type → apply immediately
  if (type) applyUrlListFilter(regex, type);
});

document.getElementById('regexFilterBtn').addEventListener('click', e => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  applyUrlListFilter(document.getElementById('regexFilter').value.trim(), btn.dataset.type);
});

(async () => {
  const { regexPresets = [] } = await chrome.storage.local.get('regexPresets');
  if (!regexPresets.length) return;
  const list = document.getElementById('regex-presets');
  const divider = document.createElement('li');
  divider.innerHTML = '<hr class="my-1 border-slate-100">';
  list.appendChild(divider);
  regexPresets.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      data-regex="${p.regex.replace(/"/g, '&quot;')}" data-type="${p.type}">
      <span class="flex-1">${p.name}</span>
      <span class="text-xs px-1.5 py-0.5 rounded-full font-medium ${p.type === 'include' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${p.type}</span>
    </button>`;
    list.appendChild(li);
  });
})();

// ── Save / Load / Delete ───────────────────────────────────────────────────

document.getElementById('save').addEventListener('click', () => {
  document.getElementById('saveNameTemplate').value = '{hostname} {datetime}';
  document.getElementById('saveModal').showModal();
});

document.getElementById('saveConfirmBtn').addEventListener('click', () => {
  const template = document.getElementById('saveNameTemplate').value.trim() || '{hostname} {datetime}';
  saveCrawl(resolveSaveName(template));
  document.getElementById('saveModal').close();
});

function resolveSaveName(template) {
  let hostname = crawl?.data?.startURL?.hostname || '';
  if (!hostname) {
    try { hostname = new URL(urlListTextarea.value.split('\n')[0].trim()).hostname; } catch {}
  }
  const datetime = new Date().toLocaleString();
  return template.replace(/\{hostname\}/g, hostname).replace(/\{datetime\}/g, datetime);
}

function exportFilename(ext) {
  return resolveSaveName('{hostname} {datetime}')
    .replace(/[/\\:*?"<>|,]/g, '-')
    .replace(/\s+/g, '_') + '.' + ext;
}

document.getElementById('loadModal').addEventListener('click', e => {
  const btn = e.target.closest('[data-crawlid]');
  if (btn) loadCrawl(btn.dataset.crawlid);
});

document.getElementById('deleteModal').addEventListener('click', e => {
  const btn = e.target.closest('[data-crawlid]');
  if (btn) deleteCrawl(btn.dataset.crawlid);
});

// ── CSV import ─────────────────────────────────────────────────────────────

document.getElementById('loadCSVBtn').addEventListener('click', () => {
  urlListTextarea.value = urlsTxt;
  updateUrlListCount();
  document.getElementById('csvModal').close();
});

const csvFileInput = document.getElementById('csvFileInput');
csvFileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) readActivities(file);
});

const csvDropArea = document.getElementById('csvDropArea');
csvDropArea.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
csvDropArea.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) readActivities(file);
});

// ── Sitemap import ─────────────────────────────────────────────────────────

document.getElementById('loadSitemapBtn').addEventListener('click', () => {
  const link = document.getElementById('sitemapUrlInput').value.trim();
  if (link) getSitemap(link);
});

const sitemapFileInput = document.getElementById('sitemapFileInput');
sitemapFileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', async ev => {
    await appendSitemapLocations(parseXMLSitemap(ev.target.result));
    document.getElementById('sitemapModal').close();
  });
  reader.readAsText(file);
});

const sitemapDropArea = document.getElementById('sitemapDropArea');
sitemapDropArea.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
sitemapDropArea.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', async ev => {
    await appendSitemapLocations(parseXMLSitemap(ev.target.result));
    document.getElementById('sitemapModal').close();
  });
  reader.readAsText(file);
});

// ── Table toolbar ──────────────────────────────────────────────────────────

document.getElementById('tableSearch').addEventListener('input', function () {
  if (!table) return;
  const val = this.value.trim();
  if (val) {
    table.setFilter([
      [
        { field: 'href', type: 'like', value: val },
        { field: 'title', type: 'like', value: val },
        { field: 'h1', type: 'like', value: val },
      ],
    ]);
  } else {
    table.clearFilter(false);
  }
});

document.getElementById('exportCSVBtn').addEventListener('click', () => {
  if (table) table.download('csv', exportFilename('csv'));
});

document.getElementById('exportOpfsZipBtn').addEventListener('click', async () => {
  const rootDirName = document.getElementById('opfsRootDir').value.trim() || 'crawl_archive';
  const crawlDirName = `crawl-${crawl.id}`;
  try {
    const root = await navigator.storage.getDirectory();
    const cDir = await (await root.getDirectoryHandle(rootDirName)).getDirectoryHandle(crawlDirName);
    const files = {};
    for await (const [name, handle] of cDir.entries()) {
      if (handle.kind !== 'file') continue;
      files[name] = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    }
    if (!Object.keys(files).length) {
      alert('No OPFS files found for this crawl.');
      return;
    }
    const zipped = zipSync(files);
    const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: exportFilename('zip') });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('ZIP export failed:', e);
    alert(`ZIP export failed: ${e.message}`);
  }
});

document.getElementById('columnsBtn').addEventListener('click', e => {
  e.stopPropagation();
  const panel = document.getElementById('columnsPanel');
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    buildColumnsPanel();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
});

function buildColumnsPanel() {
  if (!table) return;
  const panel = document.getElementById('columnsPanel');
  panel.innerHTML = '';
  table.getColumns().forEach(col => {
    const def = col.getDefinition();
    if (!def.field) return;
    const label = document.createElement('label');
    label.className = 'flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm rounded';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'rounded border-slate-300';
    cb.checked = col.isVisible();
    cb.addEventListener('change', () => col.toggle());
    label.appendChild(cb);
    label.appendChild(document.createTextNode(def.title));
    panel.appendChild(label);
  });
}

// ── Crawl list (storage) ───────────────────────────────────────────────────

async function getCrawlList() {
  const loadList = document.getElementById('crawlLoadList');
  const deleteList = document.getElementById('crawlDeleteList');
  loadList.innerHTML = '';
  deleteList.innerHTML = '';
  const entries = await crawlDB.list();
  entries.forEach(({ id, name }) => {
    const label = name || id;
    loadList.insertAdjacentHTML(
      'beforeend',
      `<button class="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded" data-crawlid="${id}">${label}</button>`,
    );
    deleteList.insertAdjacentHTML(
      'beforeend',
      `<button class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded" data-crawlid="${id}">${label}</button>`,
    );
  });
}

async function loadCrawl(id) {
  const loaded = await crawlDB.get(id);
  if (!loaded?.data) return;
  crawl = loaded;
  if (crawl.data?.queue?.length > 0) {
    urlListTextarea.value = crawl.data.queue.join('\n');
    updateUrlListCount();
  }
  if (crawl.data?.startURL) {
    try { crawl.data.startURL = new URL(crawl.data.startURL); } catch {}
  }
  if (crawl.data?.results) {
    document.getElementById('resultsArea').classList.remove('hidden');
    parseData();
    recomputeLogStats();
  }
  if (crawl.settings) {
    Object.keys(crawl.settings).forEach(key => {
      const el = document.getElementById(key);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = crawl.settings[key];
      else el.value = crawl.settings[key];
      const elValue = document.getElementById(`${key}Value`);
      if (elValue) elValue.textContent = crawl.settings[key];
    });
    updateUIForCrawlMode();
  }
  document.getElementById('loadModal').close();
}

async function saveCrawl(name) {
  crawl.name = name;
  const id = `crawl-${crawl.id}`;
  const blob = { ...crawl, data: { ...crawl.data, startURL: crawl?.data?.startURL?.href } };
  await crawlDB.put(id, blob);
  console.log(`crawl "${id}" saved`);
  await getCrawlList();
}

async function deleteCrawl(id) {
  await crawlDB.remove(id);
  try {
    const { opfsSettings = {} } = await chrome.storage.local.get('opfsSettings');
    const rootDirName = opfsSettings.rootDir || 'crawl_archive';
    const rootDir = await (await navigator.storage.getDirectory()).getDirectoryHandle(rootDirName);
    await rootDir.removeEntry(id, { recursive: true });
  } catch {}
  await getCrawlList();
  document.getElementById('deleteModal').close();
}

// ── Progress bar ───────────────────────────────────────────────────────────

function setProgressbar() {
  const crawledCount = Object.keys(crawl.data.results || {}).length;
  const total = crawledCount + crawl.data.queue.length;
  const pct = total > 0 ? Math.round((crawledCount / total) * 100) : 0;

  const totalSize = total * (crawl.settings.maxRetries || 1);
  performance.setResourceTimingBufferSize(Math.max(1000, totalSize));

  document.getElementById('progressContainer').classList.remove('hidden');
  const el = document.getElementById('progress');
  const label = document.getElementById('progressLabel');
  el.style.width = `${pct}%`;
  if (crawlPaused) {
    label.textContent = `${crawledCount} / ${total} pages — paused`;
    el.style.backgroundColor = '#94a3b8';
  } else {
    label.textContent = `${crawledCount} / ${total} pages (${pct}%)`;
    el.style.backgroundColor = '';
  }
}

// ── Initialize (spider one page to get its links) ──────────────────────────

async function initialize(href) {
  if (!href) return;
  crawl.data.queue = [];
  crawl.data.alreadyFetched = {};
  crawl.data.alreadyFetched[href] = 1;
  const response = await fetch(href, {
    cache: crawl.settings.cache,
    credentials: crawl.settings.credentials,
  }).catch(e => console.log(`fetch error: ${href}`));
  if (!response) return;
  const buf = await response.arrayBuffer();
  const html = new TextDecoder(crawl.settings.charset).decode(buf);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  crawl.data.queue = getLinks(doc);
  setProgressbar();
}

// ── Link helpers ───────────────────────────────────────────────────────────

function absoluteLink(link, base = crawl.data.startURL?.href) {
  if (!link) return '';
  let u;
  try {
    u = new URL(link, base);
  } catch (e) {
    return '';
  }
  if (u.protocol === 'chrome-extension:') {
    u.protocol = crawl.data.startURL.protocol;
    u.hostname = crawl.data.startURL.hostname;
  }
  if (crawl.settings.stayonhostname && u.hostname !== crawl.data.startURL.hostname) return '';
  u.hash = '';
  return u.href.trim();
}

function getLinks(doc) {
  [...doc.links].forEach(link => {
    const ahref = link.attributes.getNamedItem('href')?.value;
    if (!ahref || ahref.startsWith('#')) return;
    const href = absoluteLink(link);
    if (!href) return;
    if (!(href in crawl.data.alreadyFetched)) {
      crawl.data.alreadyFetched[href] = 0;
    }
  });
  return Object.keys(crawl.data.alreadyFetched);
}

const FOLLOW_TOKENS = new Set(['nofollow', 'ugc', 'sponsored']);

function parseFollowDirective(content) {
  if (!content) return null;
  return content.toLowerCase().split(/[\s,]+/).find(t => FOLLOW_TOKENS.has(t)) || null;
}

function extractInternalLinks(doc, currentUrl, metaRobots = '', xRobotsTag = '', filterHost = crawl.data.startURL?.hostname) {
  const metaFollow   = parseFollowDirective(metaRobots);
  const headerFollow = parseFollowDirective(xRobotsTag);
  const pageFollow   = metaFollow ?? headerFollow;
  const pageSource   = metaFollow ? 'meta' : (headerFollow ? 'header' : null);

  const seen = new Map();

  [...doc.links].forEach(link => {
    const rawHref = link.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    if (rawHref.includes('${') || rawHref.includes('{{')) return;
    let resolved;
    try { resolved = new URL(rawHref, currentUrl); } catch { return; }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    resolved.hash = '';
    if (filterHost && resolved.hostname !== filterHost) return;
    const url = resolved.href;
    if (seen.has(url)) return;

    const relAttr = link.getAttribute('rel') || '';
    const anchorFollow = relAttr.toLowerCase().split(/\s+/).find(t => FOLLOW_TOKENS.has(t)) || null;

    let follow, directive_source;
    if (anchorFollow) {
      follow = anchorFollow;
      directive_source = 'anchor';
    } else if (pageFollow) {
      follow = pageFollow;
      directive_source = pageSource;
    } else {
      follow = 'follow';
      directive_source = '';
    }

    seen.set(url, { url, follow, directive_source });
  });

  return [...seen.values()];
}

function extractNewLinks(doc, currentUrl) {
  const newLinks = [];
  const startHost = crawl.data.startURL?.hostname;
  
  [...doc.links].forEach(link => {
    const rawHref = link.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    if (rawHref.includes('${') || rawHref.includes('{{')) return;

    let resolvedUrl;
    try {
      resolvedUrl = new URL(rawHref, currentUrl);
    } catch (e) {
      return;
    }
    
    if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') return;
    resolvedUrl.hash = '';
    const href = resolvedUrl.href;

    if (crawl.settings.stayonhostname && resolvedUrl.hostname !== startHost) return;

    if (crawl.settings.filterRegex && crawl.settings.filterType) {
      try {
        const re = new RegExp(crawl.settings.filterRegex, 'i');
        const isMatch = re.test(href);
        if (crawl.settings.filterType === 'include' && !isMatch) return;
        if (crawl.settings.filterType === 'exclude' && isMatch) return;
      } catch (e) {}
    }

    if (!(href in crawl.data.alreadyFetched) && !crawl.data.queue.includes(href)) {
      newLinks.push(href);
    }
  });
  return newLinks;
}

// ── Page processing ────────────────────────────────────────────────────────

function processPage(html, href) {
  if (!html) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const metadata = extractPageMetadata(doc, href);

  if (crawl.settings.readability) {
    try {
      ['header', 'footer', 'nav'].forEach(sel => {
        doc.querySelectorAll(sel).forEach(el => el.remove());
      });
      const reader = new Readability(doc).parse();
      metadata.content = reader.textContent;
      const extract = parser.parseFromString(reader.content, 'text/html');
      metadata.paragraphs = [...extract.getElementsByTagName('p')]
        .map(p => p.innerText?.trim().replaceAll('\t', ' ').replace(/\s+/g, ' '))
        .filter(Boolean);
    } catch (e) {
      console.log('readability error');
    }
  }

  return metadata;
}

// ── Robots.txt ────────────────────────────────────────────────────────────

const robotsCache = new Map();
let robotsOverridesMap = {};
let currentBotName = 'Googlebot';

function extractBotName(ua) {
  if (!ua) return '*';
  // "Mozilla/5.0 (compatible; Googlebot/2.1; ...)" → "Googlebot"
  const compat = ua.match(/\(compatible;\s*([A-Za-z][A-Za-z-]*)/);
  if (compat) return compat[1];
  // "DuckDuckBot/1.1" or "Googlebot-Image/1.0" at start
  const direct = ua.match(/^([A-Za-z][A-Za-z-]+)\//);
  if (direct) return direct[1];
  return '*';
}

function getRobotsTxt(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  if (origin in robotsOverridesMap) {
    const p = Promise.resolve(robotsOverridesMap[origin]);
    robotsCache.set(origin, p);
    return p;
  }
  const promise = fetch(`${origin}/robots.txt`, { cache: 'no-cache', credentials: 'omit' })
    .then(r => r.ok ? r.text() : '')
    .catch(() => '')
    .then(text => {
      chrome.storage.local.get('robotsFetched', ({ robotsFetched = {} }) => {
        robotsFetched[origin] = text;
        chrome.storage.local.set({ robotsFetched });
      });
      return text;
    });
  robotsCache.set(origin, promise);
  return promise;
}

async function checkRobotsAllowed(url) {
  const { origin } = new URL(url);
  const robotsTxt = await getRobotsTxt(origin);
  if (!robotsTxt) return true;
  return new RobotsMatcher().oneAgentAllowedByRobots(robotsTxt, currentBotName, url);
}

// ── Fetch queue ────────────────────────────────────────────────────────────

const sleep = ms => new Promise(res => setTimeout(res, ms));
const fetchURLQueue = [];

async function fetchURL(link) {
  if ((crawl.data.alreadyFetched?.[link] ?? 0) > crawl.settings.maxRetries) return;
  crawl.data.alreadyFetched[link] = (crawl.data.alreadyFetched[link] || 0) + 1;

  const isOutboundOnly = crawl.data.outboundOnly[link] ?? false;

  try { new URL(link); } catch (e) {
    console.error(`invalid URL: ${link}`);
    return;
  }

  const crawlable = await checkRobotsAllowed(link);

  if (!crawlable && crawl.settings.respectRobots) {
    crawl.data.results[link] = {
      href: link,
      crawlable,
      isOutbound: isOutboundOnly || undefined,
      depth: crawl.data.depth[link] ?? 0,
      fetch: { status: null, ok: false, timestamp: new Date().toISOString() },
    };
    return;
  }

  const t0 = performance.now();
  const response = await fetch(link, {
    credentials: crawl.settings.credentials,
    cache: 'no-cache',
    signal: crawlAbortController?.signal,
  }).catch(e => { if (e.name !== 'AbortError') console.error(`${e.message}: ${link}`); });

  if (!response) return;

  if (!crawl.data.results[link]) crawl.data.results[link] = {};
  crawl.data.results[link].href = link;
  crawl.data.results[link].isOutbound = isOutboundOnly || undefined;
  crawl.data.results[link].depth = crawl.data.depth[link] ?? 0;
  crawl.data.results[link].crawlable = crawlable;
  crawl.data.results[link].fetch = {
    timestamp: new Date().toISOString(),
    redirected: response?.redirected,
    finalUrl: response?.redirected ? response.url : undefined,
    status: response?.status,
    statusText: response?.statusText,
    ok: response?.ok,
    contentType: response?.headers.get('content-type') || '',
  };

  if (!response?.ok) {
    crawl.data.results[link].href = link;
    if ((crawl.data.alreadyFetched[link] ?? 0) < crawl.settings.maxRetries) {
      crawl.data.queue.push(link);
    }
    return;
  }

  const buf = await response.arrayBuffer();

  const duration = Math.round(performance.now() - t0);
  const decodedBodySize = buf.byteLength;
  const contentEncoding = response.headers.get('content-encoding') || '';

  const perfEntries = performance.getEntriesByName(link, 'resource');
  const perfEntry = perfEntries.length > 0 ? perfEntries[perfEntries.length - 1] : null;

  const encodedBodySize = perfEntry?.encodedBodySize || parseInt(response.headers.get('content-length') || '0', 10) || decodedBodySize;
  const deliveryType = perfEntry ? (perfEntry.transferSize === 0 ? 'cache' : 'network') : (duration < 12 ? 'cache' : 'network');
  const nextHopProtocol = perfEntry?.nextHopProtocol || '';

  Object.assign(crawl.data.results[link].fetch, { duration, decodedBodySize, encodedBodySize, deliveryType, contentEncoding, nextHopProtocol });

  const html = new TextDecoder(crawl.settings.charset).decode(buf);
  if (!html) {
    console.error(`empty response: ${link}`);
    return;
  }

  if (opfsWorker) {
    opfsWorker.postMessage({
      type: 'write',
      rootDir: document.getElementById('opfsRootDir').value.trim() || 'crawl_archive',
      crawlDir: `crawl-${crawl.id}`,
      url: link,
      html,
    });
  }

  try {
    const metadata = processPage(html, link);
    Object.assign(crawl.data.results[link], metadata);
  } catch (e) {
    console.error('processPage failed:', link, e);
  }

  const isHtml = (crawl.data.results[link].fetch?.contentType || '').includes('text/html');

  if (crawl.settings.crawlMode === 'recursive') {
    const totalCrawled = Object.keys(crawl.data.results).length;
    if (totalCrawled < crawl.settings.maxPages && isHtml) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const xRobotsTag = response?.headers.get('x-robots-tag') || '';
      crawl.data.results[link].links = extractInternalLinks(doc, link, crawl.data.results[link].robots || '', xRobotsTag);
      const newLinks = extractNewLinks(doc, link);
      const parentDepth = crawl.data.depth[link] ?? 0;
      newLinks.forEach(newLink => {
        const d = parentDepth + 1;
        if (!(newLink in crawl.data.depth) || crawl.data.depth[newLink] > d) {
          crawl.data.depth[newLink] = d;
        }
        crawl.data.queue.push(newLink);
      });
      urlListTextarea.value = crawl.data.queue.join('\n');
      updateUrlListCount();
      setProgressbar();
    }
  } else if (isHtml && !isOutboundOnly) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const xRobotsTag = response?.headers.get('x-robots-tag') || '';
    crawl.data.results[link].links = extractInternalLinks(doc, link, crawl.data.results[link].robots || '', xRobotsTag, null);
    if (crawl.settings.fetchOutbound) {
      crawl.data.results[link].links.forEach(l => {
        const outUrl = l.url;
        if (!(outUrl in crawl.data.alreadyFetched) && !(outUrl in crawl.data.outboundOnly)) {
          crawl.data.outboundOnly[outUrl] = true;
          crawl.data.queue.push(outUrl);
        }
      });
      setProgressbar();
    }
  }

  return sleep(crawl.settings.delay);
}

async function processQueue() {
  if (!crawl.data.queue) return;
  if (crawlPaused) return;
  setProgressbar();

  function onDone() {
    fetchURLQueue.pop();
    if (!crawlPaused) processQueue();

    const inFlightDone = fetchURLQueue.length === 0;
    const queueEmpty = crawl.data.queue.length === 0;

    // Paused and all in-flight drained → show intermediate results
    if (inFlightDone && crawlPaused && !crawlStopped) {
      document.getElementById('resultsArea').classList.remove('hidden');
      parseData();
    }

    // All work done (natural completion or stop drain)
    if (inFlightDone && queueEmpty && !crawlPaused) {
      performance.mark('crawl-ended');
      if (!crawlStopped) {
        document.getElementById('resultsArea').classList.remove('hidden');
        parseData();
        opfsWorker?.terminate();
        opfsWorker = null;
      } else {
        crawlStopped = false;
      }
      crawlPaused = false;
      setCrawlState('idle');
    }
  }

  while (fetchURLQueue.length <= crawl.settings.maxConnections && crawl.data.queue.length > 0) {
    if (crawl.settings.crawlMode === 'recursive' && Object.keys(crawl.data.results).length >= crawl.settings.maxPages) {
      crawl.data.queue = [];
      break;
    }
    const link = crawl.data.queue.pop();
    if (!link) continue;
    fetchURLQueue.push(1);
    fetchURL(link).then(onDone).catch(onDone);
  }
}

// ── OPFS file access ───────────────────────────────────────────────────────

async function readOpfsFile(path) {
  const parts = path.split('/');
  const root = await navigator.storage.getDirectory();
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts.at(-1))).getFile();
}

// ── Utilities ──────────────────────────────────────────────────────────────

function dict2flatarray(dict) {
  Object.entries(dict).forEach(([key, value]) => {
    if (value !== null && typeof value === 'object') {
      Object.keys(value).forEach(item => {
        if (typeof value[item] === 'object') {
          delete value[item];
        } else {
          dict[`${key}_${item}`] = value[item];
        }
      });
      delete dict[key];
    }
  });
  return dict;
}

// ── CSV parsing ────────────────────────────────────────────────────────────

function readActivities(file) {
  if (file.type && file.type !== 'text/csv') {
    console.log('not a csv file:', file.type);
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', e => parseActivitiesData(e.target.result));
  reader.readAsText(file);
}

function parseActivitiesData(textData) {
  const result = Papa.parse(textData, { header: true });
  urlsTxt = '';
  result?.data?.forEach(item => {
    const url = item.URL || item.page || item.Page;
    if (!url) return;
    urlsTxt += `${url}\n`;
    crawl.csv.data[url] = item;
  });
}

// ── Sitemap ────────────────────────────────────────────────────────────────

async function getSitemap(link) {
  const response = await fetch(link, {
    credentials: crawl.settings.credentials,
    cache: 'no-cache',
  }).catch(e => console.error(`${e.message}: ${link}`));
  if (!response) return;

  let content = '';
  if (link.includes('.gz')) {
    const blob = await response.blob();
    const buf = await blob.arrayBuffer();
    content = await decompress(buf, 'gzip');
  } else {
    content = await response.text();
  }

  await appendSitemapLocations(parseXMLSitemap(content));
  document.getElementById('sitemapModal').close();
}

async function appendSitemapLocations(xmlDoc) {
  const statusEl = document.getElementById('sitemapStatus');

  if (xmlDoc.documentElement?.tagName?.toLowerCase() === 'sitemapindex') {
    const childUrls = [...xmlDoc.getElementsByTagName('sitemap')]
      .map(s => s.getElementsByTagName('loc')[0]?.textContent?.trim())
      .filter(Boolean);

    const total = childUrls.length;
    let done = 0;
    statusEl.textContent = `Loading 0 / ${total} sitemaps…`;
    statusEl.classList.remove('hidden');

    const settled = await Promise.allSettled(
      childUrls.map(url =>
        fetch(url, { credentials: crawl.settings.credentials, cache: 'no-cache' })
          .then(r => url.includes('.gz')
            ? r.blob().then(b => b.arrayBuffer()).then(buf => decompress(buf, 'gzip'))
            : r.text())
          .then(content => {
            statusEl.textContent = `Loading ${++done} / ${total} sitemaps…`;
            return [...parseXMLSitemap(content).getElementsByTagName('loc')]
              .map(loc => loc.textContent.trim())
              .filter(Boolean);
          })
          .catch(e => { console.error(e); return []; })
      )
    );

    const allUrls = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (allUrls.length) { urlListTextarea.value += allUrls.join('\n') + '\n'; updateUrlListCount(); }
    statusEl.textContent = `${allUrls.length} URLs loaded from ${total} sitemaps`;
    setTimeout(() => statusEl.classList.add('hidden'), 3000);

  } else {
    const urls = [...xmlDoc.getElementsByTagName('loc')]
      .map(loc => loc.textContent.trim())
      .filter(Boolean);
    if (urls.length) { urlListTextarea.value += urls.join('\n') + '\n'; updateUrlListCount(); }
  }
}

function decompress(buf, format) {
  const cs = new DecompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(buf);
  writer.close();
  return new Response(cs.readable).arrayBuffer().then(ab => new TextDecoder().decode(ab));
}

function parseXMLSitemap(content) {
  return new DOMParser().parseFromString(content, 'text/xml');
}

// ── Table ──────────────────────────────────────────────────────────────────

function parseData() {
  const TF = { tristate: true };
  const columns = [
    {
      title: 'url', field: 'href', visible: true, sorter: 'string', minWidth: 380, widthGrow: 1,
      tooltip: true, formatter: urlFormatter, headerFilter: 'input',
    },
    { title: 'status',          field: 'fetch_status',           visible: true,  sorter: 'number', width: 80,  hozAlign: 'right', headerFilter: 'input' },
    { title: 'depth',           field: 'depth',                  visible: true,  sorter: 'number', width: 70,  hozAlign: 'right', headerFilter: 'input' },
    { title: 'duration (ms)',   field: 'fetch_duration',         visible: true,  sorter: 'number', hozAlign: 'right', headerFilter: 'input' },
    { title: 'redirected',      field: 'fetch_redirected',       visible: true,  sorter: 'boolean', headerFilter: 'tickCross', headerFilterParams: TF },
    { title: 'redirect target', field: 'fetch_finalUrl',         visible: false, sorter: 'string', minWidth: 200, headerFilter: 'input' },
    { title: 'encoded size',    field: 'fetch_encodedBodySize',  visible: true,  sorter: 'number', hozAlign: 'right', headerFilter: 'input' },
    { title: 'canonical',       field: 'canonical',              visible: false, sorter: 'string', minWidth: 150, headerFilter: 'input' },
    { title: 'title',           field: 'title',                  visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'description',     field: 'description',            visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'keyword',         field: 'keyword',                visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'robots',          field: 'robots',                 visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'h1',              field: 'h1',                     visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'content-type',    field: 'fetch_contentType',      visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'decoded size',    field: 'fetch_decodedBodySize',  visible: false, sorter: 'number', hozAlign: 'right', headerFilter: 'input' },
    { title: 'deliveryType',      field: 'fetch_deliveryType',      visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'content-encoding', field: 'fetch_contentEncoding',  visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'next hop protocol', field: 'fetch_nextHopProtocol', visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'timestamp',         field: 'fetch_timestamp',        visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'ok',              field: 'fetch_ok',               visible: false, sorter: 'boolean', width: 70, headerFilter: 'tickCross', headerFilterParams: TF },
    { title: 'og:image',        field: 'og_image',               visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'og:title',        field: 'og_title',               visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'og:site',         field: 'og_site_name',           visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'og:description',  field: 'og_description',         visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'publisher',       field: 'schema_publisher',       visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'dateModified',    field: 'schema_dateModified',    visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'datePublished',   field: 'schema_datePublished',   visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'authors',         field: 'schema_authors',         visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'headline',        field: 'schema_headline',        visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'altHeadline',     field: 'schema_alternateHeadline', visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'content',         field: 'content',                visible: false, sorter: 'string', headerFilter: 'input' },
    { title: 'outbound',        field: 'isOutbound',             visible: true,  sorter: 'boolean', width: 80, headerFilter: 'tickCross', headerFilterParams: TF },
    { title: 'crawlable',       field: 'crawlable',              visible: true,  sorter: 'boolean', width: 90, headerFilter: 'tickCross', headerFilterParams: TF },
    { title: 'indexable',       field: 'indexable',              visible: true,  sorter: 'boolean', width: 90, headerFilter: 'tickCross', headerFilterParams: TF },
    { title: 'outbound links',  field: 'outbound_count',  visible: false, sorter: 'number', hozAlign: 'right', width: 110, headerFilter: 'input' },
    { title: 'inbound links',   field: 'inbound_count',   visible: false, sorter: 'number', hozAlign: 'right', width: 100, headerFilter: 'input' },
    { title: 'broken outbound', field: 'broken_outbound', visible: false, sorter: 'number', hozAlign: 'right', width: 120, headerFilter: 'input' },
    { title: 'clicks',          field: 'clicks',                 visible: false, sorter: 'number', hozAlign: 'right', headerFilter: 'input' },
    { title: 'impressions',     field: 'impressions',            visible: false, sorter: 'number', hozAlign: 'right', headerFilter: 'input' },
    {
      title: 'html',
      field: 'opfs_path',
      visible: document.getElementById('opfsEnabled').checked,
      download: false,
      headerSort: false,
      formatter: (cell) => {
        const path = cell.getValue();
        if (!path) return '';
        const wrap = document.createElement('div');
        wrap.className = 'flex gap-1';
        const mkBtn = (label, onClick) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.className = 'text-xs px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600';
          b.addEventListener('click', onClick);
          return b;
        };
        wrap.appendChild(mkBtn('open', async () => {
          const file = await readOpfsFile(path);
          window.open(URL.createObjectURL(file));
        }));
        wrap.appendChild(mkBtn('dl', async () => {
          const file = await readOpfsFile(path);
          const url = URL.createObjectURL(file);
          const a = Object.assign(document.createElement('a'), { href: url, download: path.split('/').pop() });
          a.click();
          URL.revokeObjectURL(url);
        }));
        return wrap;
      },
    },
  ];

  const inboundCount = {};
  const brokenOutbound = {};
  Object.values(crawl.data.results).forEach(r => {
    let broken = 0;
    (r.links || []).forEach(t => {
      inboundCount[t.url] = (inboundCount[t.url] || 0) + 1;
      const s = crawl.data.results[t.url]?.fetch?.status;
      if (s != null && s >= 400) broken++;
    });
    if (broken > 0) brokenOutbound[r.href] = broken;
  });

  const dataArray = JSON.parse(JSON.stringify(Object.values(crawl.data.results)));
  dataArray.forEach(r => {
    r.outbound_count   = r.links?.length ?? null;
    r.inbound_count    = inboundCount[r.href] ?? null;
    r.broken_outbound  = brokenOutbound[r.href] ?? null;
    const ct = (r.fetch?.contentType || '').toLowerCase();
    const robots = (r.robots || '').toLowerCase();
    r.indexable = !!(r.fetch?.ok && ct.includes('text/html') && !robots.includes('noindex'));
    delete r.links;
    dict2flatarray(r);
  });

  if (table) {
    table.replaceData(dataArray);
    return;
  }

  table = new Tabulator('#jsonTable', {
    data: dataArray,
    layout: 'fitColumns',
    pagination: true,
    paginationSize: 50,
    paginationSizeSelector: [25, 50, 100, true],
    movableColumns: true,
    headerFilterLiveFilterDelay: 300,
    columns,
    rowFormatter: (row) => {
      const s = row.getData().fetch_status;
      const el = row.getElement();
      el.style.removeProperty('background-color');
      if (s >= 400) el.style.backgroundColor = '#fef2f2';
      else if (s >= 300) el.style.backgroundColor = '#fffbeb';
    },
  });
  table.on('rowClick', (e, row) => {
    if (e.target.tagName === 'BUTTON') return;
    showURLDetail(row.getData().href);
  });
}

// ── Link explorer ─────────────────────────────────────────────────────────

function showLinksExplorer() {
  const edges = [];
  Object.values(crawl.data.results).forEach(r => {
    (r.links || []).forEach(({ url, follow, directive_source }) =>
      edges.push({ source: r.href, target: url, follow, directive_source }));
  });
  document.getElementById('linksCount').textContent = edges.length.toLocaleString();

  if (linksTable) {
    linksTable.replaceData(edges);
  } else {
    linksTable = new Tabulator('#linksTable', {
      data: edges,
      layout: 'fitColumns',
      pagination: true,
      paginationSize: 100,
      paginationSizeSelector: [50, 100, 250, true],
      columns: [
        { title: 'source',           field: 'source',           minWidth: 300, widthGrow: 1, tooltip: true, formatter: urlFormatter },
        { title: 'target',           field: 'target',           minWidth: 300, widthGrow: 1, tooltip: true, formatter: urlFormatter },
        { title: 'follow',           field: 'follow',           width: 110, sorter: 'string' },
        { title: 'directive source', field: 'directive_source', width: 130, sorter: 'string' },
      ],
    });
  }
  document.getElementById('linksModal').showModal();
}

document.getElementById('linksBtn').addEventListener('click', showLinksExplorer);

// ── URL detail view ────────────────────────────────────────────────────────

function showURLDetail(href) {
  const result = crawl.data.results[href];
  if (!result) return;

  document.getElementById('detailModalTitle').textContent = result.title || href;
  const urlEl = document.getElementById('detailModalUrl');
  urlEl.href = href;
  urlEl.textContent = href;

  const body = document.getElementById('detailBody');
  body.innerHTML = '';

  const SKIP = new Set(['href', 'links', 'paragraphs']);

  const makeGrid = () => {
    const g = document.createElement('div');
    g.className = 'grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm';
    return g;
  };
  const addRow = (grid, label, val) => {
    if (val === null || val === undefined || val === '') return false;
    grid.insertAdjacentHTML('beforeend',
      `<span class="text-slate-400 whitespace-nowrap">${label}</span><span class="text-slate-700 break-all">${val}</span>`);
    return true;
  };
  const addSection = (title, pairs) => {
    const grid = makeGrid();
    let any = false;
    pairs.forEach(([k, v]) => { if (addRow(grid, k, v)) any = true; });
    if (!any) return;
    if (title) {
      const h = document.createElement('h3');
      h.className = 'text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2';
      h.textContent = title;
      body.appendChild(h);
    }
    body.appendChild(grid);
  };

  // Redirect chain visualization
  const finalUrl = result.fetch?.finalUrl;
  if (finalUrl) {
    const div = document.createElement('div');
    div.className = 'space-y-1.5';
    div.innerHTML = `
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Redirect</h3>
      <div class="flex flex-col gap-1 text-sm font-mono">
        <div class="flex items-center gap-2">
          <span class="text-slate-400 text-xs w-8 text-right shrink-0">${result.fetch.status ?? ''}</span>
          <span class="text-slate-500 break-all">${href}</span>
        </div>
        <div class="flex items-center gap-2 pl-2">
          <span class="text-slate-300 text-xs">↳</span>
          <a href="${finalUrl}" target="_blank"
             class="text-blue-600 hover:underline break-all">${finalUrl}</a>
        </div>
      </div>`;
    body.appendChild(div);
  }

  // Root-level scalar fields first
  addSection(null, Object.entries(result)
    .filter(([k, v]) => !SKIP.has(k) && (typeof v !== 'object' || v === null))
    .map(([k, v]) => [k, v != null ? String(v) : '']));

  // Nested objects as labelled sections
  const FETCH_SKIP = new Set(['finalUrl']);
  Object.entries(result).forEach(([key, value]) => {
    if (SKIP.has(key) || !value || typeof value !== 'object' || Array.isArray(value)) return;
    addSection(key, Object.entries(value)
      .filter(([k]) => key !== 'fetch' || !FETCH_SKIP.has(k))
      .map(([k, v]) => [k, v != null ? String(v) : '']));
  });

  const linkRowFormatter = (row) => {
    const s = row.getData().status;
    const el = row.getElement();
    el.style.removeProperty('background-color');
    if (s >= 400) el.style.backgroundColor = '#fef2f2';
    else if (s >= 300) el.style.backgroundColor = '#fffbeb';
  };

  const outbound = (result.links || []).map(l => ({
    ...l, status: crawl.data.results[l.url]?.fetch?.status ?? null,
  }));
  document.getElementById('detailOutboundCount').textContent = `(${outbound.length})`;
  if (detailOutboundTable) {
    detailOutboundTable.replaceData(outbound);
  } else {
    detailOutboundTable = new Tabulator('#detailOutboundTable', {
      data: outbound, layout: 'fitColumns', pagination: true, paginationSize: 25,
      paginationSizeSelector: [25, 50, true],
      rowFormatter: linkRowFormatter,
      columns: [
        { title: 'url', field: 'url', minWidth: 250, widthGrow: 1, tooltip: true, formatter: urlFormatter },
        { title: 'status', field: 'status', width: 75, hozAlign: 'right' },
        { title: 'follow', field: 'follow', width: 100 },
        { title: 'directive', field: 'directive_source', width: 120 },
      ],
    });
    detailOutboundTable.on('rowClick', (e, row) => {
      const url = row.getData().url;
      if (crawl.data.results[url]) showURLDetail(url);
    });
  }

  const inbound = [];
  Object.values(crawl.data.results).forEach(r => {
    if (r.href === href) return;
    (r.links || []).forEach(l => {
      if (l.url === href) inbound.push({
        url: r.href, follow: l.follow, directive_source: l.directive_source,
        status: r.fetch?.status ?? null,
      });
    });
  });
  document.getElementById('detailInboundCount').textContent = `(${inbound.length})`;
  if (detailInboundTable) {
    detailInboundTable.replaceData(inbound);
  } else {
    detailInboundTable = new Tabulator('#detailInboundTable', {
      data: inbound, layout: 'fitColumns', pagination: true, paginationSize: 25,
      paginationSizeSelector: [25, 50, true],
      rowFormatter: linkRowFormatter,
      columns: [
        { title: 'source', field: 'url', minWidth: 250, widthGrow: 1, tooltip: true, formatter: urlFormatter },
        { title: 'status', field: 'status', width: 75, hozAlign: 'right' },
        { title: 'follow', field: 'follow', width: 100 },
        { title: 'directive', field: 'directive_source', width: 120 },
      ],
    });
    detailInboundTable.on('rowClick', (e, row) => showURLDetail(row.getData().url));
  }

  document.getElementById('detailModal').showModal();
}

// ── Issues audit ──────────────────────────────────────────────────────────

function buildIssues() {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const list = document.getElementById('issuesList');
  const results = Object.values(crawl.data.results);

  if (results.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-400 py-4">No crawl data yet — run a crawl first.</p>';
    return;
  }

  const issues = [];

  const broken = results.filter(r => (r.fetch?.status ?? 0) >= 400);
  if (broken.length) issues.push({
    title: 'Broken pages (4xx / 5xx)', severity: 'error',
    items: broken.map(r => ({ href: r.href, detail: `${r.fetch.status} ${r.fetch.statusText || ''}`.trim() })),
  });

  const redirected = results.filter(r => r.fetch?.redirected);
  if (redirected.length) issues.push({
    title: 'Redirected pages', severity: 'warning',
    items: redirected.map(r => ({ href: r.href, detail: String(r.fetch.status) })),
  });

  const notCrawlable = results.filter(r => r.crawlable === false);
  if (notCrawlable.length) issues.push({
    title: 'Blocked by robots.txt', severity: 'warning',
    items: notCrawlable.map(r => ({ href: r.href, detail: r.robots || '' })),
  });

  const isHtml = r => (r.fetch?.contentType || '').includes('text/html');
  const okHtml = r => (r.fetch?.status ?? 0) < 400 && isHtml(r);

  const noTitle = results.filter(r => okHtml(r) && !r.title);
  if (noTitle.length) issues.push({ title: 'Missing title', severity: 'warning', items: noTitle.map(r => ({ href: r.href, detail: '' })) });

  const noH1 = results.filter(r => okHtml(r) && !r.h1);
  if (noH1.length) issues.push({ title: 'Missing H1', severity: 'info', items: noH1.map(r => ({ href: r.href, detail: '' })) });

  const noDesc = results.filter(r => okHtml(r) && !r.description);
  if (noDesc.length) issues.push({ title: 'Missing meta description', severity: 'info', items: noDesc.map(r => ({ href: r.href, detail: '' })) });

  const noCanonical = results.filter(r => okHtml(r) && !r.canonical);
  if (noCanonical.length) issues.push({ title: 'Missing canonical', severity: 'info', items: noCanonical.map(r => ({ href: r.href, detail: '' })) });

  const titleMap = {};
  results.filter(isHtml).forEach(r => { if (r.title) (titleMap[r.title] = titleMap[r.title] || []).push(r.href); });
  const dupTitles = Object.entries(titleMap).filter(([, urls]) => urls.length > 1);
  if (dupTitles.length) {
    const items = [];
    dupTitles.forEach(([title, urls]) => urls.forEach(href => items.push({ href, detail: title })));
    issues.push({ title: 'Duplicate titles', severity: 'warning', items });
  }

  const brokenLinks = [];
  results.forEach(r => {
    (r.links || []).forEach(l => {
      const s = crawl.data.results[l.url]?.fetch?.status;
      if (s != null && s >= 400) brokenLinks.push({ href: r.href, detail: `→ ${l.url} (${s})` });
    });
  });
  if (brokenLinks.length) issues.push({ title: 'Pages with broken outbound links', severity: 'error', items: brokenLinks });

  list.innerHTML = '';

  if (issues.length === 0) {
    list.innerHTML = '<p class="text-sm text-green-600 py-4">No issues found.</p>';
    return;
  }

  const badge = { error: 'bg-red-100 text-red-700', warning: 'bg-amber-100 text-amber-700', info: 'bg-slate-100 text-slate-500' };
  const dot   = { error: 'bg-red-500',              warning: 'bg-amber-400',                info: 'bg-slate-400' };

  issues.forEach(({ title, severity, items }) => {
    const section = document.createElement('details');
    section.className = 'border border-slate-200 rounded-lg overflow-hidden';
    section.innerHTML = `
      <summary class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 select-none [list-style:none] [&::-webkit-details-marker]:hidden">
        <span class="w-2 h-2 rounded-full flex-shrink-0 ${dot[severity]}"></span>
        <span class="text-sm font-medium flex-1">${esc(title)}</span>
        <span class="text-xs px-2 py-0.5 rounded-full ${badge[severity]}">${items.length}</span>
      </summary>
      <div class="border-t border-slate-100 divide-y divide-slate-100 max-h-64 overflow-y-auto">
        ${items.map(({ href, detail }) => `
          <div class="flex items-baseline gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer issue-row" data-href="${esc(href)}">
            <span class="text-xs text-slate-700 break-all flex-1">${esc(href)}</span>
            ${detail ? `<span class="text-xs text-slate-400 shrink-0 max-w-[40%] truncate" title="${esc(detail)}">${esc(detail)}</span>` : ''}
          </div>`).join('')}
      </div>`;
    list.appendChild(section);
  });

  list.querySelectorAll('.issue-row').forEach(row => {
    row.addEventListener('click', () => {
      switchTab('crawl');
      showURLDetail(row.dataset.href);
    });
  });
}

document.getElementById('linksSearch').addEventListener('input', function () {
  if (!linksTable) return;
  const val = this.value.trim();
  if (val) {
    linksTable.setFilter([[{ field: 'source', type: 'like', value: val }, { field: 'target', type: 'like', value: val }]]);
  } else {
    linksTable.clearFilter();
  }
});

// ── Response header capture ────────────────────────────────────────────────

chrome.webRequest.onHeadersReceived.addListener(
  details => {
    if (!crawl.data.responseHeaders) crawl.data.responseHeaders = {};
    crawl.data.responseHeaders[details.requestId] = {
      requestURL: details.url,
      responseHeaders: details.responseHeaders,
      timestamp: details.timeStamp,
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      requestId: details.requestId,
    };
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest'] },
  ['responseHeaders'],
);

// ── Schedules ──────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('text-blue-600', active);
    btn.classList.toggle('border-blue-600', active);
    btn.classList.toggle('text-slate-500', !active);
    btn.classList.toggle('border-transparent', !active);
  });
  document.getElementById('panelCrawl').classList.toggle('hidden', tab !== 'crawl');
  document.getElementById('panelSchedules').classList.toggle('hidden', tab !== 'schedules');
  document.getElementById('panelStats').classList.toggle('hidden', tab !== 'stats');
  document.getElementById('panelIssues').classList.toggle('hidden', tab !== 'issues');
  if (tab === 'schedules') loadSchedules();
  if (tab === 'issues') buildIssues();
}

async function loadSchedules() {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  await renderSchedules(schedules);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function intervalLabel(minutes) {
  if (minutes === 60) return 'Hourly';
  if (minutes === 1440) return 'Daily';
  if (minutes === 10080) return 'Weekly';
  if (minutes < 1440) return `Every ${minutes / 60}h`;
  return `Every ${minutes / 1440}d`;
}

async function renderSchedules(schedules) {
  const list = document.getElementById('scheduleList');
  const entries = Object.values(schedules);
  if (entries.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">no schedules yet</p>';
    return;
  }

  // Fetch live next-run times from alarm API
  const nextRunMap = {};
  await Promise.all(entries.map(async s => {
    if (!s.enabled) { nextRunMap[s.id] = '—'; return; }
    try {
      const alarm = await chrome.alarms.get(`cron-${s.id}`);
      nextRunMap[s.id] = alarm ? new Date(alarm.scheduledTime).toLocaleString() : '—';
    } catch { nextRunMap[s.id] = '—'; }
  }));

  list.innerHTML = `
    <div class="border border-slate-200 rounded-lg overflow-hidden">
      <table class="w-full text-sm border-collapse">
        <thead class="bg-slate-50">
          <tr class="border-b border-slate-200">
            <th class="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wide">Property</th>
            <th class="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wide">Interval</th>
            <th class="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wide">Last run</th>
            <th class="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wide">Next run</th>
            <th class="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
            <th class="py-2.5 px-4"></th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(s => {
            const src = s.sources || {};
            const property = s.summary?.name
              || src.spiderUrl || src.sitemapUrl
              || (src.urlList ? (src.urlList.split('\n').find(l => l.trim()) || '') : '')
              || s.nameTemplate || '–';

            const freq = intervalLabel(s.intervalMinutes || 1440);
            const dayPart = s.intervalMinutes === 10080 ? ` on ${DAY_NAMES[s.dayOfWeek ?? 1]}` : '';
            const interval = `${freq}${dayPart} at ${s.timeStr || '00:00'}`;

            const lastRun = s.lastRun
              ? new Date(s.lastRun).toLocaleString()
              : '—';
            const lastStats = s.summary && !s.running
              ? ` <span class="text-slate-400">(${s.summary.ok}/${s.summary.total} ok)</span>`
              : '';

            const nextRun = nextRunMap[s.id] || '—';

            let statusBadge;
            if (s.running) {
              statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block"></span>running</span>`;
            } else if (s.enabled) {
              statusBadge = '<span class="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">active</span>';
            } else {
              statusBadge = '<span class="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">paused</span>';
            }

            return `<tr class="border-b border-slate-100 hover:bg-slate-50" data-id="${esc(s.id)}">
              <td class="py-3 px-4 text-slate-700 max-w-xs">
                <div class="truncate text-xs font-medium" title="${esc(property)}">${esc(property)}</div>
              </td>
              <td class="py-3 px-4 text-slate-600 whitespace-nowrap text-xs">${esc(interval)}</td>
              <td class="py-3 px-4 text-slate-500 whitespace-nowrap text-xs">${esc(lastRun)}${lastStats}</td>
              <td class="py-3 px-4 text-slate-500 whitespace-nowrap text-xs">${esc(nextRun)}</td>
              <td class="py-3 px-4" data-status-id="${esc(s.id)}">${statusBadge}</td>
              <td class="py-3 px-4">
                <div class="flex items-center gap-1.5 justify-end">
                  ${s.summary?.crawlKey ? `<button class="schedule-load text-xs px-2 py-1 border border-slate-200 rounded text-slate-600 hover:bg-slate-50" data-key="${esc(s.summary.crawlKey)}" title="Load last result">↓</button>` : ''}
                  <button class="schedule-run text-xs px-2 py-1 border border-slate-200 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    data-id="${esc(s.id)}" ${s.running ? 'disabled' : ''} title="Run now">⚡</button>
                  <button class="schedule-toggle text-xs px-2 py-1 border rounded ${s.enabled ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-green-200 text-green-600 hover:bg-green-50'}"
                    data-id="${esc(s.id)}" data-enabled="${s.enabled}">${s.enabled ? 'pause' : 'resume'}</button>
                  <button class="schedule-delete text-xs px-2 py-1 border border-slate-200 rounded text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50"
                    data-id="${esc(s.id)}" title="Delete">✕</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  list.querySelectorAll('.schedule-load').forEach(btn => {
    btn.addEventListener('click', function() {
      loadCrawl(this.dataset.key);
      switchTab('crawl');
    });
  });

  list.querySelectorAll('.schedule-run').forEach(btn => {
    btn.addEventListener('click', function() {
      this.disabled = true;
      this.innerHTML = '<span class="inline-block animate-spin leading-none">⟳</span>';
      chrome.runtime.sendMessage({ type: 'runCronJob', jobId: this.dataset.id }, () => {
        loadSchedules();
      });
    });
  });

  list.querySelectorAll('.schedule-toggle').forEach(btn => {
    btn.addEventListener('click', function() {
      const enabled = this.dataset.enabled === 'true';
      chrome.storage.local.get('schedules', ({ schedules = {} }) => {
        if (!schedules[this.dataset.id]) return;
        schedules[this.dataset.id].enabled = !enabled;
        chrome.runtime.sendMessage({ action: 'setSchedule', schedule: schedules[this.dataset.id] });
        loadSchedules();
      });
    });
  });

  list.querySelectorAll('.schedule-delete').forEach(btn => {
    btn.addEventListener('click', function() {
      chrome.runtime.sendMessage({ action: 'deleteSchedule', id: this.dataset.id }, loadSchedules);
    });
  });
}

document.getElementById('scheduleInterval').addEventListener('change', function() {
  document.getElementById('scheduleDayOfWeekWrap').style.display =
    this.value === '10080' ? '' : 'none';
});

document.getElementById('addScheduleBtn').addEventListener('click', () => {
  const nameTemplate = document.getElementById('scheduleNameTemplate').value.trim() || '{hostname} {datetime}';
  const spiderUrl = document.getElementById('scheduleSpiderUrl').value.trim();
  const urlList = document.getElementById('scheduleUrlList').value.trim();
  const sitemapUrl = document.getElementById('scheduleSitemapUrl').value.trim();
  const filterRegex = document.getElementById('scheduleFilterRegex').value.trim();
  const filterType = document.getElementById('scheduleFilterType').value;
  const intervalMinutes = parseInt(document.getElementById('scheduleInterval').value, 10);
  const timeStr = document.getElementById('scheduleTime').value || '00:00';
  const dayOfWeek = parseInt(document.getElementById('scheduleDayOfWeek').value, 10);
  const crawlMode = document.getElementById('scheduleCrawlMode').value;
  const maxPages = parseInt(document.getElementById('scheduleMaxPages').value, 10) || 500;

  if (!spiderUrl && !urlList && !sitemapUrl) return;

  const schedule = {
    id: `schedule-${Date.now()}`,
    nameTemplate,
    intervalMinutes,
    timeStr,
    dayOfWeek,
    enabled: true,
    createdAt: new Date().toISOString(),
    sources: { spiderUrl, urlList, sitemapUrl },
    filter: { regex: filterRegex, type: filterType },
    crawlMode,
    maxPages,
    lastRun: null,
    summary: null,
  };

  chrome.runtime.sendMessage({ action: 'setSchedule', schedule }, () => {
    document.getElementById('scheduleNameTemplate').value = '{hostname} {datetime}';
    document.getElementById('scheduleSpiderUrl').value = '';
    document.getElementById('scheduleUrlList').value = '';
    document.getElementById('scheduleSitemapUrl').value = '';
    document.getElementById('scheduleFilterRegex').value = '';
    document.getElementById('scheduleFilterType').value = '';
    document.getElementById('scheduleInterval').value = '1440';
    document.getElementById('scheduleTime').value = '03:00';
    document.getElementById('scheduleDayOfWeekWrap').style.display = 'none';
    document.getElementById('scheduleCrawlMode').value = 'list';
    document.getElementById('scheduleMaxPages').value = '500';
    loadSchedules();
  });
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.schedules && !document.getElementById('panelSchedules').classList.contains('hidden')) {
    renderSchedules(changes.schedules.newValue || {}); // async, fire-and-forget
  }
});

function esc(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Log ────────────────────────────────────────────────────────────────────

let logStats = { encountered: 0, crawled: 0, blocked: 0, internal: 0, external: 0, indexable: 0, nonIndexable: 0, statusCodes: {}, contentTypes: {} };

function resetLogStats() {
  logStats = { encountered: 0, crawled: 0, blocked: 0, internal: 0, external: 0, indexable: 0, nonIndexable: 0, statusCodes: {}, contentTypes: {} };
  renderLog();
}

function updateLogFromEntry({ url, status, ok, contentType, robots }) {
  logStats.crawled++;
  const ct = (contentType || '').replace(/;.*/, '').trim() || 'unknown';
  const sc = String(status || 0);
  logStats.statusCodes[sc] = (logStats.statusCodes[sc] || 0) + 1;
  logStats.contentTypes[ct] = (logStats.contentTypes[ct] || 0) + 1;
  try {
    const startHost = crawl.data.startURL?.hostname;
    if (!startHost || new URL(url).hostname === startHost) logStats.internal++;
    else logStats.external++;
  } catch {}
  const isHtml = ct.includes('text/html');
  const noindex = (robots || '').toLowerCase().includes('noindex');
  if (ok && isHtml && !noindex) logStats.indexable++;
  else logStats.nonIndexable++;
  renderLog();
}

function recomputeLogStats() {
  const results = Object.values(crawl.data.results || {});
  logStats = { encountered: results.length, crawled: 0, blocked: 0, internal: 0, external: 0, indexable: 0, nonIndexable: 0, statusCodes: {}, contentTypes: {} };
  const startHost = crawl.data.startURL?.hostname;
  for (const r of results) {
    const ct = (r.fetch?.contentType || '').replace(/;.*/, '').trim() || 'unknown';
    const sc = String(r.fetch?.status || 0);
    logStats.statusCodes[sc] = (logStats.statusCodes[sc] || 0) + 1;
    logStats.contentTypes[ct] = (logStats.contentTypes[ct] || 0) + 1;
    try {
      if (!startHost || new URL(r.href).hostname === startHost) logStats.internal++;
      else logStats.external++;
    } catch {}
    if (r.crawlable === false) logStats.blocked++;
    const isHtml = ct.includes('text/html');
    const noindex = (r.robots || '').toLowerCase().includes('noindex');
    if (r.fetch?.ok && isHtml && !noindex) logStats.indexable++;
    else logStats.nonIndexable++;
    logStats.crawled++;
  }
  renderLog();
}

function renderLog() {
  renderLogSummary();
  renderLogStatusCodes();
  renderLogContentTypes();
}

function renderLogSummary() {
  const rows = [
    ['Total URLs encountered', logStats.encountered, null],
    ['Total URLs crawled',     logStats.crawled,     null],
    ['Blocked by robots.txt',  logStats.blocked,     null],
    ['Internal URLs',          logStats.internal,    () => filterTableAndSwitch([{ field: 'isOutbound', type: '!=', value: true }])],
    ['External URLs',          logStats.external,    () => filterTableAndSwitch([{ field: 'isOutbound', type: '=', value: true }])],
    ['Indexable',              logStats.indexable,    () => filterTableAndSwitch([{ field: 'indexable', type: '=', value: true }])],
    ['Non-indexable',          logStats.nonIndexable, () => filterTableAndSwitch([{ field: 'indexable', type: '=', value: false }])],
  ];
  const tbody = document.getElementById('logSummaryBody');
  tbody.innerHTML = rows.map(([label, count, fn]) =>
    `<tr class="border-b border-slate-100${fn ? ' cursor-pointer hover:bg-blue-50' : ''}">
      <td class="px-3 py-2 text-slate-600">${label}</td>
      <td class="px-3 py-2 text-right font-mono font-medium text-slate-800">${count}</td>
    </tr>`
  ).join('');
  [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
    if (rows[i][2]) tr.addEventListener('click', rows[i][2]);
  });
}

function renderLogStatusCodes() {
  const sorted = Object.entries(logStats.statusCodes).sort((a, b) => b[1] - a[1]);
  const tbody = document.getElementById('logStatusBody');
  tbody.innerHTML = sorted.map(([sc, count]) => {
    const cls = sc.startsWith('2') ? 'text-green-600' : sc.startsWith('3') ? 'text-amber-600' : (sc.startsWith('4') || sc.startsWith('5')) ? 'text-red-500' : 'text-slate-500';
    return `<tr class="border-b border-slate-100 cursor-pointer hover:bg-blue-50" data-status="${sc}">
      <td class="px-3 py-2 font-mono font-medium ${cls}">${sc}</td>
      <td class="px-3 py-2 text-right font-mono text-slate-800">${count}</td>
    </tr>`;
  }).join('');
  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-status]');
    if (tr) filterTableAndSwitch([{ field: 'fetch_status', type: '=', value: parseInt(tr.dataset.status) }]);
  });
}

function renderLogContentTypes() {
  const sorted = Object.entries(logStats.contentTypes).sort((a, b) => b[1] - a[1]);
  const tbody = document.getElementById('logContentBody');
  tbody.innerHTML = sorted.map(([ct, count]) =>
    `<tr class="border-b border-slate-100 cursor-pointer hover:bg-blue-50" data-ct="${esc(ct)}">
      <td class="px-3 py-2 font-mono text-slate-700">${esc(ct)}</td>
      <td class="px-3 py-2 text-right font-mono text-slate-800">${count}</td>
    </tr>`
  ).join('');
  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-ct]');
    if (tr) filterTableAndSwitch([{ field: 'fetch_contentType', type: 'like', value: tr.dataset.ct }]);
  });
}

function filterTableAndSwitch(filters) {
  if (!table) return;
  table.setFilter(filters);
  switchTab('crawl');
}


// ── Background port ────────────────────────────────────────────────────────

let bgPort = null;

function connectBgPort() {
  bgPort = chrome.runtime.connect({ name: 'dragon-ui' });

  bgPort.onMessage.addListener(async msg => {
    if (msg.type === 'crawlProgress') {
      updateProgressFromSW(msg);
      logStats.encountered = msg.total || logStats.encountered;
      renderLogSummary();
    } else if (msg.type === 'urlFetched') {
      updateLogFromEntry(msg);
    } else if (msg.type === 'crawlComplete') {
      await loadAndRenderCrawl(msg.crawlKey);
      recomputeLogStats();
      await getCrawlList();
    } else if (msg.type === 'error') {
      showToast(msg.message || 'Background error', 'error');
    } else if (msg.type === 'scheduledCrawlProgress') {
      const cell = document.querySelector(`[data-status-id="${CSS.escape(msg.jobId)}"]`);
      if (cell) {
        const label = msg.total ? `${msg.done}/${msg.total}` : `${msg.done}`;
        cell.innerHTML = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block"></span>${label} pages</span>`;
      }
    } else if (msg.type === 'scheduledCrawlComplete') {
      await getCrawlList();
    }
  });

  bgPort.onDisconnect.addListener(() => {
    bgPort = null;
    if (document.getElementById('crawlControls') && !document.getElementById('crawlControls').classList.contains('hidden')) {
      setCrawlState('idle');
    }
  });

  bgPort.postMessage({ type: 'getActiveCrawl' });
  return bgPort;
}

function sendBgMessage(msg) {
  if (!bgPort) connectBgPort();
  try {
    bgPort.postMessage(msg);
  } catch {
    // Port died mid-send; reconnect and retry once
    bgPort = null;
    connectBgPort();
    try { bgPort.postMessage(msg); } catch (e) { console.error('bgPort send failed:', e); }
  }
}

function showToast(message, type = 'info') {
  const colors = type === 'error'
    ? 'bg-red-600 text-white'
    : 'bg-slate-700 text-white';
  const el = document.createElement('div');
  el.className = `fixed bottom-4 right-4 ${colors} text-sm px-4 py-2 rounded shadow-lg z-50 transition-opacity`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

function updateProgressFromSW({ crawled, total, status }) {
  const pct = total > 0 ? Math.round((crawled / total) * 100) : 0;
  document.getElementById('progressContainer').classList.remove('hidden');
  document.getElementById('progress').style.width = `${pct}%`;
  document.getElementById('progressLabel').textContent =
    status === 'paused'
      ? `${crawled} / ${total} pages — paused`
      : `${crawled} / ${total} pages (${pct}%)`;
  setCrawlState(status === 'paused' ? 'paused' : 'running');
  crawlPaused = status === 'paused';
}

async function loadAndRenderCrawl(crawlKey) {
  const blob = await crawlDB.get(crawlKey);
  if (!blob?.data) return;
  crawl = blob;
  if (crawl.data?.startURL) {
    try { crawl.data.startURL = new URL(crawl.data.startURL); } catch {}
  }
  document.getElementById('resultsArea').classList.remove('hidden');
  parseData();
  setCrawlState('idle');
  document.getElementById('progressContainer').classList.add('hidden');
}

// On load: connect port (getActiveCrawl is sent inside connectBgPort)
connectBgPort();

// ── Init ───────────────────────────────────────────────────────────────────

getCrawlList();
