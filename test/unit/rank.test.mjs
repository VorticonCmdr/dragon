import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRanks } from '../../src/shared/rank.js';

const NODES = ['A', 'B', 'C', 'D', 'E', 'F'];
const EDGES = [[3, 0], [3, 1], [4, 1], [4, 3], [4, 5], [5, 1], [5, 4], [1, 2], [2, 1]];

test('PageRank orders a known graph and sums to 1', async () => {
  const { byNode, stats } = await computeRanks(NODES, EDGES);
  const pr = Object.fromEntries([...byNode].map(([id, rank]) => [id, rank.pagerank]));
  assert.ok(stats.converged);
  assert.ok(Math.abs(Object.values(pr).reduce((a, b) => a + b, 0) - 1) < 1e-6);
  assert.ok(pr.B > pr.C && pr.C > pr.A && pr.A > pr.D);
  assert.equal(byNode.get('B').pagerankRank, 1);
});

test('CheiRank is PageRank of the reversed graph', async () => {
  const { byNode } = await computeRanks(NODES, EDGES);
  const reversed = await computeRanks(NODES, EDGES.map(([from, to]) => [to, from]));
  for (const id of NODES) {
    assert.ok(Math.abs(byNode.get(id).cheirank - reversed.byNode.get(id).pagerank) < 1e-9);
  }
  assert.equal(byNode.get('E').cheirankRank, 1);
});

test('a graph without links spreads the score evenly', async () => {
  const { byNode } = await computeRanks(['x', 'y'], []);
  assert.ok(Math.abs(byNode.get('x').pagerank - 0.5) < 1e-9);
});

test('an empty graph gives no ranks', async () => {
  const { byNode, stats } = await computeRanks([], []);
  assert.equal(byNode.size, 0);
  assert.equal(stats.nodes, 0);
});

test('a very large graph does not overflow the stack', async () => {
  const n = 300_000;
  const nodes = Array.from({ length: n }, (_, i) => `p${i}`);
  const edges = nodes.map((_, i) => [i, (i + 1) % n]);
  const { stats } = await computeRanks(nodes, edges);
  assert.equal(stats.nodes, n);
});
