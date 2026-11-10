// PageRank and CheiRank of the internal link graph, by power iteration.
//
// PageRank scores a page by the pages that link to it; CheiRank is PageRank
// of the reversed graph, so it scores a page by what it links out to. Both
// use the standard random-surfer model with a damping factor, and dangling
// pages (no links out) spread their score evenly, so the scores sum to 1.

export const RANK_DEFAULTS = Object.freeze({ damping: 0.85, maxIterations: 200, tolerance: 1e-8 });

// Edges in compressed form: for each target, the sources that point to it.
function compile(n, edges, reverse) {
  const outDegree = new Uint32Array(n);
  const inCount = new Uint32Array(n);
  for (const [from, to] of edges) {
    const [src, dst] = reverse ? [to, from] : [from, to];
    outDegree[src]++;
    inCount[dst]++;
  }
  const inStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) inStart[i + 1] = inStart[i] + inCount[i];
  const inSource = new Uint32Array(edges.length);
  const fill = inStart.slice(0, n);
  for (const [from, to] of edges) {
    const [src, dst] = reverse ? [to, from] : [from, to];
    inSource[fill[dst]++] = src;
  }
  return { outDegree, inStart, inSource };
}

async function iterate(n, graph, { damping, maxIterations, tolerance, onProgress }) {
  const { outDegree, inStart, inSource } = graph;
  let scores = new Float64Array(n).fill(1 / n);
  let next = new Float64Array(n);
  const base = (1 - damping) / n;
  let iterations = 0;
  let converged = false;

  while (iterations < maxIterations) {
    iterations++;
    let dangling = 0;
    for (let i = 0; i < n; i++) if (outDegree[i] === 0) dangling += scores[i];
    const shared = base + (damping * dangling) / n;

    let delta = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = inStart[i]; k < inStart[i + 1]; k++) {
        const src = inSource[k];
        sum += scores[src] / outDegree[src];
      }
      next[i] = shared + damping * sum;
      delta += Math.abs(next[i] - scores[i]);
    }
    [scores, next] = [next, scores];
    if (delta < tolerance) { converged = true; break; }
    // Yield between iterations, so a large graph never freezes the page.
    if (iterations % 5 === 0) {
      onProgress?.(iterations);
      await new Promise(resolve => setTimeout(resolve));
    }
  }
  return { scores, iterations, converged };
}

function positions(scores) {
  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
  const rank = new Uint32Array(scores.length);
  order.forEach((index, position) => { rank[index] = position + 1; });
  return rank;
}

// Not Math.max(...scores): spreading a large array overflows the call stack.
function largest(scores) {
  return scores.reduce((max, score) => Math.max(max, score), 0);
}

// `nodes`: array of ids. `edges`: [fromIndex, toIndex] pairs, already deduplicated.
export async function computeRanks(nodes, edges, options = {}) {
  const settings = { ...RANK_DEFAULTS, ...options };
  const n = nodes.length;
  if (!n) return { byNode: new Map(), stats: { nodes: 0, edges: 0 } };

  const forward = await iterate(n, compile(n, edges, false), settings);
  const backward = await iterate(n, compile(n, edges, true), settings);
  const pagerankRank = positions(forward.scores);
  const cheirankRank = positions(backward.scores);

  const byNode = new Map();
  for (let i = 0; i < n; i++) {
    byNode.set(nodes[i], {
      pagerank: forward.scores[i],
      cheirank: backward.scores[i],
      pagerankRank: pagerankRank[i],
      cheirankRank: cheirankRank[i],
    });
  }
  return {
    byNode,
    stats: {
      nodes: n,
      edges: edges.length,
      damping: settings.damping,
      iterations: Math.max(forward.iterations, backward.iterations),
      converged: forward.converged && backward.converged,
      maxPagerank: largest(forward.scores),
      maxCheirank: largest(backward.scores),
    },
  };
}
