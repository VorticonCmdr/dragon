import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percentiles, sectionOf, summariseRanks } from '../../src/shared/rankSummary.js';

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
const row = (href, fields) => ({
  href, depth: 1, isOutbound: false, indexable: true, fetch_status: 200, fetch_redirected: false,
  canonical: '', fetch_contentType: 'text/html', pagerank: null, cheirank: null, ...fields,
});
const ROWS = [
  row('https://a.b/', { depth: 0, pagerank: 0.4, cheirank: 0.1 }),
  row('https://a.b/blog/1', { pagerank: 0.3, cheirank: 0.2 }),
  row('https://a.b/blog/2', { pagerank: 0.1, cheirank: 0.3, indexable: false }),
  row('https://a.b/gone', { fetch_status: 404, indexable: false, pagerank: 0.05, cheirank: 0.05 }),
  row('https://a.b/r', { fetch_redirected: true, pagerank: 0.05, cheirank: 0.05 }),
  row('https://a.b/c', { canonical: 'https://a.b/', pagerank: 0.05, cheirank: 0.2, depth: 2 }),
  row('https://a.b/f.pdf', { fetch_contentType: 'application/pdf', indexable: false, pagerank: 0.05, cheirank: 0.1, depth: 2 }),
  row('https://x.y/', { isOutbound: true }),
  row('https://a.b/blocked', { blockedByRobots: true, fetch_status: null, fetch_contentType: '' }),
];

test('percentile ties share the lowest', () => {
  assert.deepEqual([...percentiles([3, 1, 1, 2])], [75, 0, 0, 50]);
  assert.deepEqual([...percentiles([5])], [0]);
});

test('a section is the first folder', () => {
  assert.equal(sectionOf('https://a.b/'), 'Top level');
  assert.equal(sectionOf('https://a.b/about'), 'Top level');
  assert.equal(sectionOf('https://a.b/blog/'), '/blog/');
  assert.equal(sectionOf('https://a.b/blog/x/y'), '/blog/');
});

test('only ranked pages count, each in its first matching kind', () => {
  const s = summariseRanks(ROWS);
  assert.equal(s.ranked, 7);
  assert.deepEqual(s.kinds.map(kind => kind.name), ['Client error (4xx)', 'Redirect', 'Canonicalised', 'Not HTML', 'Noindex', 'Indexable']);
  near(s.kinds.reduce((sum, kind) => sum + kind.pagerank, 0), 1);
  assert.deepEqual(s.sections.map(section => section.name), ['Top level', '/blog/']);
});

test('levels run up to 100%', () => {
  const { levels } = summariseRanks(ROWS);
  assert.deepEqual(levels.map(level => level.level), [0, 1, 2]);
  near(levels.at(-1).pagerankTotal, 1);
  near(levels.at(-1).cheirankTotal, 1);
  near(levels.at(-1).shareTotal, 1);
});

test('the concentration curve rises from 0 to 1', () => {
  const curve = summariseRanks(ROWS).pagerankConcentration;
  assert.equal(curve.length, 101);
  near(curve[0], 0);
  near(curve[100], 1);
  curve.slice(1).forEach((value, k) => assert.ok(value >= curve[k]));
});

test('histogram and grid hold every ranked page', () => {
  const s = summariseRanks(ROWS);
  assert.equal(s.grid.flat().reduce((a, b) => a + b, 0), 7);
  assert.equal(s.pagerankHistogram.reduce((sum, bucket) => sum + bucket.pages, 0), 7);
  near(s.pagerankHistogram.reduce((sum, bucket) => sum + bucket.share, 0), 1);
});

test('a rank of 0 joins the lowest histogram step', () => {
  const s = summariseRanks([
    row('https://a.b/1', { pagerank: 0, cheirank: 0.5 }),
    row('https://a.b/2', { pagerank: 0.5, cheirank: 0.25 }),
    row('https://a.b/3', { pagerank: 0.5, cheirank: 0.25 }),
  ]);
  assert.equal(s.pagerankHistogram.reduce((sum, bucket) => sum + bucket.pages, 0), 3);
});

test('more than twelve sections fold into Other sections', () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`https://a.b/s${i}/p`, { pagerank: 0.05, cheirank: 0.05 }));
  const { sections } = summariseRanks(rows);
  assert.equal(sections.length, 13);
  assert.equal(sections.at(-1).name, 'Other sections');
  near(sections.reduce((sum, section) => sum + section.pagerank, 0), 1);
});
