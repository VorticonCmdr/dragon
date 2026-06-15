import '@fontsource-variable/plus-jakarta-sans';
import { zipSync } from 'fflate';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_simple.min.css';
import Papa from 'papaparse';
import { Readability } from '@mozilla/readability';
import { RobotsMatcher } from 'google-robotstxt-parser';

// ── State ──────────────────────────────────────────────────────────────────

let table = null;
let linksTable = null;
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
    results: {},
    responseHeaders: {},
  },
  settings: {
    stayonhostname: false,
    readability: false,
    charset: 'utf-8',
    maxRetries: 0,
    delay: 288,
    maxConnections: 20,
    credentials: 'omit',
    cache: 'no-store',
    crawlMode: 'list',
    maxPages: 500,
    filterRegex: '',
    filterType: '',
    respectRobots: true,
  },
  csv: { data: {} },
};

// ── DOM refs ───────────────────────────────────────────────────────────────

const urlListTextarea = document.getElementById('urlListTextarea');
const urlListCount = document.getElementById('urlListCount');

function updateUrlListCount() {
  const n = urlListTextarea.value.split('\n').filter(l => l.trim()).length;
  urlListCount.textContent = n > 0 ? `${n} URLs` : '';
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

document.getElementById('maxRetries').addEventListener('input', function () {
  crawl.settings.maxRetries = parseInt(this.value);
  document.getElementById('maxRetriesValue').textContent = this.value;
});

document.getElementById('maxConnections').addEventListener('input', function () {
  crawl.settings.maxConnections = parseInt(this.value);
  document.getElementById('maxConnectionsValue').textContent = this.value;
});

document.getElementById('delay').addEventListener('input', function () {
  crawl.settings.delay = parseInt(this.value);
  document.getElementById('delayValue').textContent = this.value;
});

document.getElementById('credentials').addEventListener('change', function () {
  crawl.settings.credentials = this.value;
});

document.getElementById('cache').addEventListener('change', function () {
  crawl.settings.cache = this.value;
});

document.getElementById('charset').addEventListener('input', function () {
  crawl.settings.charset = this.value;
});

document.getElementById('readability').addEventListener('change', function () {
  crawl.settings.readability = this.checked;
});

document.getElementById('stayonhostname').addEventListener('change', function () {
  crawl.settings.stayonhostname = this.checked;
});

document.getElementById('crawlMode').addEventListener('change', function () {
  crawl.settings.crawlMode = this.value;
  if (this.value === 'recursive') {
    crawl.settings.stayonhostname = true;
    document.getElementById('stayonhostname').checked = true;
  }
  updateUIForCrawlMode();
});

document.getElementById('maxPages').addEventListener('input', function () {
  crawl.settings.maxPages = parseInt(this.value, 10) || 500;
});

document.getElementById('filterRegex').addEventListener('input', function () {
  crawl.settings.filterRegex = this.value.trim();
});

document.getElementById('filterType').addEventListener('change', function () {
  crawl.settings.filterType = this.value;
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
  // Reset crawl state
  crawl.data.alreadyFetched = {};
  crawl.data.results = {};
  crawl.data.responseHeaders = {};
  robotsCache.clear();
  const { userAgent = '' } = await chrome.storage.local.get('userAgent');
  currentBotName = extractBotName(userAgent);
  if (table) table.replaceData([]);

  if (crawl.settings.crawlMode === 'recursive') {
    const startVal = document.getElementById('spiderURL').value.trim();
    try {
      crawl.data.startURL = new URL(startVal);
    } catch (e) {
      console.log(e.message);
      alert('Please enter a valid Start URL');
      return;
    }
    crawl.data.queue = [crawl.data.startURL.href];
  } else {
    const lines = urlListTextarea.value.split('\n');
    if (!crawl.data.startURL?.href) {
      try {
        crawl.data.startURL = new URL(lines[0]);
      } catch (e) {
        console.log(e.message);
        return;
      }
    }
    crawl.data.queue = [];
    lines.forEach(item => {
      if (!item) return;
      const href = absoluteLink(item);
      if (href) crawl.data.queue.push(href);
    });
  }

  startOpfsWorkerIfNeeded();
  performance.mark('crawl-started');
  processQueue();
});

// ── Regex filter ───────────────────────────────────────────────────────────

document.getElementById('predefinedRegex').addEventListener('click', e => {
  const btn = e.target.closest('[data-regex]');
  if (!btn) return;
  document.getElementById('regexFilter').value = btn.dataset.regex;
});

document.getElementById('regexFilterBtn').addEventListener('click', e => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  const str = document.getElementById('regexFilter').value.trim();
  const re = new RegExp(str, 'i');
  let queue = urlListTextarea.value.split('\n');
  if (btn.dataset.type === 'include') {
    queue = queue.filter(u => re.test(u));
  } else if (btn.dataset.type === 'exclude') {
    queue = queue.filter(u => !re.test(u));
  }
  crawl.data.queue = queue;
  crawl.data.queueMaxLength = 1;
  urlListTextarea.value = queue.join('\n');
  updateUrlListCount();
  setProgressbar();
});

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
    table.clearFilter();
  }
});

