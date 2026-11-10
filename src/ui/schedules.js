// Schedules: recurring crawls. They run through the same engine as manual ones.

import { openDialog, toast } from './components.js';
import { $, $$, el, formatDate, formatNumber, icon } from './dom.js';
import { request } from './port.js';
import { openCrawl } from './session.js';
import { emit, on, state } from './store.js';
import { confirmAction } from './saved.js';
import { parseUrlList } from '../shared/url.js';

const WEEK = 10080;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function intervalLabel({ intervalMinutes = 1440, timeStr = '00:00', dayOfWeek = 1 }) {
  if (intervalMinutes === WEEK) return `Every ${DAYS[dayOfWeek]} at ${timeStr}`;
  if (intervalMinutes === 1440) return `Every day at ${timeStr}`;
  if (intervalMinutes === 60) return 'Every hour';
  return `Every ${intervalMinutes / 60} hours`;
}

function target(schedule) {
  const { spiderUrl, sitemapUrl, urlList } = schedule.sources ?? {};
  if (spiderUrl) return spiderUrl;
  if (sitemapUrl) return sitemapUrl;
  const urls = parseUrlList(urlList);
  return urls.length ? `${formatNumber(urls.length)} URLs` : schedule.nameTemplate;
}

function statusTag(schedule) {
  if (schedule.running) return el('span', { class: 'pill pill-running' }, 'Running');
  if (schedule.enabled) return el('span', { class: 'pill pill-2xx' }, 'Active');
  return el('span', { class: 'pill pill-blocked' }, 'Paused');
}

