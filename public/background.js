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

    const alarmName = `cron-${id}`;
    const existing = await chrome.alarms.get(alarmName);
    const legacy = await chrome.alarms.get(id);
    if (legacy) await chrome.alarms.clear(id); // migrate away from old naming

    if (!existing) {
      const periodInMinutes = schedule.intervalMinutes || 1440;
      const when = nextFiringTime(periodInMinutes, schedule.timeStr || '00:00', schedule.dayOfWeek ?? 1);
      chrome.alarms.create(alarmName, { when, periodInMinutes });
    }
  }
  if (dirty) await chrome.storage.local.set({ schedules });

  // Resume an interrupted background crawl
  const { activeCrawl: savedCrawl } = await chrome.storage.local.get('activeCrawl');
  if (savedCrawl?.status === 'running') {
    activeCrawl = { ...savedCrawl, data: { ...savedCrawl.data, results: {} } };
    try {
      const blob = await crawlDB.get(`crawl-${savedCrawl.id}`);
      if (blob?.data?.results) activeCrawl.data.results = blob.data.results;
    } catch {}
    chrome.alarms.create('crawl-keepalive', { periodInMinutes: 1 });
    runBackgroundCrawl();
  }
}

// ── Alarm fires ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'crawl-keepalive') {
    if (activeCrawl?.status === 'running' && !crawlLoopRunning) runBackgroundCrawl();
    return;
  }
  if (alarm.name === 'scheduled-keepalive') return; // keeps SW alive during scheduled crawls

  // Resolve job ID from both new ('cron-<id>') and legacy ('<id>') naming
  const jobId = alarm.name.startsWith('cron-') ? alarm.name.slice(5) : alarm.name;
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  const schedule = schedules[jobId];
  if (!schedule?.enabled) return;
  if (schedule.running) return; // Bug 1: same schedule already running
  if (activeCrawl?.status === 'running') {
    pendingScheduledJobs.add(jobId); // Bug 5: queue until manual crawl finishes
    return;
  }
  await runCrawl(schedules, jobId);
});

