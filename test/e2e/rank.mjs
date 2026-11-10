// PageRank and CheiRank on a known 2,000-page graph: correct leaders, nofollow and
// external pages left out, table, details, overview, CSV, and surviving a reload.

import fs from 'node:fs';
import { join } from 'node:path';
import { createChecks, launchExtension, sleep, watchErrors } from './helpers.mjs';

const errors = [];
const { ok, ...checks } = createChecks();
const { browser, url, work, close } = await launchExtension();
const dl = join(work, 'downloads');
fs.mkdirSync(dl);
const page=await browser.newPage();
watchErrors(page, errors);
await page.goto(url('dragon.html')); await page.waitForSelector('#crawlBtn'); await sleep(400);
// seed: 2000-page site, hub /hub links to everything; /sink is linked by all; nofollow edges to /nf
await page.evaluate(async()=>{
  const r=await new Promise(res=>{const q=indexedDB.open('blue-dragon');q.onsuccess=()=>res(q.result)});
  const id='crawl-1700000000001'; const N=2000; const u=i=>`https://r.test/p/${i}`;
  const t=r.transaction(['crawls','pages'],'readwrite');
  t.objectStore('crawls').put({id,name:'ranktest',createdAt:new Date().toISOString(),status:'done',schemaVersion:2,source:{type:'manual'},startURL:'https://r.test/',settings:{},counts:{crawled:N+3}},id);
  const P=(url,links,extra={})=>t.objectStore('pages').put({crawlId:id,url,depth:1,indexable:true,title:url,fetch:{status:200,ok:true,contentType:'text/html',duration:100},links,...extra});
  for(let i=0;i<N;i++)P(u(i),[{url:'https://r.test/sink',follow:'follow',internal:true},{url:'https://r.test/nf',follow:'nofollow',internal:true},{url:u((i+1)%N),follow:'follow',internal:true},{url:'https://ext.test/x',follow:'follow',internal:false}]);
  P('https://r.test/hub',Array.from({length:N},(_,i)=>({url:u(i),follow:'follow',internal:true})));
  P('https://r.test/sink',[]); P('https://r.test/nf',[]);
  P('https://ext.test/x',[],{isOutbound:true});
  await new Promise(res=>t.oncomplete=res)});
await page.click('#savedBtn'); await sleep(300);
await page.evaluate(()=>[...document.querySelectorAll('.saved-open')].find(b=>b.textContent.startsWith('ranktest')).click());
await page.waitForFunction(()=>document.querySelector('#countPages').textContent==='2,004',{timeout:20000}); await sleep(500);
ok('rank button visible + enabled for finished crawl', await page.$eval('#rankBtn',b=>!b.hidden&&!b.disabled&&b.textContent.includes('Rank pages')));
const t0=Date.now();
await page.click('#rankBtn');
await page.waitForFunction(()=>document.querySelector('#rankBtnLabel').textContent==='Recalculate ranks',{timeout:30000});
console.log('   ranked in',Date.now()-t0,'ms');
const meta=await page.evaluate(async()=>{const r=await new Promise(res=>{const q=indexedDB.open('blue-dragon');q.onsuccess=()=>res(q.result)});return new Promise(res=>{const g=r.transaction('crawls').objectStore('crawls').get('crawl-1700000000001');g.onsuccess=()=>res(g.result.ranking)})});
ok('ranking persisted in meta', meta?.nodes===2003&&meta.edges===4000+2000&&meta.converged, JSON.stringify(meta));
const pg=await page.evaluate(async()=>{const r=await new Promise(res=>{const q=indexedDB.open('blue-dragon');q.onsuccess=()=>res(q.result)});const g=u=>new Promise(res=>{const x=r.transaction('pages').objectStore('pages').get(['crawl-1700000000001',u]);x.onsuccess=()=>res(x.result.rank)});return {sink:await g('https://r.test/sink'),hub:await g('https://r.test/hub'),nf:await g('https://r.test/nf'),p0:await g('https://r.test/p/0'),ext:await g('https://ext.test/x')}});
ok('sink = PageRank #1, hub = CheiRank #1', pg.sink.pagerankRank===1&&pg.hub.cheirankRank===1, JSON.stringify(pg));
ok('nofollow target not boosted', pg.nf.pagerank<pg.p0.pagerank, JSON.stringify([pg.nf,pg.p0]));
ok('external page not ranked', pg.ext===undefined);
const firstRow=await page.$eval('#pagesTable .tabulator-row .url-cell',e=>e.title);
ok('table sorted by PageRank, sink first', firstRow==='https://r.test/sink', firstRow);
const cells=await page.$$eval('#pagesTable .tabulator-cell[tabulator-field=pagerank]',c=>c.slice(0,3).map(x=>x.textContent));
ok('PageRank column shown, relative score 100 first', cells[0]==='100', cells);
await page.evaluate(()=>document.querySelector('#pagesTable .url-cell').click()); await sleep(300);
ok('detail shows ranking', await page.$eval('#drawer',d=>d.textContent.includes('PageRank')&&d.textContent.includes('#1 of 2,003')));
await page.keyboard.press('Escape');
await page.click('#tab-overview'); await sleep(400);
ok('overview shows top lists', await page.$eval('#panelOverview',p=>p.textContent.includes('Top pages by PageRank')&&p.querySelectorAll('.top-row').length===20));
const cdp=await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dl});
await page.click('#tab-pages'); await sleep(300); await page.click('#exportCsvBtn'); await sleep(1500);
const csv=fs.readFileSync(join(dl,fs.readdirSync(dl)[0])).toString().split('\n');
const unq=l=>l.replace(/^\uFEFF/,'').split(',').map(x=>x.replace(/^"|"$/g,'')); const hi=unq(csv[0]).indexOf('PageRank'); const first=unq(csv[1]);
ok('csv has relative PageRank', hi>0&&first[hi]==='100', [csv[0].slice(0,120),first[hi]]);
await page.reload(); await page.waitForSelector('#crawlBtn'); await sleep(500);
await page.click('#savedBtn'); await sleep(300);
await page.evaluate(()=>[...document.querySelectorAll('.saved-open')].find(b=>b.textContent.startsWith('ranktest')).click());
await page.waitForFunction(()=>document.querySelector('#countPages').textContent==='2,004',{timeout:20000}); await sleep(600);
ok('after reload: button says recalculate, column still visible', await page.$eval('#rankBtnLabel',e=>e.textContent==='Recalculate ranks') && await page.$$eval('#pagesTable .tabulator-cell[tabulator-field=pagerank]',c=>c.length>0));

const passed = checks.finish();
await close();
process.exit(passed && !errors.length ? 0 : 1);
