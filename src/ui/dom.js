// Small DOM helpers. Everything from a crawled site is set as text or as a
// property here, never parsed as HTML: pages are untrusted input.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export const formatNumber = n => (n ?? 0).toLocaleString('en-US');

export function formatBytes(bytes) {
  if (!bytes) return '–';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return 'under a minute left';
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min left`;
  return `~${(seconds / 3600).toFixed(1)} h left`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Leading and trailing: runs at most once per interval, always with fresh state.
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  return () => {
    if (timer) return;
    const wait = Math.max(0, ms - (Date.now() - last));
    timer = setTimeout(() => { timer = null; last = Date.now(); fn(); }, wait);
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  el('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
