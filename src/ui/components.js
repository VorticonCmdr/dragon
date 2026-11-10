// Accessible behaviours shared by all pages: dialogs, popovers, tabs, toasts.

import { $, $$, el, icon } from './dom.js';

// ── Dialogs ─────────────────────────────────────────────────────────────────

export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

export function initDialogs(root = document) {
  $$('[data-dialog-close]', root).forEach(button => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  $$('dialog', root).forEach(dialog => {
    // Only a press that starts on the backdrop closes: selecting text in an
    // input and releasing outside the dialog must not.
    let pressedBackdrop = false;
    dialog.addEventListener('pointerdown', e => { pressedBackdrop = e.target === dialog; });
    dialog.addEventListener('click', e => {
      if (e.target === dialog && pressedBackdrop) dialog.close();
    });
  });
}

// ── Popovers ────────────────────────────────────────────────────────────────

export function bindPopover(button, panel, { onOpen } = {}) {
  button.setAttribute('aria-expanded', 'false');
  const close = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
    if (opening) onOpen?.();
  });
  document.addEventListener('pointerdown', e => {
    if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) close();
  });
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    button.focus();
  });
  return close;
}

// ── Tabs (WAI-ARIA pattern: arrow keys move, one tab stop) ─────────────────

export function initTabs(tablist, { onChange }) {
  const tabs = $$('[role="tab"]', tablist);
  const select = (tab, focus = false) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
    onChange?.(tab.dataset.tab);
  };
  tablist.addEventListener('click', e => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) select(tab);
  });
  tablist.addEventListener('keydown', e => {
    const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    if (e.key in moves) {
      e.preventDefault();
      select(tabs[(index + moves[e.key] + tabs.length) % tabs.length], true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      select(e.key === 'Home' ? tabs[0] : tabs.at(-1), true);
    }
  });
  return { select: name => select(tabs.find(tab => tab.dataset.tab === name) ?? tabs[0]) };
}

// ── Toasts ──────────────────────────────────────────────────────────────────

const TOAST_ICONS = { info: 'info', error: 'alert', success: 'check' };

export function toast(message, type = 'info', { action, duration = 5000 } = {}) {
  const region = $('#toasts');
  if (!region) return;
  const dismiss = () => node.remove();
  const node = el('div', { class: `toast toast-${type}` },
    icon(TOAST_ICONS[type] ?? 'info'),
    el('span', { class: 'toast-text' }, message),
    action && el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => { dismiss(); action.run(); },
    }, action.label),
    el('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onclick: dismiss }, icon('x')),
  );
  region.append(node);
  if (type !== 'error') setTimeout(dismiss, duration);
}
