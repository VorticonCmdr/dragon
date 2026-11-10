// The rank charts on a real crawl of the demo shop: before and after ranking,
// read-outs, grid and keyboard filters, reload, accessibility, list crawls.

import { DEMO_ARGS, startDemoSite } from './demo-site.mjs';
import { axeSource, createChecks, launchExtension, sleep, watchErrors } from './helpers.mjs';

const errors = [];
const { ok, ...checks } = createChecks();
const srv = await startDemoSite();
const { browser, url, close } = await launchExtension({ args: DEMO_ARGS });
const page=await browser.newPage();
watchErrors(page, errors);
await page.goto(url('dragon.html')); await page.waitForSelector('#crawlBtn'); await sleep(500);
await page.evaluate(()=>document.documentElement.dataset.theme='light');
await page.type('#startUrl','http://shop.example/');
await page.click('#crawlBtn');
await page.waitForFunction(()=>document.querySelector('#statusbar').dataset.state==='done',{timeout:60000}); await sleep(1000);
await page.click('#tab-overview'); await sleep(400);
ok('no rank charts before ranking', await page.$eval('#panelOverview',p=>!p.querySelector('.rank-charts')&&p.textContent.includes('Link authority')));
await page.evaluate(()=>[...document.querySelectorAll('#panelOverview .btn')].find(b=>b.textContent.includes('Rank pages')).click());
await page.waitForFunction(()=>document.querySelector('#rankBtnLabel').textContent==='Recalculate ranks',{timeout:20000}); await sleep(600);
await page.click('#tab-overview'); await sleep(500);
const titles=await page.$$eval('.rank-card .card-title',a=>a.map(x=>x.textContent));
ok('five chart groups', JSON.stringify(titles)===JSON.stringify(['By level','By site section','What kind of pages hold the rank','How the rank is spread','Authorities and hubs']), titles);
ok('4 line + 2 histogram + 1 concentration + grid', await page.$$eval('.rank-charts .chartbox svg',a=>a.length)===8, await page.$$eval('.rank-charts .chartbox svg',a=>a.length));
ok('level table rows', await page.$$eval('.rank-table tbody tr',a=>a.length)>=3);
const lastTot=await page.$$eval('.rank-table tbody tr',a=>[...a.at(-1).children].slice(-2).map(c=>c.textContent));
ok('rank totals reach 100%', lastTot.every(t=>t==='100.0%'), lastTot);
ok('sections listed', await page.$$eval('.rank-card:nth-child(2) .barrows tr',a=>a.length)>=5);
ok('kinds listed', await page.$eval('.rank-card:nth-child(3)',c=>c.textContent.includes('Indexable')&&c.textContent.includes('Redirect')&&c.textContent.includes('Client error')));
ok('spread sentence has numbers', /strongest 1% of the ranked pages hold \d/.test(await page.$eval('.rank-card:nth-child(4) .rank-note',e=>e.textContent)));
for (const width of [1440, 1280]) {
  await page.setViewport({width,height:900}); await sleep(350);
  const tops=await page.$$eval('.chartgrid-3 .chart',a=>a.map(c=>Math.round(c.getBoundingClientRect().top)));
  ok(`no lone chart at ${width} px`, new Set(tops).size===1, tops);
  const sizes=await page.$$eval('.rank-charts .tick:not([transform])',a=>a.map(t=>t.getBoundingClientRect().height));
  ok(`chart text keeps one size at ${width} px`, Math.max(...sizes)-Math.min(...sizes)<2, [Math.min(...sizes),Math.max(...sizes)]);
}
await page.setViewport({width:1000,height:900}); await sleep(350);
const narrow=await page.$$eval('.chartgrid-3 .chart',a=>a.map(c=>Math.round(c.getBoundingClientRect().width)));
ok('narrow: the last chart takes its own row in full', narrow[2]>narrow[0]*1.5, narrow);
await page.setViewport({width:1440,height:900}); await sleep(350);
const svgLine=await page.$('.rank-charts .chartbox svg'); await svgLine.scrollIntoView(); const box=await svgLine.boundingBox();
await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await sleep(150);
const tip=await page.$eval('.rank-charts .charttip:not([hidden])',e=>e.textContent).catch(()=>null);
ok('hover read-out on line chart', tip&&tip.includes('Level')&&tip.includes('HTML pages'), tip);
await page.mouse.move(5,5); await sleep(100);
ok('read-out hides on leave', await page.$$eval('.rank-charts .charttip:not([hidden])',a=>a.length)===0);
// grid: click a populated quadrant cell
const pick=await page.evaluate(()=>{const r=[...document.querySelectorAll('rect[data-col]')].find(x=>+x.dataset.col>=15&&x.style.cursor==='pointer');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,c:+r.dataset.col,r:+r.dataset.row}});
await sleep(150); await page.mouse.move(pick.x,pick.y); await sleep(120);
const gt=await page.$eval('.rank-charts .charttip:not([hidden])',e=>e.textContent).catch(()=>null);
ok('grid read-out', gt&&gt.includes('PageRank percentile'), gt);
await page.mouse.click(pick.x,pick.y); await sleep(600);
ok('grid click filters Pages', await page.$eval('#tab-pages',t=>t.getAttribute('aria-selected')==='true') && await page.$eval('#quickFilters',q=>/Authorities/.test(q.textContent)), await page.$eval('#quickFilters',q=>q.textContent));
const n=await page.$$eval('#pagesTable .tabulator-row',a=>a.length); ok('filtered rows shown', n>0&&n<40, n);
await page.click('#tab-overview'); await sleep(400);
const label=await page.evaluate(()=>{const c=[...document.querySelectorAll('.rank-quadrants .chip')].filter(c=>!c.disabled).at(-1);c.focus();return c.textContent.replace(/\s*\d+$/,'')});
ok('a zero quadrant button is disabled', await page.$$eval('.rank-quadrants .chip',a=>a.filter(c=>c.disabled).every(c=>/\D0$/.test(c.textContent))));
await page.keyboard.press('Enter'); await sleep(500);
ok('keyboard path to quadrant list', await page.$eval('#quickFilters',(q,l)=>q.textContent.includes(l),label), label);
await page.evaluate(()=>[...document.querySelectorAll('#quickFilters .chip')].at(0).click());
await page.setViewport({width:1440,height:2900}); await page.click('#tab-overview'); await sleep(500);
await page.evaluate(()=>{document.querySelector('#toasts').replaceChildren();document.querySelector('#panelOverview').scrollTop=0});
await page.evaluate(()=>document.documentElement.dataset.theme='light'); await sleep(200);
await page.evaluate(()=>document.documentElement.dataset.theme='dark'); await sleep(300);
await page.setViewport({width:1440,height:900});
await page.evaluate(axeSource());
const audit=async l=>{const v=await page.evaluate(async()=>{const r=await axe.run('#panelOverview',{runOnly:['wcag2a','wcag2aa','wcag21aa'],resultTypes:['violations']});return r.violations.map(x=>({id:x.id,n:x.nodes.length,ex:x.nodes.slice(0,2).map(n=>n.target.join(' ')+' :: '+(n.any[0]?.message||'').slice(0,110))}))});ok(`axe ${l}`,v.length===0,JSON.stringify(v,null,1))};
await audit('rank charts dark');
await page.evaluate(()=>document.documentElement.dataset.theme='light'); await sleep(200); await audit('rank charts light');
const t1=await page.$eval('.rank-table tbody tr td',e=>e.textContent);
await page.reload(); await page.waitForSelector('#crawlBtn'); await sleep(500);
await page.click('#savedBtn'); await sleep(300);
await page.evaluate(()=>document.querySelector('.saved-open').click());
await page.waitForFunction(()=>+document.querySelector('#countPages').textContent>40,{timeout:20000}); await sleep(600);
await page.click('#tab-overview'); await sleep(500);
ok('charts back after reload without recalculating', await page.$eval('#panelOverview',p=>!!p.querySelector('.rank-charts'))&&(await page.$eval('.rank-table tbody tr td',e=>e.textContent))===t1);
// list crawl: no levels
await page.$eval('input[name=source][value=list]',e=>e.click());
await page.$eval('#urlList',e=>{e.value='http://shop.example/\nhttp://shop.example/about\nhttp://shop.example/contact';e.dispatchEvent(new Event('input',{bubbles:true}))}); await sleep(300);
await page.click('#crawlBtn'); await sleep(400);
await page.waitForFunction(()=>document.querySelector('#statusbar').dataset.state==='done',{timeout:30000}); await sleep(900);
await page.click('#rankBtn').catch(()=>{}); 
await page.waitForFunction(()=>document.querySelector('#rankBtnLabel').textContent==='Recalculate ranks',{timeout:10000}); await sleep(500);
await page.click('#tab-overview'); await sleep(500);
ok('list crawl explains there are no levels', await page.$eval('.rank-charts',c=>c.textContent.includes('has no levels')));

const passed = checks.finish();
await close();
srv.closeAllConnections();
srv.close();
process.exit(passed && !errors.length ? 0 : 1);
