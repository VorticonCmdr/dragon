// Saved crawls. Every crawl is stored as it runs, so this is only a list to
// open, rename and delete: there is no separate save step to forget.

import { crawlDB } from '../db.js';
import { openDialog, toast } from './components.js';
import { $, debounce, el, formatDate, formatNumber, icon } from './dom.js';
import { request } from './port.js';
import { closeSession, openCrawl } from './session.js';
import { emit, on, state } from './store.js';

const STATUS_LABEL = { done: 'Complete', stopped: 'Stopped', running: 'Running', paused: 'Paused', error: 'Failed' };

export function confirmAction({ title, text, confirm }) {
  const dialog = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = confirm;
  return new Promise(resolve => {
    const settle = value => {
      dialog.removeEventListener('close', onClose);
      dialog.close();
      resolve(value);
    };
    const onClose = () => settle(false);
    dialog.addEventListener('close', onClose);
    $('#confirmOk').onclick = () => settle(true);
    $('#confirmCancel').onclick = () => settle(false);
    openDialog(dialog);
    $('#confirmCancel').focus();
  });
}

export function renameCrawl(crawl) {
  const dialog = $('#renameDialog');
  const input = $('#renameInput');
  input.value = crawl.name;
  $('#renameForm').onsubmit = async e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    await crawlDB.rename(crawl.id, name);
    dialog.close();
    if (state.session?.id === crawl.id) {
      state.session.meta.name = name;
      emit('session-updated', state.session);
    }
    renderList();
  };
  openDialog(dialog);
  input.select();
}

async function deleteCrawl(crawl) {
  const confirmed = await confirmAction({
    title: 'Delete this crawl?',
    text: `“${crawl.name}” and its archived HTML will be removed. This can't be undone.`,
    confirm: 'Delete',
  });
  if (!confirmed) return;
  try {
    const { opfsSettings = {} } = await chrome.storage.local.get('opfsSettings');
    await request({
      type: 'deleteCrawl',
      id: crawl.id,
      opfsRootDir: crawl.settings?.opfsRootDir ?? opfsSettings.rootDir ?? 'crawl_archive',
    });
    if (state.session?.id === crawl.id) closeSession();
    toast('Crawl deleted.');
    renderList();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function crawlRow(crawl) {
  const counts = crawl.counts ?? {};
  const isLive = state.active?.crawlId === crawl.id;
  return el('li', { class: 'saved-row' },
    el('button', {
      type: 'button',
      class: 'saved-open',
      onclick: async () => {
        $('#savedDialog').close();
        emit('show-results');
        try {
          await openCrawl(crawl.id);
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    },
    el('span', { class: 'saved-name' }, crawl.name),
    el('span', { class: 'saved-meta' }, [
      formatDate(crawl.createdAt),
      `${formatNumber(counts.crawled ?? 0)} URLs`,
      counts.failed ? `${formatNumber(counts.failed)} failed` : null,
    ].filter(Boolean).join(' · '))),
    crawl.source?.type === 'schedule' ? el('span', { class: 'tag' }, icon('clock', 'icon icon-xs'), 'Scheduled') : null,
    crawl.status !== 'done' ? el('span', { class: 'tag' }, STATUS_LABEL[crawl.status] ?? crawl.status) : null,
    el('button', { class: 'icon-btn', 'aria-label': `Rename ${crawl.name}`, onclick: () => renameCrawl(crawl) }, icon('pencil')),
    el('button', { class: 'icon-btn icon-btn-danger', 'aria-label': `Delete ${crawl.name}`, disabled: isLive, onclick: () => deleteCrawl(crawl) }, icon('trash')));
}

async function renderList() {
  const query = $('#savedSearch').value.trim().toLowerCase();
  const crawls = await crawlDB.list();
  const matches = crawls.filter(crawl => crawl.name.toLowerCase().includes(query) || (crawl.startURL ?? '').toLowerCase().includes(query));
  const container = $('#savedList');
  if (!matches.length) {
    container.replaceChildren(el('div', { class: 'empty empty-sm' },
      el('h3', {}, crawls.length ? 'No matching crawls' : 'No crawls yet'),
      crawls.length ? null : el('p', {}, 'Every crawl is saved here automatically.')));
    return;
  }
  container.replaceChildren(el('ul', {}, matches.map(crawlRow)));
}

export function openSaved() {
  $('#savedSearch').value = '';
  renderList();
  openDialog($('#savedDialog'));
  $('#savedSearch').focus();
}

export function initSaved() {
  $('#savedBtn').addEventListener('click', openSaved);
  $('#savedIcon').replaceChildren(icon('folder'));
  $('#savedSearch').addEventListener('input', debounce(renderList, 120));
  $('#renameBtn').addEventListener('click', () => {
    if (state.session) renameCrawl(state.session.meta);
  });
  on('bg:crawlDeleted', ({ crawlId }) => { if (state.session?.id === crawlId) closeSession(); });
  $('#confirmDialog').addEventListener('cancel', e => e.stopPropagation());
}
