// Service-worker entry. Listeners must register synchronously at top level, or
// Chrome will not deliver the event that woke the worker.

import { crawlDB } from './db.js';
import {
  getActiveState, pauseCrawl, resumeCrawl, resumeIfNeeded, setFinishedHandler, startCrawl, stopCrawl,
} from './bg/engine.js';
import { KEEPALIVE_ALARM } from './bg/keepalive.js';
import { broadcast, initPorts, initRequests, send } from './bg/messages.js';
import { initRedirectListener } from './bg/redirects.js';
import {
  clearStaleRunningFlags, deleteSchedule, discoverLinks, drainPending, isScheduleAlarm, onCrawlFinished,
  onScheduleAlarm, restoreAlarms, runSchedule, setSchedule,
} from './bg/scheduler.js';

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

async function boot() {
  // Superseded by the `state` store; written by versions before schema 2.
  await chrome.storage.local.remove('activeCrawl');
  await resumeIfNeeded();
  await clearStaleRunningFlags(getActiveState()?.source?.scheduleId);
  await drainPending();
}

// Every event awaits this, so a message that wakes the worker never races
// the restore of a crawl that was interrupted.
const ready = boot().catch(e => console.error('boot failed', e));

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dragon.html') });
});

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

chrome.alarms.onAlarm.addListener(async alarm => {
  await ready;
  if (alarm.name === KEEPALIVE_ALARM) return; // Waking up already resumed the crawl.
  if (isScheduleAlarm(alarm.name)) await onScheduleAlarm(alarm.name);
});

initRedirectListener();
setFinishedHandler(info => onCrawlFinished(info).catch(e => console.error(e)));

initPorts({
  onConnect: async port => {
    await ready;
    send(port, { type: 'crawlState', active: getActiveState() });
  },
  onPortMessage: async (msg, port) => {
    await ready;
    try {
      if (msg.type === 'startCrawl') await startCrawl(msg);
      else if (msg.type === 'pauseCrawl') pauseCrawl(msg.crawlId);
      else if (msg.type === 'resumeCrawl') await resumeCrawl(msg.crawlId);
      else if (msg.type === 'stopCrawl') await stopCrawl(msg.crawlId);
      else if (msg.type === 'getState') send(port, { type: 'crawlState', active: getActiveState() });
    } catch (e) {
      send(port, { type: 'error', message: e.message, request: msg.type });
    }
  },
});

initRequests({
  setSchedule: ({ schedule }) => setSchedule(schedule),
  deleteSchedule: ({ id }) => deleteSchedule(id),
  runSchedule: ({ id }) => runSchedule(id),
  discoverLinks: ({ url, settings }) => discoverLinks(url, settings),
  deleteCrawl: async ({ id, opfsRootDir }) => {
    await ready;
    if (getActiveState()?.crawlId === id) throw new Error('This crawl is still running.');
    await crawlDB.remove(id, { opfsRootDir });
    broadcast({ type: 'crawlDeleted', crawlId: id });
  },
});
