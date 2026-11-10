// Schedules are alarms that start a normal crawl through the engine. Only one
// crawl runs at a time, so a due schedule waits in a persisted list.

import { normalizeSettings } from '../shared/defaults.js';
import { fetchSitemapUrls } from '../shared/sitemap.js';
import { parseUrlList, normalizeUrl, resolveNameTemplate } from '../shared/url.js';
import { fetchPage } from './fetchPage.js';
import { isBusy, startCrawl } from './engine.js';
import { broadcast } from './messages.js';
import { parsePage } from './parsePage.js';

const WEEK_MINUTES = 10080;
const ALARM_PREFIX = 'cron-';
const TIME_SEPARATOR = ':';

// Resolving seeds takes seconds, during which `running` is not yet set.
const starting = new Set();

export function isScheduleAlarm(name) {
  return name.startsWith(ALARM_PREFIX);
}

function nextFiringTime(periodInMinutes, timeStr, dayOfWeek) {
  const [hours, minutes] = (timeStr || '00:00').split(TIME_SEPARATOR).map(Number);
  const candidate = new Date();
  candidate.setHours(hours, minutes, 0, 0);

  if (periodInMinutes === WEEK_MINUTES) {
    candidate.setDate(candidate.getDate() + (((dayOfWeek ?? 1) - candidate.getDay() + 7) % 7));
    if (candidate.getTime() <= Date.now()) candidate.setDate(candidate.getDate() + 7);
  } else if (candidate.getTime() <= Date.now()) {
    const periodMs = periodInMinutes * 60_000;
    const elapsed = Date.now() - candidate.getTime();
    candidate.setTime(candidate.getTime() + Math.ceil(elapsed / periodMs) * periodMs);
    if (candidate.getTime() <= Date.now()) candidate.setTime(candidate.getTime() + periodMs);
  }
  return candidate.getTime();
}

const getSchedules = async () => (await chrome.storage.local.get('schedules')).schedules ?? {};

// Read-modify-write queue: alarms and the UI can touch schedules concurrently.
let scheduleWrites = Promise.resolve();
function updateSchedules(change) {
  const write = scheduleWrites.then(async () => {
    const schedules = await getSchedules();
    change(schedules);
    await chrome.storage.local.set({ schedules });
  });
  scheduleWrites = write.catch(() => {});
  return write;
}

function createAlarm(schedule) {
  const periodInMinutes = schedule.intervalMinutes || 1440;
  chrome.alarms.create(`${ALARM_PREFIX}${schedule.id}`, {
    when: nextFiringTime(periodInMinutes, schedule.timeStr, schedule.dayOfWeek),
    periodInMinutes,
  });
}

export async function setSchedule(schedule) {
  await updateSchedules(schedules => { schedules[schedule.id] = schedule; });
  await chrome.alarms.clear(`${ALARM_PREFIX}${schedule.id}`);
  await chrome.alarms.clear(schedule.id); // Older versions named the alarm by bare id.
  if (schedule.enabled) createAlarm(schedule);
}

export async function deleteSchedule(id) {
  await updateSchedules(schedules => { delete schedules[id]; });
  await chrome.alarms.clear(`${ALARM_PREFIX}${id}`);
  await chrome.alarms.clear(id);
  await removePending(id);
}

export async function restoreAlarms() {
  const schedules = await getSchedules();
  for (const schedule of Object.values(schedules)) {
    await chrome.alarms.clear(schedule.id);
    if (schedule.enabled && !(await chrome.alarms.get(`${ALARM_PREFIX}${schedule.id}`))) createAlarm(schedule);
  }
}

async function getPending() {
  return (await chrome.storage.local.get('pendingScheduleIds')).pendingScheduleIds ?? [];
}

async function addPending(id) {
  const pending = await getPending();
  if (!pending.includes(id)) await chrome.storage.local.set({ pendingScheduleIds: [...pending, id] });
}

async function removePending(id) {
  const pending = await getPending();
  await chrome.storage.local.set({ pendingScheduleIds: pending.filter(entry => entry !== id) });
}

async function spiderLinks(url, settings) {
  const result = await fetchPage(url, settings);
  if (!result.html) return [];
  return parsePage(result.html, result.fetch.finalUrl ?? url, result.headers).links.map(link => link.url);
}

async function resolveSeeds(schedule, settings) {
  const { spiderUrl, urlList, sitemapUrl } = schedule.sources ?? {};
  if (settings.crawlMode === 'recursive') return spiderUrl ? [spiderUrl] : [];

  const urls = parseUrlList(urlList);
  if (spiderUrl) urls.push(normalizeUrl(spiderUrl), ...await spiderLinks(spiderUrl, settings).catch(() => []));
  if (sitemapUrl) urls.push(...(await fetchSitemapUrls(sitemapUrl)).urls);

  const unique = [...new Set(urls.filter(Boolean))];
  if (!settings.filterRegex || !settings.filterType) return unique;
  try {
    const re = new RegExp(settings.filterRegex, 'i');
    return unique.filter(url => re.test(url) === (settings.filterType === 'include'));
  } catch {
    return unique;
  }
}

