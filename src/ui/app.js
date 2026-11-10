// Page bootstrap: connects the service worker's messages to the views.

import { initDialogs, initTabs, toast } from './components.js';
import { initDetail, closeDetail } from './detail.js';
import { $, icon } from './dom.js';
import { exportZip } from './exports.js';
import { initIssues } from './issues.js';
import { initLinks } from './links.js';
import { initOverview } from './overview.js';
import { initPalette, openPalette } from './palette.js';
import { initPort } from './port.js';
import { initSaved, openSaved } from './saved.js';
import { initSchedules, openNewSchedule } from './schedules.js';
import { addRows, finishSession, followCrawl } from './session.js';
import { focusStart, initSetup, startCrawl } from './setup.js';
import { initStatus, pauseOrResume, stopCrawl } from './status.js';
import { emit, on, state } from './store.js';
import { exportCsv, initTable, rankPages } from './table.js';
import { effectiveTheme, initTheme, toggleTheme } from './theme.js';

const IS_MAC = navigator.platform.toLowerCase().includes('mac');

function renderThemeIcon() {
  $('#themeBtn').replaceChildren(icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'));
}

function setRail(open) {
  $('#workspace').classList.toggle('rail-closed', !open);
  $('#railToggle').setAttribute('aria-expanded', String(open));
  $('#rail').inert = !open;
  try {
    localStorage.setItem('railOpen', open ? '1' : '0');
  } catch {
    // The layout then just resets on reload.
  }
}

function toggleRail() {
  setRail($('#workspace').classList.contains('rail-closed'));
}

function setView(view) {
  state.view = view;
  $('#viewResults').hidden = view !== 'results';
  $('#viewSchedules').hidden = view !== 'schedules';
  for (const [id, name] of [['#navResults', 'results'], ['#navSchedules', 'schedules']]) {
    if (name === view) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  if (view !== 'results') closeDetail();
  emit('view', view);
  if (view === 'results') emit('tab', state.tab);
}

let tabs;

function showTab(name) {
  setView('results');
  tabs.select(name);
}

function actions() {
  const { active, session } = state;
  const list = [];
  if (active) {
    list.push({ label: active.status === 'paused' ? 'Resume crawl' : 'Pause crawl', run: pauseOrResume });
    list.push({ label: 'Stop crawl', run: stopCrawl });
  } else {
    list.push({ label: 'Start crawl', run: startCrawl });
  }
  list.push(
    { label: 'Open saved crawls', run: openSaved },
    { label: 'Go to Pages', run: () => showTab('pages') },
    { label: 'Go to Overview', run: () => showTab('overview') },
    { label: 'Go to Issues', run: () => showTab('issues') },
    { label: 'Go to Links', run: () => showTab('links') },
    { label: 'Go to Schedules', run: () => setView('schedules') },
    { label: 'New schedule', run: () => { setView('schedules'); openNewSchedule(); } },
    { label: 'Filter pages', hint: '/', run: focusTableSearch },
  );
  if (session) {
    if (!session.live) list.push({ label: session.meta.ranking ? 'Recalculate PageRank and CheiRank' : 'Rank pages (PageRank, CheiRank)', run: rankPages });
    list.push({ label: 'Export CSV', run: exportCsv });
    if (session.meta.settings?.opfsEnabled) list.push({ label: 'Export HTML ZIP', run: exportZip });
  }
  list.push(
    { label: effectiveTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', run: () => { toggleTheme(); renderThemeIcon(); } },
    { label: 'Toggle setup panel', run: toggleRail },
    { label: 'Open options', run: () => window.open('options.html') },
    { label: 'Manage robots.txt overrides', run: () => window.open('robots.html') },
  );
  return list;
}

function focusTableSearch() {
  showTab('pages');
  $('#tableSearch').focus();
  $('#tableSearch').select();
}

function isTyping(target) {
  return target.matches?.('input, textarea, select, [contenteditable]');
}

function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  } else if (e.key === '/' && !isTyping(e.target) && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    focusTableSearch();
  } else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
    closeDetail();
  }
}

function setActive(active) {
  state.active = active;
  emit('active', active);
}

function wireMessages() {
  on('bg:crawlState', async ({ active }) => {
    setActive(active);
    if (!active) return;
    const isOurStart = state.pendingStartId === active.crawlId;
    if (isOurStart) state.pendingStartId = null;
    // Never pull someone away from the crawl they are reading, only start
    // following when this tab started it or has nothing on screen.
    if (isOurStart || !state.session) {
      if (isOurStart) showTab('pages');
      await followCrawl(active.crawlId);
    }
    emit('active', active);
  });

  on('bg:pageDone', ({ crawlId, rows }) => {
    if (state.session?.id === crawlId) addRows(state.session, rows);
  });

  on('bg:crawlProgress', msg => {
    if (!state.active && msg.status !== 'done') {
      // Rejoining after a worker restart: progress can beat the state message.
      setActive({ crawlId: msg.crawlId, status: msg.status, progress: msg });
    }
  });

  on('bg:crawlComplete', async ({ crawlId, status, counts }) => {
    setActive(null);
    const { session } = state;
    if (session?.id !== crawlId) return;
    await finishSession(session, status);
    if (status === 'done') toast(`Crawl complete: ${counts.crawled.toLocaleString('en-US')} URLs.`, 'success');
  });

  on('bg:crawlError', ({ message, fatal }) => {
    if (fatal) setActive(null);
    toast(message, 'error');
  });

  on('bg:error', ({ message, request }) => {
    if (request === 'startCrawl') state.pendingStartId = null;
    toast(message, 'error');
  });
}

async function main() {
  initTheme();
  initDialogs();

  for (const [selector, name] of [
    ['#railToggle', 'sidebar'], ['#paletteIcon', 'search'], ['#optionsLink', 'settings'],
  ]) $(selector).replaceChildren(icon(name));
  document.querySelectorAll('[data-dialog-close].icon-btn').forEach(button => button.replaceChildren(icon('x')));
  $('#paletteKey').textContent = IS_MAC ? '⌘K' : 'Ctrl K';

  renderThemeIcon();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderThemeIcon);
  $('#themeBtn').addEventListener('click', () => { toggleTheme(); renderThemeIcon(); });
  $('#railToggle').addEventListener('click', toggleRail);
  $('#paletteBtn').addEventListener('click', openPalette);
  $('#navResults').addEventListener('click', () => setView('results'));
  $('#navSchedules').addEventListener('click', () => setView('schedules'));
  $('#exportZipBtn').addEventListener('click', exportZip);
  document.addEventListener('keydown', onKeydown);

  let railOpen = true;
  try {
    railOpen = localStorage.getItem('railOpen') !== '0';
  } catch {
    // Default layout.
  }
  setRail(railOpen);

  tabs = initTabs($('#resultTabs'), {
    onChange: tab => {
      state.tab = tab;
      emit('tab', tab);
    },
  });

  on('show-tab', showTab);
  on('show-results', () => setView('results'));
  on('focus-setup', () => { setRail(true); focusStart(); });

  await initSetup();
  initStatus();
  initTable();
  initOverview();
  initIssues();
  initLinks();
  initDetail();
  initSaved();
  initSchedules();
  initPalette(actions);
  wireMessages();
  initPort();
  emit('session', null);
}

main();