document.getElementById('exportCSVBtn').addEventListener('click', () => {
  if (table) table.download('csv', 'crawl.csv');
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
      alert('Keine OPFS-Dateien für diesen Crawl gefunden.');
      return;
    }
    const zipped = zipSync(files);
    const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${crawlDirName}.zip` });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('ZIP export failed:', e);
    alert(`ZIP export fehlgeschlagen: ${e.message}`);
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
  if (crawl.data?.results) parseData();
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
  el.style.width = `${pct}%`;
  el.textContent = `${crawledCount} / ${total} pages (${pct}%)`;
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

function extractInternalLinks(doc, currentUrl, metaRobots = '', xRobotsTag = '') {
  const metaFollow   = parseFollowDirective(metaRobots);
  const headerFollow = parseFollowDirective(xRobotsTag);
  const pageFollow   = metaFollow ?? headerFollow;
  const pageSource   = metaFollow ? 'meta' : (headerFollow ? 'header' : null);

  const seen = new Map();
  const startHost = crawl.data.startURL?.hostname;

  [...doc.links].forEach(link => {
    const rawHref = link.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    let resolved;
    try { resolved = new URL(rawHref, currentUrl); } catch { return; }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    resolved.hash = '';
    if (resolved.hostname !== startHost) return;
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

  const metadata = {
    title: doc.title || '',
    description: doc.querySelector('meta[name="description"]')?.content || '',
    href,
    og: {
      image: doc.querySelector('meta[property="og:image"]')?.attributes?.content?.textContent || '',
      title: doc.querySelector('meta[property="og:title"]')?.content || '',
      site_name: doc.querySelector('meta[property="og:site_name"]')?.content || '',
      description: doc.querySelector('meta[property="og:description"]')?.content || '',
    },
    robots: doc.querySelector('meta[name="robots"]')?.content || '',
    canonical: doc.querySelector('link[rel="canonical"]')?.attributes?.href?.textContent,
    h1: doc.querySelector('h1')?.innerText || '',
    schema: getArticleSchema(doc, href),
  };

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

function getArticleSchema(doc, href) {
  const schema = {
    publisher: '',
    dateModified: '',
    datePublished: '',
    authors: '',
    headline: '',
    alternateHeadline: '',
  };

  try {
    [...doc.querySelectorAll('script[type="application/ld+json"]')].forEach(el => {
      if (!el.textContent) return;
      const obj = JSON.parse(el.textContent);

      const publisher = getValues(obj, 'publisher')[0];
      if (publisher?.['@type'] === 'Organization') schema.publisher = publisher.name;

      const headline = getValues(obj, 'headline')[0];
      if (headline) schema.headline = headline;

      const altHeadline = getValues(obj, 'alternateHeadline')[0];
      if (altHeadline) schema.alternateHeadline = altHeadline;

      const dateModified = getValues(obj, 'dateModified')[0];
      if (dateModified) schema.dateModified = dateModified;

      const datePublished = getValues(obj, 'datePublished')[0];
      if (datePublished) schema.datePublished = datePublished;

      const authors = getValues(obj, 'author')[0];
      if (Array.isArray(authors)) {
        schema.authors = authors.map(a => a?.name).join(', ');
      } else if (authors?.name) {
        schema.authors = authors.name;
      }
      if (!schema.authors) {
        schema.authors = extractAuthors(obj).join(', ');
      }
    });
  } catch (e) {
    console.error(`${e.message}: ${href}`);
  }

  return schema;
}

function extractAuthors(data) {
  const authors = [];
  if (Array.isArray(data['@graph'])) {
    data['@graph'].forEach(item => {
      if (item['@type'] === 'Person' && item.name) authors.push(item.name);
    });
  }
  return authors;
}

// ── Robots.txt ────────────────────────────────────────────────────────────

const robotsCache = new Map();
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
  const promise = fetch(`${origin}/robots.txt`, { cache: 'no-cache', credentials: 'omit' })
    .then(r => r.ok ? r.text() : '')
    .catch(() => '');
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

  try { new URL(link); } catch (e) {
    console.error(`invalid URL: ${link}`);
    return;
  }

  const crawlable = await checkRobotsAllowed(link);

  if (!crawlable && crawl.settings.respectRobots) {
    crawl.data.results[link] = {
      href: link,
      crawlable,
      fetch: { status: null, ok: false, timestamp: new Date().toISOString() },
    };
    return;
  }

  const response = await fetch(link, {
    credentials: crawl.settings.credentials,
    cache: 'no-cache',
  }).catch(e => console.error(`${e.message}: ${link}`));

  if (!crawl.data.results[link]) crawl.data.results[link] = {};
  crawl.data.results[link].crawlable = crawlable;
  crawl.data.results[link].fetch = {
    timestamp: new Date().toISOString(),
    redirected: response?.redirected,
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

  const perfEntries = performance.getEntriesByName(link, 'resource');
  const perf = perfEntries.length > 0 ? perfEntries[perfEntries.length - 1] : null;
  if (perf) {
    Object.assign(crawl.data.results[link].fetch, {
      duration: Math.round(perf.duration),
      decodedBodySize: perf.decodedBodySize,
      encodedBodySize: perf.encodedBodySize,
      deliveryType: perf.deliveryType ?? '',
    });
  }

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

  const metadata = processPage(html, link);
  Object.assign(crawl.data.results[link], metadata);

  if (crawl.settings.crawlMode === 'recursive') {
    const totalCrawled = Object.keys(crawl.data.results).length;
    if (totalCrawled < crawl.settings.maxPages) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const xRobotsTag = response?.headers.get('x-robots-tag') || '';
      crawl.data.results[link].links = extractInternalLinks(doc, link, crawl.data.results[link].robots || '', xRobotsTag);
      const newLinks = extractNewLinks(doc, link);
      newLinks.forEach(newLink => {
        crawl.data.queue.push(newLink);
      });
      urlListTextarea.value = crawl.data.queue.join('\n');
      updateUrlListCount();
      setProgressbar();
    }
  }

  return sleep(crawl.settings.delay);
}

async function processQueue() {
  if (!crawl.data.queue) return;
  setProgressbar();

  function onDone() {
    fetchURLQueue.pop();
    processQueue();
    if (crawl.data.queue.length === 0 && fetchURLQueue.length === 0) {
      performance.mark('crawl-ended');
      parseData();
      opfsWorker?.terminate();
      opfsWorker = null;
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

function getValues(obj, key) {
  let found = [];
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    if (k === key) found.push(obj[k]);
    else if (typeof obj[k] === 'object') found = found.concat(getValues(obj[k], key));
  }
  return found;
}

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
    statusEl.textContent = `0 / ${total} Sitemaps geladen…`;
    statusEl.classList.remove('hidden');

    const settled = await Promise.allSettled(
      childUrls.map(url =>
        fetch(url, { credentials: crawl.settings.credentials, cache: 'no-cache' })
          .then(r => url.includes('.gz')
            ? r.blob().then(b => b.arrayBuffer()).then(buf => decompress(buf, 'gzip'))
            : r.text())
          .then(content => {
            statusEl.textContent = `${++done} / ${total} Sitemaps geladen…`;
            return [...parseXMLSitemap(content).getElementsByTagName('loc')]
              .map(loc => loc.textContent.trim())
              .filter(Boolean);
          })
          .catch(e => { console.error(e); return []; })
      )
    );

    const allUrls = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (allUrls.length) { urlListTextarea.value += allUrls.join('\n') + '\n'; updateUrlListCount(); }
    statusEl.textContent = `${allUrls.length} URLs aus ${total} Sitemaps übernommen`;
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
  const columns = [
    {
      title: 'url', field: 'href', visible: true, sorter: 'string', minWidth: 380, widthGrow: 1,
      tooltip: true,
      formatter: urlFormatter,
    },
    { title: 'status',          field: 'fetch_status',           visible: true,  sorter: 'number', width: 80, hozAlign: 'right' },
    { title: 'duration (ms)',   field: 'fetch_duration',         visible: true,  sorter: 'number', hozAlign: 'right' },
    { title: 'redirected',      field: 'fetch_redirected',       visible: true,  sorter: 'boolean' },
    { title: 'encoded size',    field: 'fetch_encodedBodySize',  visible: true,  sorter: 'number', hozAlign: 'right' },
    { title: 'canonical',       field: 'canonical',              visible: false, sorter: 'string', minWidth: 150 },
    { title: 'title',           field: 'title',                  visible: false, sorter: 'string' },
    { title: 'description',     field: 'description',            visible: false, sorter: 'string' },
    { title: 'keyword',         field: 'keyword',                visible: false, sorter: 'string' },
    { title: 'robots',          field: 'robots',                 visible: false, sorter: 'string' },
    { title: 'h1',              field: 'h1',                     visible: false, sorter: 'string' },
    { title: 'content-type',    field: 'fetch_contentType',      visible: false, sorter: 'string' },
    { title: 'decoded size',    field: 'fetch_decodedBodySize',  visible: false, sorter: 'number', hozAlign: 'right' },
    { title: 'deliveryType',    field: 'fetch_deliveryType',     visible: false, sorter: 'string' },
    { title: 'timestamp',       field: 'fetch_timestamp',        visible: false, sorter: 'string' },
    { title: 'ok',              field: 'fetch_ok',               visible: false, sorter: 'boolean', width: 70 },
    { title: 'og:image',        field: 'og_image',               visible: false, sorter: 'string' },
    { title: 'og:title',        field: 'og_title',               visible: false, sorter: 'string' },
    { title: 'og:site',         field: 'og_site_name',           visible: false, sorter: 'string' },
    { title: 'og:description',  field: 'og_description',         visible: false, sorter: 'string' },
    { title: 'publisher',       field: 'schema_publisher',       visible: false, sorter: 'string' },
    { title: 'dateModified',    field: 'schema_dateModified',    visible: false, sorter: 'string' },
    { title: 'datePublished',   field: 'schema_datePublished',   visible: false, sorter: 'string' },
    { title: 'authors',         field: 'schema_authors',         visible: false, sorter: 'string' },
    { title: 'headline',        field: 'schema_headline',        visible: false, sorter: 'string' },
    { title: 'altHeadline',     field: 'schema_alternateHeadline', visible: false, sorter: 'string' },
    { title: 'content',         field: 'content',                visible: false, sorter: 'string' },
    { title: 'crawlable',      field: 'crawlable',              visible: true,  sorter: 'boolean', width: 90 },
    { title: 'outbound links', field: 'outbound_count',         visible: false, sorter: 'number',  hozAlign: 'right', width: 110 },
    { title: 'inbound links',  field: 'inbound_count',          visible: false, sorter: 'number',  hozAlign: 'right', width: 100 },
    { title: 'clicks',          field: 'clicks',                 visible: false, sorter: 'number', hozAlign: 'right' },
    { title: 'impressions',     field: 'impressions',            visible: false, sorter: 'number', hozAlign: 'right' },
    {
      title: 'html',
      field: 'opfs_path',
      visible: document.getElementById('opfsEnabled').checked,
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
  Object.values(crawl.data.results).forEach(r => {
    (r.links || []).forEach(t => { inboundCount[t.url] = (inboundCount[t.url] || 0) + 1; });
  });

  const dataArray = JSON.parse(JSON.stringify(Object.values(crawl.data.results)));
  dataArray.forEach(r => {
    r.outbound_count = r.links?.length ?? null;
    r.inbound_count  = inboundCount[r.href] ?? null;
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
    columns,
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
  document.getElementById('panelLog').classList.toggle('hidden', tab !== 'log');
  if (tab === 'schedules') loadSchedules();
}

function loadSchedules() {
  chrome.storage.local.get('schedules', ({ schedules = {} }) => renderSchedules(schedules));
}

function renderSchedules(schedules) {
  const list = document.getElementById('scheduleList');
  const entries = Object.values(schedules);
  if (entries.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">no schedules yet</p>';
    return;
  }
  const unitLabel = { minutes: 'min', hours: 'h', days: 'd' };
  list.innerHTML = entries.map(s => {
    const displayName = esc(s.summary?.name || s.nameTemplate || '–');

    const src = s.sources || {};
    const sourceParts = [];
    if (src.spiderUrl) sourceParts.push(`spider: ${esc(src.spiderUrl)}`);
    if (src.urlList) {
      const n = src.urlList.split('\n').map(l => l.trim()).filter(Boolean).length;
      sourceParts.push(`${n} URL${n !== 1 ? 's' : ''}`);
    }
    if (src.sitemapUrl) sourceParts.push(`sitemap: ${esc(src.sitemapUrl)}`);
    const sourceSummary = sourceParts.join(' · ') || esc(s.url || '–');

    const flt = s.filter;
    const filterLabel = flt?.regex && flt?.type
      ? ` · ${flt.type}: <code class="font-mono">${esc(flt.regex)}</code>`
      : '';

    let lastLabel;
    if (s.running) {
      lastLabel = '<span class="text-blue-500 font-medium animate-pulse">crawling…</span>';
    } else if (s.summary) {
      const t = new Date(s.summary.timestamp).toLocaleString();
      lastLabel = `<span class="text-green-600 font-medium">${s.summary.ok} ok</span>` +
        (s.summary.errors ? ` · <span class="text-red-500 font-medium">${s.summary.errors} err</span>` : '') +
        ` / ${s.summary.total} · ${t}`;
    } else {
      lastLabel = 'not yet run';
    }

    return `<div class="border border-slate-200 rounded-lg p-4 space-y-2">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-slate-700 truncate">${displayName}</span>
            ${s.running ? '<span class="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0"></span>' : ''}
          </div>
          <div class="text-xs text-slate-400 truncate">${sourceSummary}${filterLabel}</div>
          <div class="text-xs text-slate-500">Mode: ${esc(s.crawlMode || 'list')}${s.crawlMode === 'recursive' ? ` (max ${s.maxPages || 500} p.)` : ''} · every ${s.interval} ${unitLabel[s.unit] ?? s.unit}</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${s.summary?.crawlKey ? `<button class="schedule-load px-2 py-1 text-xs border border-blue-300 rounded hover:bg-blue-50 text-blue-600" data-key="${s.summary.crawlKey}">load</button>` : ''}
          <button class="schedule-run px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
            data-id="${s.id}" ${s.running ? 'disabled' : ''}>run now</button>
          <label class="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" class="schedule-toggle rounded border-slate-300"
              data-id="${s.id}" ${s.enabled ? 'checked' : ''} />
            <span class="text-xs text-slate-500">on</span>
          </label>
          <button class="schedule-delete text-slate-300 hover:text-red-500 text-lg leading-none"
            data-id="${s.id}">&times;</button>
        </div>
      </div>
      <div class="text-xs text-slate-400 border-t border-slate-100 pt-2">${lastLabel}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.schedule-load').forEach(btn => {
    btn.addEventListener('click', function () {
      loadCrawl(this.dataset.key);
      switchTab('crawl');
    });
  });
  list.querySelectorAll('.schedule-run').forEach(btn => {
    btn.addEventListener('click', function () {
      const label = this.textContent;
      this.textContent = '…';
      this.disabled = true;
      chrome.runtime.sendMessage({ action: 'runNow', id: this.dataset.id }, () => {
        this.textContent = label;
        this.disabled = false;
      });
    });
  });
  list.querySelectorAll('.schedule-toggle').forEach(cb => {
    cb.addEventListener('change', function () {
      chrome.storage.local.get('schedules', ({ schedules = {} }) => {
        if (!schedules[this.dataset.id]) return;
        schedules[this.dataset.id].enabled = this.checked;
        chrome.runtime.sendMessage({ action: 'setSchedule', schedule: schedules[this.dataset.id] });
      });
    });
  });
  list.querySelectorAll('.schedule-delete').forEach(btn => {
    btn.addEventListener('click', function () {
      chrome.runtime.sendMessage({ action: 'deleteSchedule', id: this.dataset.id }, loadSchedules);
    });
  });
}

