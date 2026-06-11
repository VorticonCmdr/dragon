import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_simple.min.css';
import Papa from 'papaparse';
import { Readability } from '@mozilla/readability';

// ── State ──────────────────────────────────────────────────────────────────

let table = null;
let urlsTxt = '';

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
  },
  csv: { data: {} },
};

// ── DOM refs ───────────────────────────────────────────────────────────────

const urlListTextarea = document.getElementById('urlListTextarea');

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

// ── Spider (fetch links from a start URL) ──────────────────────────────────

document.getElementById('spiderBtn').addEventListener('click', async () => {
  try {
    crawl.data.startURL = new URL(document.getElementById('spiderURL').value.trim());
  } catch (e) {
    console.log(e.message);
    return;
  }
  if (!crawl.data.startURL.href) return;
  await initialize(crawl.data.startURL.href);
  urlListTextarea.value = crawl.data.queue.join('\n');
  setProgressbar();
});

// ── Crawl ──────────────────────────────────────────────────────────────────

document.getElementById('crawlBtn').addEventListener('click', () => {
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
  setProgressbar();
});

// ── Save / Load / Delete ───────────────────────────────────────────────────

document.getElementById('save').addEventListener('click', saveCrawl);

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
  reader.addEventListener('load', ev => {
    const xmlDoc = parseXMLSitemap(ev.target.result);
    appendSitemapLocations(xmlDoc);
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
  reader.addEventListener('load', ev => {
    const xmlDoc = parseXMLSitemap(ev.target.result);
    appendSitemapLocations(xmlDoc);
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

function getCrawlList() {
  chrome.storage.local.get('crawlList', data => {
    const loadList = document.getElementById('crawlLoadList');
    const deleteList = document.getElementById('crawlDeleteList');
    loadList.innerHTML = '';
    deleteList.innerHTML = '';
    if (!data.crawlList) return;
    Object.entries(data.crawlList).forEach(([key, value]) => {
      const label = value.name || key;
      loadList.insertAdjacentHTML(
        'beforeend',
        `<button class="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded" data-crawlid="${key}">${label}</button>`,
      );
      deleteList.insertAdjacentHTML(
        'beforeend',
        `<button class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded" data-crawlid="${key}">${label}</button>`,
      );
    });
  });
}

function loadCrawl(id) {
  chrome.storage.local.get(id, items => {
    const loaded = items[id];
    if (!loaded?.data) return;
    crawl = loaded;
    if (crawl.data?.queue?.length > 0) {
      urlListTextarea.value = crawl.data.queue.join('\n');
    }
    if (crawl.data?.startURL) {
      document.getElementById('spiderURL').value = crawl.data.startURL;
      crawl.data.startURL = new URL(crawl.data.startURL);
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
    }
    document.getElementById('loadModal').close();
  });
}

function buildCrawlName() {
  const dateStr = new Date(crawl.id).toLocaleString();
  let hostname = crawl?.data?.startURL?.hostname || '';
  if (!hostname) {
    try {
      hostname = new URL(urlListTextarea.value.split('\n')[0]).hostname;
    } catch (e) {
      console.log(e.message);
    }
  }
  crawl.name = `${dateStr} ${hostname}`;
}

function saveCrawl() {
  buildCrawlName();
  const id = `crawl-${crawl.id}`;
  const data = { [id]: { ...crawl, data: { ...crawl.data, startURL: crawl?.data?.startURL?.href } } };
  chrome.storage.local.set(data).then(() => console.log(`crawl "${id}" saved`));
  chrome.storage.local.get('crawlList', items => {
    const updated = { crawlList: { ...(items.crawlList || {}), [id]: { id: crawl.id, name: crawl.name } } };
    chrome.storage.local.set(updated).then(() => getCrawlList());
  });
}

function deleteCrawl(id) {
  chrome.storage.local.remove([id], () => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      return;
    }
    chrome.storage.local.get('crawlList', items => {
      const updated = { crawlList: { ...(items.crawlList || {}) } };
      delete updated.crawlList[id];
      chrome.storage.local.set(updated).then(() => {
        getCrawlList();
        document.getElementById('deleteModal').close();
      });
    });
  });
}

// ── Progress bar ───────────────────────────────────────────────────────────

function setProgressbar() {
  if (crawl.data.queueMaxLength < crawl.data.queue.length) {
    crawl.data.queueMaxLength = crawl.data.queue.length;
    performance.setResourceTimingBufferSize(
      crawl.data.queueMaxLength * (crawl.settings.maxRetries || 1),
    );
  }
  document.getElementById('progressContainer').classList.remove('hidden');
  const pct = Math.round((crawl.data.queue.length / crawl.data.queueMaxLength) * 100);
  const el = document.getElementById('progress');
  el.style.width = `${pct}%`;
  el.textContent = `${crawl.data.queue.length} urls`;
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

function absoluteLink(link) {
  if (!link) return '';
  let u;
  try {
    u = new URL(link);
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

  const response = await fetch(link, {
    credentials: crawl.settings.credentials,
    cache: 'no-cache',
  }).catch(e => console.error(`${e.message}: ${link}`));

  if (!crawl.data.results[link]) crawl.data.results[link] = {};
  crawl.data.results[link].fetch = {
    timestamp: new Date().toISOString(),
    redirected: response?.redirected,
    status: response?.status,
    statusText: response?.statusText,
    ok: response?.ok,
  };

  if (!response?.ok) {
    crawl.data.results[link].href = link;
    if ((crawl.data.alreadyFetched[link] ?? 0) < crawl.settings.maxRetries) {
      crawl.data.queue.push(link);
    }
    return;
  }

  const buf = await response.arrayBuffer();
  const html = new TextDecoder(crawl.settings.charset).decode(buf);
  if (!html) {
    console.error(`empty response: ${link}`);
    return;
  }

  const metadata = processPage(html, link);
  Object.assign(crawl.data.results[link], metadata);

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
    }
  }

  while (fetchURLQueue.length <= crawl.settings.maxConnections && crawl.data.queue.length > 0) {
    const link = crawl.data.queue.pop();
    if (!link) continue;
    fetchURLQueue.push(1);
    fetchURL(link).then(onDone).catch(onDone);
  }
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

  const xmlDoc = parseXMLSitemap(content);
  appendSitemapLocations(xmlDoc);
  document.getElementById('sitemapModal').close();
}

function appendSitemapLocations(xmlDoc) {
  [...xmlDoc.getElementsByTagName('loc')].forEach(loc => {
    urlListTextarea.value += `${loc.textContent}\n`;
  });
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
    { title: 'href',            field: 'href',                   visible: true,  sorter: 'string', minWidth: 200 },
    { title: 'canonical',       field: 'canonical',              visible: true,  sorter: 'string', minWidth: 150 },
    { title: 'title',           field: 'title',                  visible: false, sorter: 'string' },
    { title: 'description',     field: 'description',            visible: false, sorter: 'string' },
    { title: 'keyword',         field: 'keyword',                visible: false, sorter: 'string' },
    { title: 'robots',          field: 'robots',                 visible: false, sorter: 'string' },
    { title: 'h1',              field: 'h1',                     visible: true,  sorter: 'string' },
    { title: 'status',          field: 'fetch_status',           visible: true,  sorter: 'number', width: 80, hozAlign: 'right' },
    { title: 'redirected',      field: 'fetch_redirected',       visible: false, sorter: 'boolean' },
    { title: 'timestamp',       field: 'fetch_timestamp',        visible: false, sorter: 'string' },
    { title: 'ok',              field: 'fetch_ok',               visible: false, sorter: 'boolean', width: 70 },
    { title: 'og:image',        field: 'og_image',               visible: false, sorter: 'string' },
    { title: 'og:title',        field: 'og_title',               visible: false, sorter: 'string' },
    { title: 'og:site',         field: 'og_site_name',           visible: false, sorter: 'string' },
    { title: 'og:description',  field: 'og_description',         visible: true,  sorter: 'string' },
    { title: 'publisher',       field: 'schema_publisher',       visible: false, sorter: 'string' },
    { title: 'dateModified',    field: 'schema_dateModified',    visible: false, sorter: 'string' },
    { title: 'datePublished',   field: 'schema_datePublished',   visible: false, sorter: 'string' },
    { title: 'authors',         field: 'schema_authors',         visible: true,  sorter: 'string' },
    { title: 'headline',        field: 'schema_headline',        visible: false, sorter: 'string' },
    { title: 'altHeadline',     field: 'schema_alternateHeadline', visible: false, sorter: 'string' },
    { title: 'content',         field: 'content',                visible: false, sorter: 'string' },
    { title: 'clicks',          field: 'clicks',                 visible: false, sorter: 'number', hozAlign: 'right' },
    { title: 'impressions',     field: 'impressions',            visible: false, sorter: 'number', hozAlign: 'right' },
  ];

  const dataArray = JSON.parse(JSON.stringify(Object.values(crawl.data.results)));
  dataArray.forEach(dict => dict2flatarray(dict));

  if (table) {
    table.replaceData(dataArray);
    return;
  }

  table = new Tabulator('#jsonTable', {
    data: dataArray,
    layout: 'fitDataFill',
    pagination: true,
    paginationSize: 50,
    paginationSizeSelector: [25, 50, 100, true],
    movableColumns: true,
    columns,
  });
}

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
          <div class="text-xs text-slate-500">every ${s.interval} ${unitLabel[s.unit] ?? s.unit}</div>
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
    lastRun: null,
    lastResults: null,
    summary: null,
  };

  chrome.runtime.sendMessage({ action: 'setSchedule', schedule }, () => {
    document.getElementById('scheduleNameTemplate').value = '{hostname} {datetime}';
    document.getElementById('scheduleSpiderUrl').value = '';
    document.getElementById('scheduleUrlList').value = '';
    document.getElementById('scheduleSitemapUrl').value = '';
    document.getElementById('scheduleFilterRegex').value = '';
    document.getElementById('scheduleFilterType').value = '';
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

// ── Init ───────────────────────────────────────────────────────────────────

getCrawlList();
