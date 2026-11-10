// Setup rail: choose what to crawl and how, validate, start.

import Papa from 'papaparse';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/defaults.js';
import { fetchSitemapUrls, parseSitemapXml, sitemapBytesToText } from '../shared/sitemap.js';
import { normalizeUrl, parseUrlList, resolveNameTemplate } from '../shared/url.js';
import { toast } from './components.js';
import { $, $$, debounce, el, formatNumber, icon } from './dom.js';
import { request, send } from './port.js';
import { emit, on, state } from './store.js';

const SAVE_DELAY_MS = 300;
const BUILT_IN_PRESETS = [
  { name: 'UUID', regex: '[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$' },
  { name: 'Ends with /', regex: '/$' },
  { name: 'Ends with .html', regex: '\\.html$' },
];

const SLIDERS = {
  maxConnections: value => String(value),
  delay: value => (Number(value) ? `${value} ms` : 'none'),
  maxRetries: value => String(value),
};
const CHECKBOXES = ['stayonhostname', 'respectRobots', 'fetchOutbound'];
const TEXT_FIELDS = ['credentials', 'cache', 'charset'];

let csvData = null;


const currentSource = () => $('input[name="source"]:checked')?.value ?? 'website';
const currentFilterType = () => $('input[name="filterType"]:checked')?.value ?? '';

// ── Settings ────────────────────────────────────────────────────────────────

function collectSettings() {
  const settings = {
    ...state.settings,
    crawlMode: currentSource() === 'website' ? 'recursive' : 'list',
    maxPages: Number.parseInt($('#maxPages').value, 10) || DEFAULT_SETTINGS.maxPages,
    filterRegex: $('#filterRegex').value.trim(),
    filterType: currentFilterType(),
  };
  for (const id of Object.keys(SLIDERS)) settings[id] = Number($(`#${id}`).value);
  for (const id of CHECKBOXES) settings[id] = $(`#${id}`).checked;
  for (const id of TEXT_FIELDS) settings[id] = $(`#${id}`).value.trim();
  return settings;
}

const saveSettings = debounce(() => {
  state.settings = collectSettings();
  chrome.storage.local.set({ crawlSettings: state.settings });
}, SAVE_DELAY_MS);

const saveArchiveSettings = debounce(() => {
  chrome.storage.local.set({
    opfsSettings: {
      enabled: $('#opfsEnabled').checked,
      rootDir: $('#opfsRootDir').value.trim() || DEFAULT_SETTINGS.opfsRootDir,
    },
  });
}, SAVE_DELAY_MS);

function applySettings(settings, opfs) {
  $('#maxPages').value = settings.maxPages;
  for (const [id, format] of Object.entries(SLIDERS)) {
    $(`#${id}`).value = settings[id];
    $(`#${id}Value`).textContent = format(settings[id]);
  }
  for (const id of CHECKBOXES) $(`#${id}`).checked = settings[id];
  for (const id of TEXT_FIELDS) $(`#${id}`).value = settings[id];
  $('#filterRegex').value = settings.filterRegex;
  $(`input[name="filterType"][value="${settings.filterType}"]`).checked = true;
  $('#opfsEnabled').checked = !!opfs.enabled;
  $('#opfsRootDir').value = opfs.rootDir ?? DEFAULT_SETTINGS.opfsRootDir;
  $('#opfsDirField').hidden = !opfs.enabled;
}

// ── Validation ──────────────────────────────────────────────────────────────

function setError(id, message) {
  const node = $(`#${id}Error`);
  const input = $(`#${id}`);
  node.textContent = message ?? '';
  node.hidden = !message;
  input.toggleAttribute('aria-invalid', !!message);
}

function compileFilter() {
  const regex = $('#filterRegex').value.trim();
  const type = currentFilterType();
  if (!regex || !type) return { test: null, error: null };
  try {
    const re = new RegExp(regex, 'i');
    return { test: url => re.test(url) === (type === 'include'), error: null };
  } catch (e) {
    return { test: null, error: e.message.replace(/^Invalid regular expression: /, '') };
  }
}