document.getElementById('addScheduleBtn').addEventListener('click', () => {
  const nameTemplate = document.getElementById('scheduleNameTemplate').value.trim() || '{hostname} {datetime}';
  const spiderUrl = document.getElementById('scheduleSpiderUrl').value.trim();
  const urlList = document.getElementById('scheduleUrlList').value.trim();
  const sitemapUrl = document.getElementById('scheduleSitemapUrl').value.trim();
  const filterRegex = document.getElementById('scheduleFilterRegex').value.trim();
  const filterType = document.getElementById('scheduleFilterType').value;
  const interval = parseInt(document.getElementById('scheduleInterval').value, 10);
  const unit = document.getElementById('scheduleUnit').value;
  const crawlMode = document.getElementById('scheduleCrawlMode').value;
  const maxPages = parseInt(document.getElementById('scheduleMaxPages').value, 10) || 500;

  if (!interval || interval < 1) return;
  if (!spiderUrl && !urlList && !sitemapUrl) return;

  const intervalMinutes = unit === 'minutes' ? Math.max(1, interval)
    : unit === 'hours' ? interval * 60
    : interval * 1440;

  const schedule = {
    id: `schedule-${Date.now()}`,
    nameTemplate,
    interval,
    unit,
    intervalMinutes,
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
    document.getElementById('scheduleCrawlMode').value = 'list';
    document.getElementById('scheduleMaxPages').value = '500';
    loadSchedules();
  });
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.schedules && !document.getElementById('panelSchedules').classList.contains('hidden')) {
    renderSchedules(changes.schedules.newValue || {});
  }
});

