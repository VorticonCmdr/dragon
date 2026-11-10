// Shared by the end-to-end suites: they run the built extension in Chrome for
// Testing, against local servers only. Branded Chrome ignores --load-extension.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

export const ROOT = resolve(import.meta.dirname, '../..');
export const sleep = ms => new Promise(done => setTimeout(done, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), '.cache/puppeteer/chrome');
  if (existsSync(cache)) {
    for (const version of readdirSync(cache).sort().reverse()) {
      for (const candidate of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux64/chrome',
      ]) {
        const path = join(cache, version, candidate);
        if (existsSync(path)) return path;
      }
    }
  }
  throw new Error('Chrome for Testing not found. Run: npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer, or set CHROME.');
}

// Works on a temporary copy, so tests can never leave anything in the dist/ that ships.
export async function launchExtension({ args = [], viewport = { width: 1440, height: 900 } } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'blue-dragon-e2e-'));
  const extension = join(work, 'extension');
  cpSync(join(ROOT, 'dist'), extension, { recursive: true });
  // Lets a page reach the database layer, which the build bundles away.
  cpSync(join(ROOT, 'src/db.js'), join(extension, 'db.js'));

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    pipe: true,
    enableExtensions: [extension],
    defaultViewport: viewport,
    args: ['--no-first-run', ...args],
  });
  const worker = await browser.waitForTarget(target => target.type() === 'service_worker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  return {
    browser,
    worker,
    work,
    url: path => `chrome-extension://${extensionId}/${path}`,
    close: async () => {
      await browser.close();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

// Collects errors from a page; network failures of a crawl are expected.
export function watchErrors(page, errors) {
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR', error.message); });
  page.on('console', message => {
    if (message.type() === 'error' && !/ERR_|Failed to load/.test(message.text())) {
      errors.push(message.text());
      console.log('CONSOLE ERROR', message.text().slice(0, 300));
    }
  });
}

export function createChecks() {
  const results = [];
  const warnings = [];
  return {
    ok(name, passed, detail = '') {
      results.push(!!passed);
      console.log(passed ? '  ✓' : '  ✗ FAIL', name, passed ? '' : detail);
    },
    // Timing depends on the machine's load: reported, but no reason to fail.
    warn(name, passed, detail = '') {
      if (passed) { console.log('  ✓', name); return; }
      warnings.push(name);
      console.log('  ! SLOW', name, detail);
    },
    finish() {
      const passed = results.filter(Boolean).length;
      console.log(`\n${passed}/${results.length} passed${warnings.length ? `, ${warnings.length} timing warnings` : ''}`);
      return passed === results.length;
    },
  };
}

export const axeSource = () => readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
