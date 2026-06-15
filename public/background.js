importScripts('db.js');

// ── User-Agent via declarativeNetRequest ───────────────────────────────────

const DNR_RULE_ID = 10;
const DEFAULT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://google.com)';

async function applyUA(ua) {
  if (!ua) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [DNR_RULE_ID] });
    return;
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [{
      id: DNR_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'User-Agent', operation: 'set', value: ua }],
      },
      condition: {
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dragon.html') });
});

// ── Alarm restore on startup / install ─────────────────────────────────────

chrome.runtime.onStartup.addListener(restoreAlarms);
chrome.runtime.onInstalled.addListener(async () => {
  await restoreAlarms();
  const { userAgent } = await chrome.storage.local.get('userAgent');
  if (userAgent === undefined) {
    await chrome.storage.local.set({ userAgent: DEFAULT_UA });
    await applyUA(DEFAULT_UA);
  } else {
    await applyUA(userAgent);
  }
});

async function restoreAlarms() {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  let dirty = false;
  for (const [id, schedule] of Object.entries(schedules)) {
    if (schedule.running) {
      schedules[id].running = false;
      dirty = true;
    }
    if (!schedule.enabled) continue;
    const existing = await chrome.alarms.get(id);
    if (!existing) {
      chrome.alarms.create(id, {
        delayInMinutes: schedule.intervalMinutes,
        periodInMinutes: schedule.intervalMinutes,
      });
    }
  }
  if (dirty) await chrome.storage.local.set({ schedules });
}

// ── Alarm fires ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  const schedule = schedules[alarm.name];
  if (!schedule?.enabled) return;
  await runCrawl(schedules, alarm.name);
});