function esc(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Log ────────────────────────────────────────────────────────────────────

const logBody = document.getElementById('logBody');
const logContainer = document.getElementById('logContainer');

document.getElementById('clearLogBtn').addEventListener('click', () => {
  logBody.innerHTML = '';
});

function fmtBytes(b) {
  if (!b) return '–';
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024) return `${(b / 1_024).toFixed(1)} KB`;
  return `${b} B`;
}

function appendLogEntry(entry) {
  const url = entry.name;
  const result = crawl.data.results?.[url]?.fetch;
  const status = result?.status ?? '–';
  const ok = result?.ok;
  const contentType = (result?.contentType || '').replace(/;.*/, '').trim() || '–';
  const duration = Math.round(entry.duration);
  const size = fmtBytes(entry.encodedBodySize);
  const delivery = entry.deliveryType || (entry.transferSize === 0 && entry.encodedBodySize > 0 ? 'cache' : 'network');
  const time = new Date(performance.timeOrigin + entry.startTime).toLocaleTimeString();

  const statusClass = ok === false ? 'text-red-500' : ok === true ? 'text-green-600' : 'text-slate-400';

  const tr = document.createElement('tr');
  tr.className = 'border-b border-slate-100 hover:bg-slate-50';
  tr.innerHTML =
    `<td class="px-3 py-1.5 text-slate-400 whitespace-nowrap">${time}</td>` +
    `<td class="px-3 py-1.5 font-medium text-right whitespace-nowrap ${statusClass}">${status}</td>` +
    `<td class="px-3 py-1.5 text-right whitespace-nowrap text-slate-600">${duration}</td>` +
    `<td class="px-3 py-1.5 text-right whitespace-nowrap text-slate-600">${size}</td>` +
    `<td class="px-3 py-1.5 text-slate-500 whitespace-nowrap">${esc(contentType)}</td>` +
    `<td class="px-3 py-1.5 text-slate-400 whitespace-nowrap">${esc(delivery)}</td>` +
    `<td class="px-3 py-1.5 text-slate-700 break-all">${esc(url)}</td>`;
  logBody.appendChild(tr);

  const panel = document.getElementById('panelLog');
  if (!panel.classList.contains('hidden')) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.initiatorType === 'fetch') appendLogEntry(entry);
  }
}).observe({ type: 'resource', buffered: true });

// ── Init ───────────────────────────────────────────────────────────────────

getCrawlList();