async function act(run) {
  try {
    await run();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function scheduleCard(schedule, nextRun) {
  const { summary } = schedule;
  return el('li', { class: 'schedule' },
    el('div', { class: 'schedule-main' },
      el('div', { class: 'schedule-title' }, el('span', { class: 'schedule-target', title: target(schedule) }, target(schedule)), statusTag(schedule)),
      el('p', { class: 'schedule-when' }, intervalLabel(schedule),
        nextRun ? ` · next ${formatDate(nextRun)}` : ''),
      el('p', { class: 'schedule-last' }, summary
        ? summary.error
          ? `Last run failed: ${summary.error}`
          : `Last run ${formatDate(summary.timestamp)}: ${formatNumber(summary.ok)} of ${formatNumber(summary.total)} OK`
        : 'Has not run yet')),
    el('div', { class: 'schedule-actions' },
      summary?.crawlKey ? el('button', {
        class: 'btn btn-sm',
        onclick: () => act(async () => { emit('show-results'); await openCrawl(summary.crawlKey); }),
      }, 'Open last result') : null,
      el('button', {
        class: 'btn btn-sm',
        disabled: !!schedule.running,
        onclick: () => act(async () => {
          const { queued } = await request({ type: 'runSchedule', id: schedule.id });
          toast(queued ? 'Queued: it starts when the current crawl ends.' : 'Crawl started.');
        }),
      }, icon('bolt'), 'Run now'),
      el('button', {
        class: 'btn btn-sm',
        onclick: () => act(() => request({ type: 'setSchedule', schedule: { ...schedule, enabled: !schedule.enabled } })),
      }, schedule.enabled ? 'Pause' : 'Resume'),
      el('button', {
        class: 'icon-btn icon-btn-danger',
        'aria-label': 'Delete schedule',
        onclick: () => act(async () => {
          const confirmed = await confirmAction({
            title: 'Delete this schedule?',
            text: 'Crawls it already produced stay in Saved crawls.',
            confirm: 'Delete',
          });
          if (confirmed) await request({ type: 'deleteSchedule', id: schedule.id });
        }),
      }, icon('trash'))));
}

let renderToken = 0;

async function render() {
  if (state.view !== 'schedules') return;
  const token = ++renderToken;
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  const entries = Object.values(schedules);
  const nextRuns = await Promise.all(entries.map(async schedule => {
    if (!schedule.enabled) return null;
    const alarm = await chrome.alarms.get(`cron-${schedule.id}`);
    return alarm ? new Date(alarm.scheduledTime).toISOString() : null;
  }));
  if (token !== renderToken) return; // A newer render has started.

  const view = $('#viewSchedules');
  view.replaceChildren(el('div', { class: 'page' },
    el('header', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Schedules'),
        el('p', {}, 'Recurring crawls run in the background while Chrome is open.')),
      el('button', { class: 'btn btn-primary', onclick: openNewSchedule }, icon('plus'), 'New schedule')),
    entries.length
      ? el('ul', { class: 'schedule-list' }, entries.map((schedule, i) => scheduleCard(schedule, nextRuns[i])))
      : el('div', { class: 'empty' },
        el('h3', {}, 'No schedules yet'),
        el('p', {}, 'Crawl a site every day or week, and compare the results over time.'),
        el('button', { class: 'btn btn-primary', onclick: openNewSchedule }, 'Create a schedule'))));
}

function syncForm() {
  const isList = $('#scheduleMode').value === 'list';
  $$('[data-list-only]').forEach(field => { field.hidden = !isList; });
  $('#scheduleSpiderLabel').textContent = isList ? 'Add links from this page (optional)' : 'Start URL';
  $('#scheduleDayField').hidden = $('#scheduleInterval').value !== String(WEEK);
  $('#scheduleTime').closest('.field').hidden = Number($('#scheduleInterval').value) < 1440;
}

export function openNewSchedule() {
  $('#scheduleForm').reset();
  $('#scheduleError').hidden = true;
  syncForm();
  openDialog($('#scheduleDialog'));
  $('#scheduleSpiderUrl').focus();
}

async function submit(e) {
  e.preventDefault();
  const crawlMode = $('#scheduleMode').value;
  const sources = {
    spiderUrl: $('#scheduleSpiderUrl').value.trim(),
    urlList: crawlMode === 'list' ? $('#scheduleUrlList').value.trim() : '',
    sitemapUrl: crawlMode === 'list' ? $('#scheduleSitemapUrl').value.trim() : '',
  };
  const regex = $('#scheduleFilterRegex').value.trim();
  const error = message => {
    $('#scheduleError').textContent = message;
    $('#scheduleError').hidden = false;
  };
  if (crawlMode === 'recursive' && !sources.spiderUrl) return error('Enter a start URL.');
  if (crawlMode === 'list' && !sources.spiderUrl && !sources.urlList && !sources.sitemapUrl) {
    return error('Add URLs, a sitemap, or a page to take links from.');
  }
  try {
    if (regex) new RegExp(regex);
  } catch {
    return error('The URL filter is not a valid regular expression.');
  }

  const schedule = {
    id: `schedule-${Date.now()}`,
    nameTemplate: $('#scheduleName').value.trim() || '{hostname} {datetime}',
    intervalMinutes: Number($('#scheduleInterval').value),
    timeStr: $('#scheduleTime').value || '00:00',
    dayOfWeek: Number($('#scheduleDay').value),
    enabled: true,
    createdAt: new Date().toISOString(),
    sources,
    filter: { regex, type: $('#scheduleFilterType').value },
    crawlMode,
    maxPages: Number($('#scheduleMaxPages').value) || 500,
    lastRun: null,
    summary: null,
  };
  await act(async () => {
    await request({ type: 'setSchedule', schedule });
    $('#scheduleDialog').close();
    toast('Schedule created.', 'success');
  });
}

export function initSchedules() {
  $('#scheduleForm').addEventListener('submit', submit);
  $('#scheduleMode').addEventListener('change', syncForm);
  $('#scheduleInterval').addEventListener('change', syncForm);
  chrome.storage.onChanged.addListener(changes => { if (changes.schedules) render(); });
  on('view', render);
}
