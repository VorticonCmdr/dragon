// Small SVG charts, drawn by hand: lines over categories, horizontal bars per
// group, a histogram and a grid of cells. Each has a hover read-out, and colours
// are CSS variables, so charts follow the theme.

import { el } from './dom.js';

const W = 480;
const H = 210;
const M = { l: 46, r: 12, t: 10, b: 42 };
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(Boolean));
  return node;
}

// A round number at least `v` (1, 2, 2.5 or 5 times a power of ten).
export function niceCeil(v) {
  if (!(v > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map(m => m * power).find(x => x >= v - 1e-12) ?? 10 * power;
}

// A share (0 to 1) as a percentage, with more decimals for small ones.
export function percent(v) {
  const p = v * 100;
  return `${p.toFixed(p !== 0 && p < 10 ? 2 : 1)}%`;
}

function swatch(color, dashed) {
  return el('span', { class: 'swatch', style: `border-top-color:${color};border-top-style:${dashed ? 'dashed' : 'solid'}` });
}

function legend(series) {
  if (series.length < 2) return null;
  return el('ul', { class: 'chartlegend' }, series.map(s => el('li', {}, swatch(s.color, s.dashed), s.name)));
}

function viewX(event, node) {
  const box = node.getBoundingClientRect();
  return ((event.clientX - box.left) / box.width) * W;
}

function createTip(box) {
  const tip = el('div', { class: 'charttip', hidden: true });
  box.append(tip);
  return {
    show(x, ...content) {
      tip.replaceChildren(...content);
      tip.style.left = `${Math.min(80, Math.max(20, (x / W) * 100))}%`;
      tip.hidden = false;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// SVG text scales with its chart. This cancels that out, so labels keep one size
// on screen however wide a chart is. One observer per chart: it is collected with
// the chart, while a shared one would keep every redrawn chart alive.
function keepTextSize(box, units) {
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width) box.style.setProperty('--chart-scale', units / entry.contentRect.width);
  }).observe(box);
}

function frame(title, plot, { square = false, units = W } = {}, ...after) {
  const box = el('div', { class: square ? 'chartbox square' : 'chartbox' }, plot);
  keepTextSize(box, units);
  const figure = el('figure', { class: 'chart' }, el('figcaption', {}, title), box, ...after);
  return { figure, box };
}

function scaleLines(top, y, format) {
  return [0, 0.5, 1].map(f => svg('g', {},
    svg('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: y(top * f), y2: y(top * f) }),
    svg('text', { class: 'tick', x: M.l - 6, y: y(top * f) + 4, 'text-anchor': 'end' }, format(top * f))));
}

function xTitleNode(text) {
  return text ? svg('text', { class: 'tick', x: (M.l + W - M.r) / 2, y: H - 2, 'text-anchor': 'middle' }, text) : null;
}

// Lines (optionally filled) over categories, with a crosshair read-out.
export function lineChart({ title, labels, series, format, xTitle, max, every = 0, tipTitle = label => label }) {
  const n = labels.length;
  const top = max ?? niceCeil(Math.max(0, ...series.flatMap(s => s.values.map(v => v ?? 0))));
  const x = i => (n <= 1 ? (M.l + W - M.r) / 2 : M.l + (i * (W - M.l - M.r)) / (n - 1));
  const y = v => H - M.b - (Math.min(v, top) / top) * (H - M.t - M.b);
  const step = every || Math.max(1, Math.ceil(n / 12));

  const crosshair = svg('line', { class: 'crosshair', y1: M.t, y2: H - M.b, visibility: 'hidden' });
  const lines = series.map(s => {
    const points = s.values.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)]]));
    if (!points.length) return null;
    const line = points.map(([a, b]) => `${a},${b}`).join(' ');
    return svg('g', {},
      s.area && points.length > 1
        ? svg('polygon', { points: `${points[0][0]},${y(0)} ${line} ${points.at(-1)[0]},${y(0)}`, style: `fill:${s.color};opacity:.12` })
        : null,
      svg('polyline', { points: line, class: 'series', style: `stroke:${s.color}`, 'stroke-dasharray': s.dashed ? '5 4' : undefined }),
      n <= 24 && !s.dashed ? points.map(([a, b]) => svg('circle', { cx: a, cy: b, r: 3.5, class: 'mark', style: `fill:${s.color}` })) : null);
  });

  const plot = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title },
    scaleLines(top, y, format),
    labels.map((label, i) => (i % step === 0 || i === n - 1
      ? svg('text', { class: 'tick', x: x(i), y: H - M.b + 16, 'text-anchor': 'middle' }, label)
      : null)),
    xTitleNode(xTitle),
    lines,
    crosshair);

  const { figure, box } = frame(title, plot, {}, legend(series));
  const tip = createTip(box);
  plot.addEventListener('pointermove', event => {
    if (!n) return;
    const raw = n <= 1 ? 0 : Math.round(((viewX(event, plot) - M.l) / (W - M.l - M.r)) * (n - 1));
    const i = Math.max(0, Math.min(n - 1, raw));
    crosshair.setAttribute('x1', x(i));
    crosshair.setAttribute('x2', x(i));
    crosshair.setAttribute('visibility', 'visible');
    tip.show(x(i), el('b', {}, tipTitle(labels[i])), ...series.map(s => el('div', {},
      swatch(s.color, s.dashed), `${s.name}: ${s.values[i] === null ? '–' : format(s.values[i])}`)));
  });
  plot.addEventListener('pointerleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    tip.hide();
  });
  return figure;
}