// ── Messages from UI ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'setSchedule') {
    setSchedule(msg.schedule).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'deleteSchedule') {
    deleteSchedule(msg.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'runNow') {
    chrome.storage.local.get('schedules', async ({ schedules = {} }) => {
      if (schedules[msg.id]) await runCrawl(schedules, msg.id);
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ── Schedule management ────────────────────────────────────────────────────

async function setSchedule(schedule) {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  schedules[schedule.id] = schedule;
  await chrome.storage.local.set({ schedules });
  await chrome.alarms.clear(schedule.id);
  if (schedule.enabled) {
    chrome.alarms.create(schedule.id, {
      delayInMinutes: schedule.intervalMinutes,
      periodInMinutes: schedule.intervalMinutes,
    });
  }
}

async function deleteSchedule(id) {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  delete schedules[id];
  await chrome.storage.local.set({ schedules });
  await chrome.alarms.clear(id);
}

// ── Crawl execution ────────────────────────────────────────────────────────

async function runCrawl(schedules, id) {
  const schedule = schedules[id];

  schedules[id].running = true;
  await chrome.storage.local.set({ schedules });

  const { opfsSettings = {} } = await chrome.storage.local.get('opfsSettings');
  const opfsEnabled = !!(opfsSettings.enabled && opfsSettings.rootDir);
  const opfsRootDir = opfsSettings.rootDir || 'crawl_archive';
  const crawlDir = `crawl-${Date.now()}`;

  const results = [];
  try {
    if (schedule.crawlMode === 'recursive') {
      const startUrl = schedule.sources?.spiderUrl;
      if (startUrl) {
        const queue = [startUrl];
        const visited = new Set([startUrl]);
        const maxPages = schedule.maxPages || 500;
        const stayonhostname = true;
        const delay = 288;
        const filter = schedule.filter || {};

        while (queue.length > 0 && results.length < maxPages) {
          const url = queue.shift();
          try {
            const r = await crawlUrl(url);
            if (opfsEnabled && r.ok && r.html) {
              r.opfs_path = await writeToOPFS(opfsRootDir, crawlDir, r.url, r.html);
            }

            if (r.ok && r.html && results.length < maxPages - 1) {
              const base = new URL(url);
              const links = extractLinks(r.html, url);
              for (const link of links) {
                try {
                  const u = new URL(link);
                  if (stayonhostname && u.hostname !== base.hostname) continue;

                  if (filter.regex && filter.type) {
                    const re = new RegExp(filter.regex, 'i');
                    const isMatch = re.test(link);
                    if (filter.type === 'include' && !isMatch) continue;
                    if (filter.type === 'exclude' && isMatch) continue;
                  }

                  if (!visited.has(link)) {
                    visited.add(link);
                    queue.push(link);
                  }
                } catch (e) {}
              }
            }

            delete r.html;
            results.push(r);

            if (queue.length > 0 && delay > 0) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (e) {
            results.push({
              url,
              status: 0,
              ok: false,
              title: '',
              error: e.message,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } else {
      const urls = await resolveUrls(schedule.sources || {}, schedule.filter || {});
      for (const url of urls) {
        try {
          const r = await crawlUrl(url);
          if (opfsEnabled && r.ok && r.html) {
            r.opfs_path = await writeToOPFS(opfsRootDir, crawlDir, r.url, r.html);
          }
          delete r.html;
          results.push(r);
        } catch (e) {
          results.push({
            url,
            status: 0,
            ok: false,
            title: '',
            error: e.message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  } finally {
    const timestamp = new Date().toISOString();
    const name = resolveNameTemplate(
      schedule.nameTemplate || '{hostname} {datetime}',
      schedule.sources || {},
    );
    const crawlKey = results.length > 0 ? `crawl-${Date.now()}` : null;
    schedules[id].running = false;
    schedules[id].lastRun = timestamp;
    schedules[id].summary = {
      total: results.length,
      ok: results.filter(r => r.ok).length,
      errors: results.filter(r => !r.ok).length,
      timestamp,
      name,
      crawlKey,
    };
    await chrome.storage.local.set({ schedules });
    if (crawlKey) await saveCrawlEntry(crawlKey, name, results, schedule.sources || {});

    const okCount = results.filter(r => r.ok).length;
    const errCount = results.filter(r => !r.ok).length;
    chrome.notifications.create(`crawl-done-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/dragon64.png',
      title: `Crawl abgeschlossen: ${name}`,
      message: `${results.length} URLs — ${okCount} OK, ${errCount} Fehler`,
    });
  }
}

async function saveCrawlEntry(storageKey, name, results, sources) {
  const crawlId = parseInt(storageKey.replace('crawl-', ''), 10);
  const resultsDict = {};
  for (const r of results) {
    resultsDict[r.url] = {
      href: r.url,
      fetch: { status: r.status, ok: r.ok, timestamp: r.timestamp, redirected: false, statusText: '' },
      title: r.title || '',
      description: r.description || '',
      h1: r.h1 || '',
      canonical: r.canonical || '',
      og: { title: r.ogTitle || '', description: r.ogDescription || '' },
      ...(r.error ? { error: r.error } : {}),
      ...(r.opfs_path ? { opfs_path: r.opfs_path } : {}),
    };
  }

  const firstUrl = sources.spiderUrl ||
    (sources.urlList && sources.urlList.split('\n').map(l => l.trim()).find(l => l.startsWith('http'))) ||
    sources.sitemapUrl || '';

  await crawlDB.put(storageKey, {
    id: crawlId,
    name,
    data: {
      startURL: firstUrl,
      results: resultsDict,
      queue: [],
      alreadyFetched: results.map(r => r.url),
      responseHeaders: {},
      queueMaxLength: results.length,
    },
    settings: {},
    csv: { data: [] },
  });
}

function resolveNameTemplate(template, sources) {
  const firstUrl = sources.spiderUrl ||
    (sources.urlList && sources.urlList.split('\n').map(l => l.trim()).find(l => l.startsWith('http'))) ||
    sources.sitemapUrl || '';
  let hostname = firstUrl;
  try { hostname = new URL(firstUrl).hostname; } catch {}
  const datetime = new Date().toLocaleString();
  return template.replace(/\{hostname\}/g, hostname).replace(/\{datetime\}/g, datetime);
}

async function resolveUrls(sources, filter) {
  let urls = [];

  if (sources.spiderUrl) {
    try {
      const resp = await fetch(sources.spiderUrl, { cache: 'no-cache', credentials: 'omit' });
      const html = await resp.text();
      urls.push(...extractLinks(html, sources.spiderUrl));
    } catch {}
  }

  if (sources.urlList) {
    const lines = sources.urlList.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('http'));
    urls.push(...lines);
  }

  if (sources.sitemapUrl) {
    try {
      urls.push(...await fetchSitemapUrls(sources.sitemapUrl));
    } catch {}
  }

  urls = [...new Set(urls)];

  if (filter.regex && filter.type) {
    try {
      const re = new RegExp(filter.regex);
      urls = filter.type === 'include'
        ? urls.filter(u => re.test(u))
        : urls.filter(u => !re.test(u));
    } catch {}
  }

  return urls;
}

function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const re = /href=["']([^"'#][^"']*)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base);
      if (u.protocol === 'http:' || u.protocol === 'https:') seen.add(u.href);
    } catch {}
  }
  return [...seen];
}

async function fetchSitemapUrls(url) {
  const resp = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
  const xml = await resp.text();

  if (/<sitemapindex/i.test(xml)) {
    const childUrls = [];
    const re = /<sitemap[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) childUrls.push(m[1].trim());
    const results = [];
    for (const child of childUrls) {
      try { results.push(...await fetchSitemapUrls(child)); } catch {}
    }
    return results;
  }

  const urls = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1].trim());
  return urls;
}

function urlToFilename(url) {
  try {
    const u = new URL(url);
    const safe = (u.hostname + u.pathname + u.search)
      .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 200);
    return safe + '.html';
  } catch {
    return btoa(url).replace(/[+/=]/g, '_').slice(0, 200) + '.html';
  }
}

async function writeToOPFS(rootDir, crawlDir, url, html) {
  try {
    const root = await navigator.storage.getDirectory();
    const rDir = await root.getDirectoryHandle(rootDir, { create: true });
    const cDir = await rDir.getDirectoryHandle(crawlDir, { create: true });
    const filename = urlToFilename(url);
    const fh = await cDir.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    await writable.write(html);
    await writable.close();
    return `${rootDir}/${crawlDir}/${filename}`;
  } catch (e) {
    console.error('OPFS write failed:', e);
    return null;
  }
}

async function crawlUrl(url) {
  const response = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
  const html = await response.text();
  return {
    url,
    status: response.status,
    ok: response.ok,
    html,
    timestamp: new Date().toISOString(),
    ...extractMetadata(html),
  };
}

function extractMetadata(html) {
  function get(patterns) {
    for (const p of [].concat(patterns)) {
      const m = html.match(p);
      if (m) return m[1].replace(/<[^>]+>/g, '').trim();
    }
    return '';
  }
  return {
    title: get(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description: get([
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i,
      /<meta[^>]+content=["']([^"']*)[^>]+name=["']description/i,
    ]),
    h1: get(/<h1[^>]*>([\s\S]*?)<\/h1>/i),
    canonical: get([
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)/i,
      /<link[^>]+href=["']([^"']*)[^>]+rel=["']canonical/i,
    ]),
    ogTitle: get([
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)/i,
      /<meta[^>]+content=["']([^"']*)[^>]+property=["']og:title/i,
    ]),
    ogDescription: get([
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i,
      /<meta[^>]+content=["']([^"']*)[^>]+property=["']og:description/i,
    ]),
  };
}
