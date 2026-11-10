// Command palette: every action in one searchable list, for the keyboard.

import { openDialog } from './components.js';
import { $, el } from './dom.js';

let actions = () => [];
let visible = [];
let selected = 0;

function score(action, query) {
  const label = action.label.toLowerCase();
  if (!query) return 1;
  if (label.startsWith(query)) return 3;
  if (label.split(' ').some(word => word.startsWith(query))) return 2;
  return label.includes(query) ? 1 : 0;
}

function select(index) {
  if (!visible.length) return;
  selected = (index + visible.length) % visible.length;
  const items = [...$('#paletteList').children];
  items.forEach((item, i) => item.setAttribute('aria-selected', String(i === selected)));
  items[selected].scrollIntoView({ block: 'nearest' });
  $('#paletteInput').setAttribute('aria-activedescendant', items[selected].id);
}

function run(action) {
  $('#paletteDialog').close();
  action.run();
}

function render() {
  const query = $('#paletteInput').value.trim().toLowerCase();
  visible = actions()
    .map(action => ({ action, rank: score(action, query) }))
    .filter(entry => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .map(entry => entry.action);
  const list = $('#paletteList');
  if (!visible.length) {
    list.replaceChildren(el('li', { class: 'palette-empty' }, 'No matching action'));
    return;
  }
  list.replaceChildren(...visible.map((action, i) => el('li', {
    id: `palette-${i}`,
    class: 'palette-item',
    role: 'option',
    'aria-selected': 'false',
    onclick: () => run(action),
  }, el('span', {}, action.label), action.hint ? el('kbd', {}, action.hint) : null)));
  select(0);
}

export function openPalette() {
  $('#paletteInput').value = '';
  render();
  openDialog($('#paletteDialog'));
  $('#paletteInput').focus();
}

export function initPalette(getActions) {
  actions = getActions;
  $('#paletteInput').addEventListener('input', render);
  $('#paletteInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(selected + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(selected - 1); }
    else if (e.key === 'Enter' && visible[selected]) { e.preventDefault(); run(visible[selected]); }
  });
}
