// Status bar: always shows what the crawler is doing and how to control it.

import { $, formatEta, formatNumber, icon } from './dom.js';
import { send } from './port.js';
import { on, state } from './store.js';
import { followCrawl } from './session.js';
import { hostnameOf } from '../shared/url.js';

let progress = null;

function setButton(button, iconName, label) {
  button.replaceChildren(icon(iconName), label);
}

function counts(p) {
  const parts = [];
  if (p.failed) parts.push(`${formatNumber(p.failed)} failed`);
  if (p.blocked) parts.push(`${formatNumber(p.blocked)} blocked`);
  return parts;
}

function render() {
  const bar = $('#statusbar');
  const { active, session } = state;
  const elsewhere = active && session?.id !== active.crawlId;
  const p = progress?.crawlId === active?.crawlId ? progress : active?.progress;
  const viewingLive = active && !elsewhere;

  let mode = 'idle';
  let title = 'Ready to crawl';
  let detail = 'Enter a start URL, or import a list of URLs.';

  if (viewingLive && active.status === 'stopped') {
    mode = 'running';
    title = 'Stopping…';
    detail = '';
  } else if (viewingLive) {
    const done = p?.crawled ?? 0;
    const total = p?.total ?? 0;
    mode = active.status === 'paused' ? 'paused' : 'running';
    title = `${mode === 'paused' ? 'Paused' : 'Crawling'} ${hostnameOf(session.meta.startURL) || session.meta.name}`;
    const rate = p?.rate ?? 0;
    detail = [
      `${formatNumber(done)} of ${formatNumber(total)} URLs`,
      ...(p ? counts(p) : []),
      ...(mode === 'running' && rate > 0 ? [`${rate.toFixed(1)} pages/s`, formatEta(p.queued / rate)] : []),
    ].filter(Boolean).join(' · ');
  } else if (elsewhere) {
    mode = 'elsewhere';
    title = active.source?.type === 'schedule' ? 'A scheduled crawl is running' : 'Another crawl is running';
    detail = p ? `${formatNumber(p.crawled)} of ${formatNumber(p.total)} URLs` : '';
  } else if (session) {
    const c = session.meta.counts ?? {};
    const stopped = session.meta.status === 'stopped';
    mode = stopped ? 'stopped' : session.meta.status === 'error' ? 'error' : 'done';
    title = session.meta.name;
    detail = [
      stopped ? 'Stopped early' : session.meta.status === 'error' ? 'Ended with an error' : 'Complete',
      `${formatNumber(c.crawled ?? session.rows.size)} URLs`,
      ...counts(c),
    ].join(' · ');
  }

  bar.dataset.state = mode;
  $('#statusTitle').textContent = title;
  $('#statusDetail').textContent = detail;

  const pct = p?.total ? Math.round((p.crawled / p.total) * 100) : 0;
  const showProgress = viewingLive && !!p;
  $('#progressWrap').hidden = !showProgress;
  $('#progressWrap').setAttribute('aria-valuenow', String(pct));
  $('#progressBar').style.width = `${pct}%`;

  const paused = mode === 'paused';
  const live = viewingLive && active.status !== 'stopped';
  $('#pauseBtn').hidden = !live;
  $('#stopBtn').hidden = !live;
  $('#showLiveBtn').hidden = !elsewhere;
  $('#renameBtn').hidden = !(session && !active);
  setButton($('#pauseBtn'), paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause');
}

export function pauseOrResume() {
  const { active } = state;
  if (!active) return;
  send({ type: active.status === 'paused' ? 'resumeCrawl' : 'pauseCrawl', crawlId: active.crawlId });
}

export function stopCrawl() {
  if (state.active) send({ type: 'stopCrawl', crawlId: state.active.crawlId });
}

export function initStatus() {
  setButton($('#stopBtn'), 'stop', 'Stop');
  setButton($('#renameBtn'), 'pencil', 'Rename');
  $('#pauseBtn').addEventListener('click', pauseOrResume);
  $('#stopBtn').addEventListener('click', stopCrawl);
  $('#showLiveBtn').addEventListener('click', () => { if (state.active) followCrawl(state.active.crawlId); });

  on('bg:crawlProgress', msg => {
    progress = msg;
    if (state.active?.crawlId === msg.crawlId) state.active.status = msg.status;
    render();
  });
  on('active', render);
  on('session', render);
  on('session-updated', render);
  render();
}
