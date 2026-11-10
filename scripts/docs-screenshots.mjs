// Retakes the images in docs/screenshots from a crawl of the demo shop.
// install.png shows the Chrome Web Store and is not generated.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_ARGS, startDemoSite } from '../test/e2e/demo-site.mjs';
import { ROOT, launchExtension, sleep } from '../test/e2e/helpers.mjs';

const OUT = join(ROOT, 'docs/screenshots');
const srv = await startDemoSite();
const { browser, url, close } = await launchExtension({
  args: DEMO_ARGS,
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();

function report(name) {
  console.log(name, `${Math.round(statSync(join(OUT, name)).size / 1024)} KB`);
}

async function shot(name) {
  await page.mouse.move(640, 5);
  await sleep(150);
  await page.screenshot({ path: join(OUT, name) });
  report(name);
}

async function shotOf(index, name) {
  const card = (await page.$$('.rank-card'))[index];
  await card.screenshot({ path: join(OUT, name) });
  report(name);
}

const toggleRail = async () => {
  await page.$eval('#railToggle', button => button.click());
  await sleep(350);
};
const clearToasts = () => page.evaluate(() => document.querySelector('#toasts').replaceChildren());
const openOverview = async () => {
  await page.click('#tab-overview');
  await sleep(450);
};

await page.goto(url('dragon.html'));
await page.waitForSelector('#crawlBtn');
await sleep(600);
await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

await page.type('#startUrl', 'http://shop.example/');
await page.$eval('#fetchOutbound', box => box.click());
await page.$eval('#startUrl', input => input.blur());
await sleep(200);
await shot('crawl-setup.png');

await page.click('#crawlBtn');
await page.waitForFunction(() => Number(document.querySelector('#countPages').textContent) >= 16, { timeout: 20_000 });
await shot('crawl-running.png');
await page.waitForFunction(() => document.querySelector('#statusbar').dataset.state === 'done', { timeout: 60_000 });
await sleep(1200);
await clearToasts();

await toggleRail();
await shot('results.png');
await toggleRail();

await openOverview();
await shot('overview.png');

await page.click('#tab-issues');
await sleep(400);
await page.click('.issue summary');
await sleep(250);
await shot('issues.png');

await page.click('#tab-pages');
await sleep(500);
await toggleRail();
await page.evaluate(() => [...document.querySelectorAll('#pagesTable .url-cell')].find(cell => cell.title.endsWith('/old-sale')).click());
await page.waitForSelector('#drawer:not([hidden])');
await sleep(350);
await shot('detail.png');
await page.keyboard.press('Escape');
await toggleRail();

await page.click('#rankBtn');
await page.waitForFunction(() => document.querySelector('#rankBtnLabel').textContent === 'Recalculate ranks', { timeout: 20_000 });
await sleep(400);
await clearToasts();
await openOverview();
await shotOf(0, 'rank-levels.png');
await shotOf(3, 'rank-spread.png');
await shotOf(4, 'rank-quadrants.png');

await page.evaluate(() => {
  document.documentElement.dataset.theme = 'dark';
  document.querySelector('#panelOverview').scrollTop = 0;
});
await sleep(400);
await shot('dark.png');

await close();
srv.closeAllConnections();
srv.close();
process.exit(0);