function withScheme(value) {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function updateFilterUi() {
  const type = currentFilterType();
  $('#filterFields').hidden = !type;
  const { test, error } = compileFilter();
  $('#filterError').textContent = error ?? '';
  $('#filterError').hidden = !error;
  $('#filterRegex').toggleAttribute('aria-invalid', !!error);

  const match = $('#filterMatch');
  if (test && currentSource() !== 'website') {
    const urls = parseUrlList($('#urlList').value);
    match.textContent = `${formatNumber(urls.filter(test).length)} of ${formatNumber(urls.length)} URLs will be crawled`;
  } else {
    match.textContent = '';
  }
}

const updateUrlCount = debounce(() => {
  const value = $('#urlList').value;
  const urls = parseUrlList(value);
  const lines = value.split('\n').filter(line => line.trim()).length;
  const ignored = lines - urls.length;
  $('#urlCount').textContent = lines
    ? `${formatNumber(urls.length)} URLs${ignored ? `, ${formatNumber(ignored)} duplicate or invalid` : ''}`
    : '';
  updateFilterUi();
  syncCrawlButton();
}, 150);

function validate() {
  setError('startUrl', null);
  setError('urlList', null);

  if (currentSource() === 'website') {
    const url = normalizeUrl(withScheme($('#startUrl').value));
    if (!url) {
      setError('startUrl', 'Enter a full URL, such as https://example.com');
      $('#startUrl').focus();
      return null;
    }
    return { seeds: [url] };
  }

  const { test, error } = compileFilter();
  if (error) {
    $('#filterRegex').focus();
    return null;
  }
  const urls = parseUrlList($('#urlList').value);
  const seeds = test ? urls.filter(test) : urls;
  if (!seeds.length) {
    showSource('list');
    setError('urlList', urls.length ? 'The URL filter excludes every URL.' : 'Add at least one URL.');
    $('#urlList').focus();
    return null;
  }
  return { seeds };
}

// ── Sources ─────────────────────────────────────────────────────────────────

function showSource(source) {
  $(`input[name="source"][value="${source}"]`).checked = true;
  $$('.source-panel').forEach(panel => { panel.hidden = panel.dataset.source !== source; });
  updateFilterUi();
  syncCrawlButton();
}

// Merged by line, so an import can never glue itself onto a last line without
// a newline, and importing the same source twice adds nothing.
function appendUrls(urls) {
  const merged = parseUrlList([...$('#urlList').value.split('\n'), ...urls]);
  $('#urlList').value = merged.join('\n');
  updateUrlCount();
  return merged.length;
}

function setStatus(id, message) {
  $(`#${id}`).textContent = message;
}

async function loadSitemapFromUrl() {
  const url = normalizeUrl(withScheme($('#sitemapUrl').value));
  if (!url) { setStatus('sitemapStatus', 'Enter a valid sitemap URL.'); return; }
  const button = $('#sitemapBtn');
  button.disabled = true;
  setStatus('sitemapStatus', 'Loading sitemap…');
  try {
    const { urls, sitemaps, errors } = await fetchSitemapUrls(url, {
      credentials: collectSettings().credentials,
      onProgress: progress => setStatus('sitemapStatus', `${formatNumber(progress.urls)} URLs from ${progress.sitemaps} sitemaps…`),
    });
    finishSitemapImport(urls, sitemaps, errors);
  } finally {
    button.disabled = false;
  }
}

function finishSitemapImport(urls, sitemaps, errors = []) {
  if (!urls.length) {
    setStatus('sitemapStatus', errors[0] ? `Could not load it: ${errors[0].message}` : 'No URLs found in this sitemap.');
    return;
  }
  const total = appendUrls(urls);
  const failed = errors.length ? ` ${errors.length} sitemaps failed.` : '';
  toast(`${formatNumber(urls.length)} URLs imported from ${sitemaps} sitemap${sitemaps === 1 ? '' : 's'}.${failed}`, errors.length ? 'info' : 'success');
  setStatus('sitemapStatus', '');
  showSource('list');
  return total;
}

async function loadSitemapFile(file) {
  setStatus('sitemapStatus', 'Reading file…');
  try {
    const parsed = parseSitemapXml(await sitemapBytesToText(await file.arrayBuffer()));
    if (parsed.kind !== 'index') {
      finishSitemapImport(parsed.urls, 1);
      return;
    }
    let all = [];
    const errors = [];
    for (const child of parsed.urls) {
      const result = await fetchSitemapUrls(child);
      all = all.concat(result.urls);
      errors.push(...result.errors);
      setStatus('sitemapStatus', `${formatNumber(all.length)} URLs…`);
    }
    finishSitemapImport(all, parsed.urls.length, errors);
  } catch (e) {
    setStatus('sitemapStatus', `Could not read this file: ${e.message}`);
  }
}

const CSV_URL_HEADERS = ['url', 'address', 'page', 'top pages', 'landing page'];

async function loadCsvFile(file) {
  setStatus('csvStatus', 'Reading file…');
  const text = await file.text();
  const { data, meta } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: header => header.trim().toLowerCase(),
  });
  const urlHeader = CSV_URL_HEADERS.find(header => meta.fields?.includes(header));
  if (!urlHeader) {
    setStatus('csvStatus', `No URL column found. Columns: ${(meta.fields ?? []).slice(0, 6).join(', ') || 'none'}.`);
    return;
  }
  const urls = [];
  csvData = {};
  for (const row of data) {
    const url = normalizeUrl(row[urlHeader]);
    if (!url) continue;
    urls.push(url);
    const metrics = {};
    for (const key of ['clicks', 'impressions']) {
      if (row[key] !== undefined && row[key] !== '') metrics[key] = Number(String(row[key]).replace(/[,\s]/g, ''));
    }
    if (Object.keys(metrics).length) csvData[url] = metrics;
  }
  if (!urls.length) {
    csvData = null;
    setStatus('csvStatus', 'That column holds no valid URLs.');
    return;
  }
  appendUrls(urls);
  toast(`${formatNumber(urls.length)} URLs imported from ${file.name}.`, 'success');
  setStatus('csvStatus', '');
  showSource('list');
}

