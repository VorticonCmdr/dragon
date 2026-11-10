// An idle service worker is stopped after 30 s. Extension API calls reset that
// timer, which is what the interval does; the alarm (minimum period 30 s) wakes
// the worker again if it died anyway, and its startup resumes the crawl.

export const KEEPALIVE_ALARM = 'crawl-keepalive';

let timer = null;

export function startKeepalive() {
  if (timer) return;
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  timer = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20_000);
}

export function stopKeepalive() {
  clearInterval(timer);
  timer = null;
  return chrome.alarms.clear(KEEPALIVE_ALARM);
}
