// Shared UI state and a minimal event bus. Views subscribe to events rather
// than calling each other, so no view needs to know which others exist.

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach(handler => handler(payload));
}

export const state = {
  settings: null,
  active: null,        // Live crawl according to the service worker, or null.
  session: null,       // The crawl being looked at. May differ from `active`.
  tab: 'pages',
  view: 'results',     // 'results' | 'schedules'
  pendingStartId: null,
};
