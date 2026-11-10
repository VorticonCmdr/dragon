// Long-lived connection to the service worker. It reconnects by itself: the
// worker can restart at any time, and a crawl keeps running across that.

import { emit } from './store.js';

const MAX_BACKOFF_MS = 10_000;

let port = null;
let attempts = 0;

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'dragon-ui' });
  } catch {
    retry();
    return;
  }
  port.onMessage.addListener(msg => {
    attempts = 0;
    emit(`bg:${msg.type}`, msg);
  });
  port.onDisconnect.addListener(() => {
    port = null;
    retry();
  });
}

function retry() {
  const wait = Math.min(500 * 2 ** attempts++, MAX_BACKOFF_MS);
  setTimeout(() => { if (!port) connect(); }, wait);
}

export function initPort() {
  connect();
}

export function send(msg) {
  if (!port) connect();
  try {
    port.postMessage(msg);
  } catch {
    port = null;
    connect();
    port?.postMessage(msg);
  }
}

export async function request(msg) {
  const response = await chrome.runtime.sendMessage(msg);
  if (!response?.ok) throw new Error(response?.error ?? 'No response from the background worker');
  return response;
}