// Rows of horizontal bars: per row, one bar per measure, on one scale.
export function barRows({ labels, measures, caption }) {
  const top = Math.max(1e-9, ...measures.flatMap(m => m.values));
  const table = el('table', { class: 'barrows' }, el('tbody', {}, labels.map((label, r) => el('tr', {},
    el('th', { scope: 'row' }, label),
    el('td', {}, measures.map(m => el('div', { class: 'barline', title: `${m.name}: ${percent(m.values[r])}` },
      el('div', { class: 'bartrack' }, el('div', { class: 'bar', style: `width:${(m.values[r] / top) * 100}%;background:${m.color}` })),
      el('span', { class: 'barvalue' }, percent(m.values[r])))))))));
  return el('figure', { class: 'chart' }, el('figcaption', { class: 'sr-only' }, caption), table, legend(measures));
}

// A histogram: one column per step, touching.
export function columnChart({ title, columns, color, xTitle }) {
  const n = columns.length;
  const top = niceCeil(Math.max(0, ...columns.map(c => c.value)));
  const bw = n > 0 ? (W - M.l - M.r) / n : 0;
  const y = v => H - M.b - (v / top) * (H - M.t - M.b);
  const bars = columns.map((c, i) => (c.value > 0
    ? svg('rect', { x: M.l + i * bw + 1, y: y(c.value), width: Math.max(1, bw - 2), height: y(0) - y(c.value), rx: 2, style: `fill:${color}` })
    : null));

  const plot = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title },
    scaleLines(top, y, v => Math.round(v).toLocaleString('en-US')),
    bars,
    columns.map((c, i) => (c.tick ? svg('text', { class: 'tick', x: M.l + i * bw, y: H - M.b + 16, 'text-anchor': 'middle' }, c.label) : null)),
    xTitleNode(xTitle));

  const { figure, box } = frame(title, plot);
  const tip = createTip(box);
  const dim = hovered => bars.forEach((bar, i) => bar?.style.setProperty('opacity', hovered === null || hovered === i ? '1' : '.55'));
  plot.addEventListener('pointermove', event => {
    const i = Math.floor((viewX(event, plot) - M.l) / bw);
    if (i < 0 || i >= n) { tip.hide(); dim(null); return; }
    tip.show(M.l + (i + 0.5) * bw, columns[i].detail);
    dim(i);
  });
  plot.addEventListener('pointerleave', () => { tip.hide(); dim(null); });
  return figure;
}

// A square grid of counts, darker for more; `cells[col][row]`, row 0 at the bottom.
export function cellGrid({ title, cells, color, xTitle, yTitle, describe, onPick, lines = [], marks = [] }) {
  const S = 320;
  const m = { l: 34, b: 34, t: 6, r: 6 };
  const cols = cells.length;
  const rows = cells[0]?.length ?? 0;
  const cw = (S - m.l - m.r) / Math.max(1, cols);
  const ch = (S - m.t - m.b) / Math.max(1, rows);
  const most = Math.max(1, ...cells.flat());
  const top = row => S - m.b - (row + 1) * ch;

  const rects = cells.flatMap((column, c) => column.map((count, r) => {
    const opacity = count > 0 ? 0.15 + 0.85 * (Math.log1p(count) / Math.log1p(most)) : 1;
    const picks = onPick?.isPickable(c, r) && count > 0;
    const rect = svg('rect', {
      x: m.l + c * cw,
      y: top(r),
      width: cw,
      height: ch,
      style: `fill:${count > 0 ? color : 'transparent'};opacity:${opacity}${picks ? ';cursor:pointer' : ''}`,
    });
    rect.dataset.col = c;
    rect.dataset.row = r;
    return rect;
  }));

  const plot = svg('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': title },
    svg('rect', { x: m.l, y: m.t, width: S - m.l - m.r, height: S - m.t - m.b, class: 'gridframe' }),
    rects,
    lines.map(line => (line.x !== undefined
      ? svg('line', { class: 'divider', x1: m.l + line.x * cw, x2: m.l + line.x * cw, y1: m.t, y2: S - m.b })
      : svg('line', { class: 'divider', x1: m.l, x2: S - m.r, y1: S - m.b - line.y * ch, y2: S - m.b - line.y * ch }))),
    marks.map(mark => svg('text', { class: 'gridmark', x: m.l + mark.col * cw, y: top(mark.row) + ch, 'text-anchor': mark.anchor ?? 'start' }, mark.text)),
    [0, 50, 100].map(v => svg('g', {},
      svg('text', { class: 'tick', x: m.l + (v / 100) * cols * cw, y: S - m.b + 14, 'text-anchor': 'middle' }, String(v)),
      svg('text', { class: 'tick', x: m.l - 4, y: S - m.b - (v / 100) * rows * ch + 4, 'text-anchor': 'end' }, String(v)))),
    svg('text', { class: 'tick', x: (m.l + S - m.r) / 2, y: S - 4, 'text-anchor': 'middle' }, xTitle),
    svg('text', { class: 'tick', x: 10, y: (m.t + S - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 10 ${(m.t + S - m.b) / 2})` }, yTitle));

  const { figure, box } = frame(title, plot, { square: true, units: S });
  const tip = createTip(box);
  const cellOf = target => (target.dataset?.col === undefined ? null : [Number(target.dataset.col), Number(target.dataset.row)]);
  plot.addEventListener('pointermove', event => {
    const cell = cellOf(event.target);
    if (!cell) { tip.hide(); return; }
    tip.show(((m.l + (cell[0] + 0.5) * cw) / S) * W, describe(cell[0], cell[1], cells[cell[0]][cell[1]]));
  });
  plot.addEventListener('pointerleave', () => tip.hide());
  plot.addEventListener('click', event => {
    const cell = cellOf(event.target);
    if (cell && cells[cell[0]][cell[1]] > 0) onPick?.pick(cell[0], cell[1]);
  });
  return figure;
}