async function addLinksFromPage() {
  const url = normalizeUrl(withScheme($('#spiderUrl').value));
  if (!url) { toast('Enter a valid page URL.', 'error'); return; }
  const button = $('#spiderBtn');
  button.disabled = true;
  try {
    const { urls } = await request({ type: 'discoverLinks', url, settings: collectSettings() });
    appendUrls(urls);
    $('#spiderUrl').value = '';
    toast(`${formatNumber(urls.length)} URLs added from that page.`, 'success');
  } catch (e) {
    toast(`Could not read that page: ${e.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function bindDropzone(zone, input, onFile) {
  input.addEventListener('change', () => {
    const [file] = input.files;
    if (file) onFile(file);
    input.value = '';
  });
  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, e => { e.preventDefault(); zone.classList.add('is-over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, () => zone.classList.remove('is-over'));
  }
  zone.addEventListener('drop', e => {
    e.preventDefault();
    const [file] = e.dataTransfer.files;
    if (file) onFile(file);
  });
}

// ── Presets ─────────────────────────────────────────────────────────────────

async function renderPresets() {
  const { regexPresets = [] } = await chrome.storage.local.get('regexPresets');
  const container = $('#filterPresets');
  container.replaceChildren(...[...BUILT_IN_PRESETS, ...regexPresets].map(preset => el('button', {
    type: 'button',
    class: 'chip',
    title: preset.regex,
    onclick: () => {
      $('#filterRegex').value = preset.regex;
      if (preset.type) $(`input[name="filterType"][value="${preset.type}"]`).checked = true;
      updateFilterUi();
      saveSettings();
    },
  }, preset.name)));
}

// ── Start ───────────────────────────────────────────────────────────────────

function syncCrawlButton() {
  const running = !!state.active;
  const source = currentSource();
  const button = $('#crawlBtn');
  const label = $('#crawlBtnLabel');
  $('#setupFields').disabled = running;
  button.disabled = running;
  if (running) label.textContent = 'Crawl in progress';
  else if (source === 'website') label.textContent = 'Start crawl';
  else {
    const urls = parseUrlList($('#urlList').value);
    label.textContent = urls.length ? `Crawl ${formatNumber(urls.length)} URLs` : 'Start crawl';
  }
}

export async function startCrawl() {
  if (state.active) return;
  const valid = validate();
  if (!valid) return;
  if (compileFilter().error) { $('#filterRegex').focus(); return; }

  const settings = collectSettings();
  state.settings = settings;
  chrome.storage.local.set({ crawlSettings: settings });

  const crawlId = `crawl-${Date.now()}`;
  state.pendingStartId = crawlId;
  const usesCsv = csvData && currentSource() !== 'website';
  send({
    type: 'startCrawl',
    crawlId,
    name: resolveNameTemplate('{hostname} {datetime}', valid.seeds[0]),
    seeds: valid.seeds,
    settings: normalizeSettings({
      ...settings,
      opfsEnabled: $('#opfsEnabled').checked,
      opfsRootDir: $('#opfsRootDir').value,
    }),
    extra: usesCsv ? { csv: csvData } : undefined,
  });
}

// ── Init ────────────────────────────────────────────────────────────────────

export async function initSetup() {
  const { crawlSettings, opfsSettings = {} } = await chrome.storage.local.get(['crawlSettings', 'opfsSettings']);
  const isFirstRun = !crawlSettings;
  state.settings = normalizeSettings(crawlSettings ?? { stayonhostname: true });
  applySettings(state.settings, opfsSettings);
  showSource(isFirstRun || state.settings.crawlMode === 'recursive' ? 'website' : 'list');

  $('#setupForm').addEventListener('submit', e => { e.preventDefault(); startCrawl(); });
  $('#setupForm').addEventListener('change', e => {
    if (e.target.id !== 'opfsEnabled' && e.target.id !== 'opfsRootDir') saveSettings();
  });

  $('#sourcePicker').addEventListener('change', e => {
    showSource(e.target.value);
    if (e.target.value === 'website') $('#stayonhostname').checked = true;
    saveSettings();
  });
  $('#filterType').addEventListener('change', () => { updateFilterUi(); saveSettings(); });
  $('#filterRegex').addEventListener('input', () => { updateFilterUi(); saveSettings(); });
  $('#urlList').addEventListener('input', () => { setError('urlList', null); updateUrlCount(); });
  $('#startUrl').addEventListener('input', () => setError('startUrl', null));
  $('#startUrl').addEventListener('blur', () => {
    if ($('#startUrl').value.trim()) $('#startUrl').value = withScheme($('#startUrl').value);
  });

  for (const [id, format] of Object.entries(SLIDERS)) {
    $(`#${id}`).addEventListener('input', e => { $(`#${id}Value`).textContent = format(e.target.value); });
  }

  $('#opfsEnabled').addEventListener('change', e => {
    $('#opfsDirField').hidden = !e.target.checked;
    saveArchiveSettings();
  });
  $('#opfsRootDir').addEventListener('input', saveArchiveSettings);

  $('#spiderBtn').addEventListener('click', addLinksFromPage);
  $('#spiderUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addLinksFromPage(); }
  });
  $('#sitemapBtn').addEventListener('click', loadSitemapFromUrl);
  $('#sitemapUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); loadSitemapFromUrl(); }
  });
  bindDropzone($('#sitemapDrop'), $('#sitemapFile'), loadSitemapFile);
  bindDropzone($('#csvDrop'), $('#csvFile'), loadCsvFile);

  $('#crawlBtnIcon').replaceChildren(icon('play'));
  $('#advancedChevron').replaceChildren(icon('chevron', 'icon icon-sm chevron'));
  renderPresets();
  updateUrlCount();

  chrome.storage.onChanged.addListener(changes => {
    if (changes.regexPresets) renderPresets();
  });
  on('active', syncCrawlButton);
  emit('setup-ready');
}

export function focusStart() {
  $(currentSource() === 'website' ? '#startUrl' : '#urlList').focus();
}

