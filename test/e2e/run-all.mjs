// Runs the suites one after another: they share local ports and a time budget.
// `node test/e2e/run-all.mjs rank ui` runs a selection.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const SUITES = ['engine', 'ui', 'imports', 'rank', 'rank-charts'];
const TIME_LIMIT_MS = 180_000;
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : SUITES;

function run(suite) {
  return new Promise(done => {
    console.log(`\n=== ${suite}`);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, `${suite}.mjs`)], { stdio: 'inherit' });
    const timer = setTimeout(() => {
      console.log(`${suite} exceeded its time limit`);
      child.kill('SIGKILL');
    }, TIME_LIMIT_MS);
    child.on('exit', code => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}

const failed = [];
for (const suite of chosen) {
  if (!(await run(suite))) failed.push(suite);
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : '\nAll suites passed.');
process.exit(failed.length ? 1 : 0);