// ── Messages from UI (schedules) ───────────────────────────────────────────

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
  if (msg.type === 'runCronJob') {
    chrome.storage.local.get('schedules', async ({ schedules = {} }) => {
      const s = schedules[msg.jobId];
      if (s && !s.running) await runCrawl(schedules, msg.jobId); // Bug 2: guard Run Now
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ── Background crawl — port-based connection from dragon.html ──────────────

let activeCrawl = null;
let crawlLoopRunning = false;
let runningScheduledCrawls = 0;
const dragonPorts = new Set();
const pendingScheduledJobs = new Set();

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dragon-ui') return;
  dragonPorts.add(port);
  // Sync current crawl state immediately to the reconnecting tab
  if (activeCrawl) {
    port.postMessage({ type: 'crawlProgress', ...progressSnapshot() });
  }
  port.onDisconnect.addListener(() => dragonPorts.delete(port));
  port.onMessage.addListener(msg => handlePortMessage(msg, port));
});

function broadcastProgress(msg) {
  dragonPorts.forEach(p => { try { p.postMessage(msg); } catch {} });
}

function progressSnapshot() {
  if (!activeCrawl) return {};
  const crawled = Object.keys(activeCrawl.data.results || {}).length;
  const queueLength = activeCrawl.data.queue?.length || 0;
  return {
    crawled,
    total: crawled + queueLength,
    status: activeCrawl.status,
    crawlId: activeCrawl.id,
  };
}

function handlePortMessage(msg, port) {
  if (msg.type === 'startCrawl') {
    if (activeCrawl && activeCrawl.status !== 'done') {
      port.postMessage({ type: 'error', message: 'A crawl is already in progress.' });
      return;
    }
    startBackgroundCrawl(msg);
  } else if (msg.type === 'stopCrawl') {
    if (activeCrawl) {
      activeCrawl.status = 'stopped';
      // Loop will exit on next iteration; finishBackgroundCrawl called from there
    }
  } else if (msg.type === 'pauseCrawl') {
    if (activeCrawl) activeCrawl.status = 'paused';
  } else if (msg.type === 'resumeCrawl') {
    if (activeCrawl && activeCrawl.status === 'paused') {
      activeCrawl.status = 'running';
      runBackgroundCrawl();
    }
  } else if (msg.type === 'getActiveCrawl') {
    if (activeCrawl) {
      port.postMessage({ type: 'crawlProgress', ...progressSnapshot() });
    }
  }
}

async function startBackgroundCrawl(msg) {
  // Mark all queued URLs with 0 (queued, not yet fetched)
  const alreadyFetched = {};
  for (const url of msg.queue) alreadyFetched[url] = 0;

  activeCrawl = {
    id: msg.crawlId,
    name: msg.name || '',
    status: 'running',
    settings: msg.settings,
    data: {
      startURL: msg.queue[0] || '',
      queue: [...msg.queue],
      alreadyFetched,
      depth: { ...(msg.depth || {}) },
      outboundOnly: { ...(msg.outboundOnly || {}) },
      queueMaxLength: msg.queue.length,
      results: {},
    },
  };

  chrome.alarms.create('crawl-keepalive', { periodInMinutes: 1 });
  await persistActiveCrawl();
  runBackgroundCrawl();
}

async function runBackgroundCrawl() {
  if (crawlLoopRunning) return;
  crawlLoopRunning = true;

  try {
    const BATCH = Math.min(activeCrawl?.settings?.maxConnections ?? 20, 10);
    let saveCount = 0;

    while (activeCrawl?.status === 'running' && activeCrawl.data.queue.length > 0) {
      // Cap recursive mode at maxPages
      if (activeCrawl.settings.crawlMode === 'recursive' &&
          Object.keys(activeCrawl.data.results).length >= (activeCrawl.settings.maxPages ?? 500)) {
        activeCrawl.data.queue = [];
        break;
      }

      const batch = activeCrawl.data.queue.splice(0, BATCH);

      await Promise.all(batch.map(async url => {
        try {
          const t0 = performance.now();
          const response = await fetch(url, {
            cache: 'no-cache',
            credentials: activeCrawl.settings.credentials || 'omit',
          });
          const html = await response.text();
          const duration = Math.round(performance.now() - t0);
          const rawBytes = new TextEncoder().encode(html).byteLength;
          const encodedBodySize = parseInt(response.headers.get('content-length') || '0', 10) || rawBytes;
          const deliveryType = duration < 12 ? 'cache' : 'network';

          const meta = extractMetadata(html);
          activeCrawl.data.results[url] = {
            href: url,
            depth: activeCrawl.data.depth[url] ?? 0,
            fetch: {
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              redirected: response.redirected,
              finalUrl: response.redirected ? response.url : undefined,
              contentType: response.headers.get('content-type') || '',
              timestamp: new Date().toISOString(),
              duration,
              encodedBodySize,
              decodedBodySize: rawBytes,
              deliveryType,
            },
            title: meta.title,
            description: meta.description,
            h1: meta.h1,
            canonical: meta.canonical,
            keyword: meta.keyword,
            robots: meta.robots,
            og: { title: meta.ogTitle, description: meta.ogDescription },
          };
          activeCrawl.data.alreadyFetched[url] = 1;

          // Recursive mode: discover and enqueue links
          if (activeCrawl.settings.crawlMode === 'recursive' && response.ok && html) {
            const base = new URL(url);
            for (const link of extractLinks(html, url)) {
              if (activeCrawl.data.alreadyFetched[link] !== undefined) continue;
              if (activeCrawl.settings.stayonhostname && new URL(link).hostname !== base.hostname) continue;
              if (activeCrawl.settings.filterRegex && activeCrawl.settings.filterType) {
                try {
                  const re = new RegExp(activeCrawl.settings.filterRegex, 'i');
                  const isMatch = re.test(link);
                  if (activeCrawl.settings.filterType === 'include' && !isMatch) continue;
                  if (activeCrawl.settings.filterType === 'exclude' && isMatch) continue;
                } catch {}
              }
              activeCrawl.data.alreadyFetched[link] = 0;
              activeCrawl.data.depth[link] = (activeCrawl.data.depth[url] ?? 0) + 1;
              activeCrawl.data.queue.push(link);
            }
          }

          // OPFS archiving
          if (activeCrawl.settings.opfsEnabled && activeCrawl.settings.opfsRootDir && response.ok && html) {
            await writeToOPFS(activeCrawl.settings.opfsRootDir, `crawl-${activeCrawl.id}`, url, html).catch(() => {});
          }
        } catch (e) {
          activeCrawl.data.results[url] = {
            href: url,
            fetch: { status: 0, ok: false, timestamp: new Date().toISOString() },
            error: e.message,
          };
          activeCrawl.data.alreadyFetched[url] = 1;
        }
      }));

      broadcastProgress({ type: 'crawlProgress', ...progressSnapshot() });

      saveCount += batch.length;
      if (saveCount >= 10) {
        await persistActiveCrawl();
        saveCount = 0;
      }

      if (activeCrawl.settings.delay > 0) await sleep(activeCrawl.settings.delay);
    }

    // Natural completion or stop
    if (activeCrawl) {
      await finishBackgroundCrawl(activeCrawl.status === 'stopped');
    }
  } finally {
    crawlLoopRunning = false;
  }
}

async function persistActiveCrawl() {
  if (!activeCrawl) return;
  // Save queue/control state without bulky results
  const { results, ...dataWithoutResults } = activeCrawl.data;
  await chrome.storage.local.set({
    activeCrawl: { ...activeCrawl, data: dataWithoutResults },
  });
  // Save partial results to IDB so they survive SW restarts
  const key = `crawl-${activeCrawl.id}`;
  await crawlDB.put(key, {
    id: activeCrawl.id,
    name: activeCrawl.name,
    data: {
      ...activeCrawl.data,
      startURL: typeof activeCrawl.data.startURL === 'object'
        ? activeCrawl.data.startURL.href
        : activeCrawl.data.startURL,
    },
    settings: activeCrawl.settings,
    csv: { data: [] },
  });
}

async function finishBackgroundCrawl(stopped = false) {
  const crawlKey = `crawl-${activeCrawl.id}`;
  const crawlName = activeCrawl.name;
  const results = Object.values(activeCrawl.data.results);
  const okCount = results.filter(r => r.fetch?.ok).length;
  const totalCount = results.length;

  await persistActiveCrawl();
  await chrome.storage.local.remove('activeCrawl');
  await chrome.alarms.clear('crawl-keepalive');

  activeCrawl = null;
  await drainPendingJobs();

  broadcastProgress({ type: 'crawlComplete', crawlKey });

  if (!stopped) {
    chrome.notifications.create(`crawl-done-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/dragon64.png',
      title: `Crawl complete: ${crawlName}`,
      message: `${totalCount} URLs — ${okCount} OK`,
    });
  }
}

// ── Schedule management ────────────────────────────────────────────────────

function nextFiringTime(periodInMinutes, timeStr, dayOfWeek) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const candidate = new Date();
  candidate.setHours(h, m, 0, 0);

  if (periodInMinutes === 10080) {
    // Weekly: advance to the target weekday
    const today = candidate.getDay();
    let diff = (dayOfWeek ?? 1) - today;
    if (diff < 0) diff += 7;
    candidate.setDate(candidate.getDate() + diff);
    if (candidate.getTime() <= Date.now()) {
      candidate.setDate(candidate.getDate() + 7);
    }
  } else {
    // Interval-based: find the next occurrence on the period grid
    if (candidate.getTime() <= Date.now()) {
      const elapsed = Date.now() - candidate.getTime();
      const intervalsElapsed = Math.ceil(elapsed / (periodInMinutes * 60 * 1000));
      candidate.setTime(candidate.getTime() + intervalsElapsed * periodInMinutes * 60 * 1000);
    }
  }

  return candidate.getTime();
}

async function setSchedule(schedule) {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  schedules[schedule.id] = schedule;
  await chrome.storage.local.set({ schedules });

  const alarmName = `cron-${schedule.id}`;
  await chrome.alarms.clear(alarmName);
  await chrome.alarms.clear(schedule.id); // remove any legacy alarm

  if (schedule.enabled) {
    const periodInMinutes = schedule.intervalMinutes || 1440;
    const when = nextFiringTime(periodInMinutes, schedule.timeStr || '00:00', schedule.dayOfWeek ?? 1);
    chrome.alarms.create(alarmName, { when, periodInMinutes });
  }
}

async function deleteSchedule(id) {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  delete schedules[id];
  await chrome.storage.local.set({ schedules });
  await chrome.alarms.clear(`cron-${id}`);
  await chrome.alarms.clear(id); // legacy cleanup
}

// ── Crawl execution (scheduled crawls) ────────────────────────────────────

async function drainPendingJobs() {
  if (!pendingScheduledJobs.size) return;
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  for (const jobId of [...pendingScheduledJobs]) {
    pendingScheduledJobs.delete(jobId);
    const s = schedules[jobId];
    if (s?.enabled && !s.running) await runCrawl(schedules, jobId);
  }
}

async function setScheduleRunning(id, running) {
  const { schedules } = await chrome.storage.local.get('schedules');
  if (!schedules?.[id]) return;
  schedules[id].running = running;
  await chrome.storage.local.set({ schedules });
}

async function runCrawl(schedules, id) {
  const schedule = schedules[id];

  runningScheduledCrawls++;
  if (runningScheduledCrawls === 1) {
    chrome.alarms.create('scheduled-keepalive', { periodInMinutes: 1 });
  }
  await setScheduleRunning(id, true);
  broadcastProgress({ type: 'scheduledCrawlStart', jobId: id });

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
            broadcastProgress({ type: 'scheduledCrawlProgress', jobId: id, done: results.length, total: null });

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
            broadcastProgress({ type: 'scheduledCrawlProgress', jobId: id, done: results.length, total: null });
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
        broadcastProgress({ type: 'scheduledCrawlProgress', jobId: id, done: results.length, total: urls.length });
      }
    }
  } finally {
    runningScheduledCrawls--;
    if (runningScheduledCrawls === 0) await chrome.alarms.clear('scheduled-keepalive');

    const timestamp = new Date().toISOString();
    const name = resolveNameTemplate(
      schedule.nameTemplate || '{hostname} {datetime}',
      schedule.sources || {},
    );
    const crawlKey = results.length > 0 ? `crawl-${Date.now()}` : null;
    // Re-read schedules fresh to avoid overwriting concurrent schedule state (Bug 3)
    const { schedules: fresh } = await chrome.storage.local.get('schedules');
    if (fresh?.[id]) {
      fresh[id].running = false;
      fresh[id].lastRun = timestamp;
      fresh[id].summary = {
        total: results.length,
        ok: results.filter(r => r.ok).length,
        errors: results.filter(r => !r.ok).length,
        timestamp,
        name,
        crawlKey,
      };
      await chrome.storage.local.set({ schedules: fresh });
    }
    broadcastProgress({ type: 'scheduledCrawlComplete', jobId: id, crawlKey });
    if (crawlKey) await saveCrawlEntry(crawlKey, name, results, schedule.sources || {});

    const okCount = results.filter(r => r.ok).length;
    const errCount = results.filter(r => !r.ok).length;
    chrome.notifications.create(`crawl-done-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/dragon64.png',
      title: `Crawl complete: ${name}`,
      message: `${results.length} URLs — ${okCount} OK, ${errCount} errors`,
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
    robots: get([
      /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)/i,
      /<meta[^>]+content=["']([^"']*)[^>]+name=["']robots/i,
    ]),
    keyword: get([
      /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)/i,
      /<meta[^>]+content=["']([^"']*)[^>]+name=["']keywords/i,
    ]),
  };
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