function firstSourceUrl(sources = {}) {
  return sources.spiderUrl || parseUrlList(sources.urlList)[0] || sources.sitemapUrl || '';
}

async function loadCrawlSettings() {
  const { crawlSettings = {}, opfsSettings = {} } = await chrome.storage.local.get(['crawlSettings', 'opfsSettings']);
  return { crawlSettings, opfsSettings };
}

async function startSchedule(schedule) {
  if (starting.has(schedule.id)) return;
  starting.add(schedule.id);
  try {
    await launchSchedule(schedule);
  } finally {
    starting.delete(schedule.id);
  }
}

async function launchSchedule(schedule) {
  const { crawlSettings, opfsSettings } = await loadCrawlSettings();
  const settings = normalizeSettings({
    ...crawlSettings,
    crawlMode: schedule.crawlMode,
    maxPages: schedule.maxPages,
    filterRegex: schedule.filter?.regex ?? '',
    filterType: schedule.filter?.type ?? '',
    stayonhostname: schedule.crawlMode === 'recursive' ? true : crawlSettings.stayonhostname,
    opfsEnabled: !!(opfsSettings.enabled && opfsSettings.rootDir),
    opfsRootDir: opfsSettings.rootDir,
  });

  const seeds = await resolveSeeds(schedule, settings);
  // Seed resolution can take a while, and a manual crawl may have started meanwhile.
  if (isBusy()) { await addPending(schedule.id); return; }
  const crawlId = `crawl-${Date.now()}`;
  const name = resolveNameTemplate(schedule.nameTemplate, firstSourceUrl(schedule.sources));

  await updateSchedules(schedules => {
    if (schedules[schedule.id]) schedules[schedule.id].running = true;
  });
  broadcast({ type: 'scheduleStart', scheduleId: schedule.id, crawlId });
  try {
    await startCrawl({ crawlId, name, seeds, settings, source: { type: 'schedule', scheduleId: schedule.id } });
  } catch (e) {
    await markFinished(schedule.id, { total: 0, ok: 0, errors: 0, name, crawlKey: null, error: e.message });
    broadcast({ type: 'scheduleComplete', scheduleId: schedule.id, crawlId: null });
    throw e;
  }
}

export async function runSchedule(id) {
  const schedule = (await getSchedules())[id];
  if (!schedule || schedule.running) return { started: false };
  if (isBusy()) {
    await addPending(id);
    return { started: false, queued: true };
  }
  await startSchedule(schedule);
  return { started: true };
}

async function markFinished(id, summary) {
  const timestamp = new Date().toISOString();
  await updateSchedules(schedules => {
    if (!schedules[id]) return;
    schedules[id].running = false;
    schedules[id].lastRun = timestamp;
    schedules[id].summary = { ...summary, timestamp };
  });
}

export async function onCrawlFinished({ crawlId, counts, name, source }) {
  if (source?.type === 'schedule') {
    await markFinished(source.scheduleId, {
      total: counts.crawled,
      ok: counts.ok,
      errors: counts.failed,
      name,
      crawlKey: crawlId,
    });
    broadcast({ type: 'scheduleComplete', scheduleId: source.scheduleId, crawlId });
  }
  await drainPending();
}

export async function drainPending() {
  for (const id of await getPending()) {
    if (isBusy()) return;
    await removePending(id);
    const schedule = (await getSchedules())[id];
    if (schedule?.enabled) await startSchedule(schedule).catch(e => console.error('schedule failed', e));
  }
}

export async function onScheduleAlarm(alarmName) {
  const id = alarmName.slice(ALARM_PREFIX.length);
  const schedule = (await getSchedules())[id];
  if (!schedule?.enabled) return;
  await runSchedule(id);
}

// A worker that died mid-crawl leaves `running` behind. The crawl itself resumes
// from IndexedDB; only schedules without a matching live crawl are cleared.
export async function clearStaleRunningFlags(activeScheduleId) {
  await updateSchedules(schedules => {
    for (const schedule of Object.values(schedules)) {
      if (schedule.running && schedule.id !== activeScheduleId) schedule.running = false;
    }
  });
}

export async function discoverLinks(url, settings) {
  const normalized = normalizeSettings({ ...settings, maxRetries: 1 });
  const links = await spiderLinks(url, normalized);
  return { urls: [...new Set([normalizeUrl(url), ...links])] };
}
