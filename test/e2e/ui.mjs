// The interface in a real browser: rejoining crawls, validation, archive, exports,
// schedules, hostile pages, large tables, accessibility and keyboard use.

import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { axeSource, createChecks, launchExtension, sleep, watchErrors } from './helpers.mjs';
import { startSite } from './site.mjs';

const site = await startSite();
const { browser, url, work, close } = await launchExtension();
const dl = join(work, 'downloads');
fs.mkdirSync(dl);
const errors = [];
const { ok, warn, ...checks } = createChecks();
const mk = async () => {
  const created = await browser.newPage();
  watchErrors(created, errors);
  return created;
};
let page=await mk(); await page.goto(url('dragon.html')); await page.waitForSelector('#crawlBtn');
await new Promise(r=>setTimeout(r,500));
const state=()=>page.$eval('#statusbar',e=>e.dataset.state);
const waitState=(s,t=60000)=>page.waitForFunction(s=>document.querySelector('#statusbar').dataset.state===s,{timeout:t},s);
const setStorage=o=>page.evaluate(o=>chrome.storage.local.set(o),o);
const startUrl=async(u,opts={})=>{await page.$eval('#startUrl',e=>{e.value=''});await page.type('#startUrl',u);await page.click('#crawlBtn')};

console.log('Tab reopen during a crawl');
await startUrl('http://localhost:8123/slow/1');
await waitState('running');
await page.waitForFunction(()=>+document.querySelector('#countPages').textContent>0,{timeout:8000});
ok('counters update live', true);
await page.close(); await sleep(800);
page=await mk(); await page.goto(url('dragon.html')); await page.waitForSelector('#crawlBtn');
await page.waitForFunction(()=>document.querySelector('#statusbar').dataset.state==='running',{timeout:8000});
await page.waitForFunction(()=>document.querySelectorAll('#pagesTable .tabulator-row').length>3,{timeout:8000});
ok('reopened tab rejoins live crawl with rows', true);
await page.click('#pauseBtn'); await waitState('paused',5000);
ok('pause via UI, resume label', (await page.$eval('#pauseBtn',e=>e.textContent)).includes('Resume'));
await page.reload(); await page.waitForSelector('#crawlBtn');
await page.waitForFunction(()=>document.querySelector('#statusbar').dataset.state==='paused',{timeout:8000});
ok('reload keeps paused state', true);
await page.click('#stopBtn');
await waitState('stopped',8000);
ok('stop from paused via UI', await page.$eval('#crawlBtn',e=>!e.disabled));

console.log('Validation does not destroy results');
await sleep(1200); // Longer than the counters' refresh, so they have settled.
const onScreen=()=>page.evaluate(()=>[document.querySelector('#countPages').textContent,document.querySelector('#statusTitle').textContent].join('|'));
const before=await onScreen();
await page.$eval('#startUrl',e=>{e.value=''}); await page.type('#startUrl','http://exa mple'); await page.click('#crawlBtn'); await sleep(1200);
ok('invalid URL shows inline error', await page.$eval('#startUrlError',e=>!e.hidden));
ok('results kept', await onScreen()===before, [before, await onScreen()]);

console.log('Crawl-delay + override');
await setStorage({robotsOverrides:{'http://localhost:8123':'User-agent: *\nCrawl-delay: 0.4\nDisallow: /b\n'}});
site.hits.length=0; for(const k in site.hitTimes) delete site.hitTimes[k];
await page.$eval('input[name=source][value=list]',e=>e.click());
await page.$eval('#urlList',e=>{e.value=['/a','/final/page','/final/sibling','/dir/sub/x','/b','/a'].map(p=>'http://localhost:8123'+p).join('\n');e.dispatchEvent(new Event('input',{bubbles:true}))});
await sleep(400);
ok('dedupe count shown', (await page.$eval('#urlCount',e=>e.textContent)).includes('5 URLs'), await page.$eval('#urlCount',e=>e.textContent));
ok('crawl button states size', (await page.$eval('#crawlBtnLabel',e=>e.textContent))==='Crawl 5 URLs');
await page.click('#crawlBtn'); await waitState('running',5000); await waitState('done',20000);
const t=Object.values(site.hitTimes).map(a=>a[0]).sort((a,b)=>a-b);
const gaps=t.slice(1).map((x,i)=>x-t[i]);
ok('crawl-delay spaced requests', gaps.length>=3&&gaps.every(g=>g>=370), gaps);
ok('override blocks /b, no robots.txt fetch', !site.hits.some(h=>/ \/b$/.test(h))&&!site.hits.some(h=>h.includes('robots.txt')), site.hits);
await setStorage({robotsOverrides:{}});

console.log('Archive: OPFS, preview, ZIP, delete');
await page.$eval('#opfsEnabled',e=>e.click()); await sleep(500);
await page.$eval('#urlList',e=>{e.value='http://localhost:8123/a\nhttp://localhost:8123/b';e.dispatchEvent(new Event('input',{bubbles:true}))});
await sleep(300);
await page.click('#crawlBtn'); await sleep(300); await waitState('done',15000); await sleep(800);
const opfs=await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();const a=await root.getDirectoryHandle('crawl_archive');const out=[];for await(const [n,d] of a.entries()){for await(const [f] of d.entries())out.push(n+'/'+f)}return out});
ok('html archived with hashed names', opfs.length===2&&/^[0-9a-f]{16}-localhost/.test(opfs[0].split('/')[1]), opfs);
await page.evaluate(()=>document.querySelector('#pagesTable .url-cell').click());
await page.waitForSelector('#drawer:not([hidden])'); await sleep(200);
await page.evaluate(()=>[...document.querySelectorAll('#drawer .btn')].find(b=>b.textContent.includes('Preview')).click());
await sleep(400);
const frame=await page.$eval('#previewFrame',f=>({sandbox:f.getAttribute('sandbox'),len:f.srcdoc.length,open:f.closest('dialog').open}));
ok('preview in fully sandboxed frame', frame.open&&frame.sandbox===''&&frame.len>50, frame);
await page.keyboard.press('Escape'); await sleep(100); await page.keyboard.press('Escape'); await sleep(100);
ok('escape closes dialog then drawer', await page.$eval('#drawer',d=>d.hidden));
const cdp=await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dl,eventsEnabled:true});
await page.click('#exportZipBtn'); await sleep(1200);
await page.click('#exportCsvBtn'); await sleep(1200);
const files=fs.readdirSync(dl);
const zip=files.find(f=>f.endsWith('.zip')), csv=files.find(f=>f.endsWith('.csv'));
ok('zip downloaded', zip&&fs.statSync(join(dl,zip)).size>200, files);
if(csv){const c=fs.readFileSync(join(dl,csv));
ok('csv has BOM', c[0]===0xef&&c[1]===0xbb, c.slice(0,4));
const head=c.toString().split('\n')[0];
ok('csv includes hidden columns', head.includes('Meta description')&&head.includes('OG title')&&head.includes('Canonical'), head.slice(0,200));
}else ok('csv downloaded',false,files);
const nameBefore=await page.$eval('#statusTitle',e=>e.textContent);
await page.click('#savedBtn'); await sleep(300);
await page.evaluate(()=>document.querySelector('.saved-row .icon-btn-danger').click()); await sleep(200);
ok('delete asks first', await page.$eval('#confirmDialog',d=>d.open));
await page.click('#confirmOk'); await sleep(600);
const left=await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();const a=await root.getDirectoryHandle('crawl_archive');const out=[];for await(const [n] of a.entries())out.push(n);return out});
ok('delete removes archive', left.length===0, left);
ok('session cleared after deleting the open crawl', (await page.$eval('#statusTitle',e=>e.textContent))!==nameBefore);
await page.keyboard.press('Escape');
await page.$eval('#opfsEnabled',e=>e.click()); await sleep(500);

console.log('Schedule through the shared engine');
await page.evaluate(()=>{document.querySelector('#navSchedules').click()}); await sleep(200);
await page.evaluate(()=>document.querySelector('#viewSchedules .btn-primary').click()); await sleep(200);
await page.click('#scheduleForm button[type=submit]'); await sleep(100);
ok('schedule requires a start URL', await page.$eval('#scheduleError',e=>!e.hidden));
await page.type('#scheduleSpiderUrl','http://localhost:8123/b');
await page.click('#scheduleForm button[type=submit]'); await sleep(500);
const cardCount=await page.$$eval('.schedule',e=>e.length);
ok('schedule created', cardCount===1);
const alarm=await page.evaluate(async()=>(await chrome.alarms.getAll()).filter(a=>a.name.startsWith('cron-')).length);
ok('alarm registered', alarm===1);
await page.evaluate(()=>[...document.querySelectorAll('.schedule .btn')].find(b=>b.textContent.includes('Run now')).click());
await page.waitForFunction(()=>[...document.querySelectorAll('.schedule .pill')].some(p=>p.textContent==='Active')&&[...document.querySelectorAll('.schedule .btn')].some(b=>b.textContent.includes('Open last result')),{timeout:30000});
const sch=await page.evaluate(async()=>Object.values((await chrome.storage.local.get('schedules')).schedules)[0]);
ok('summary written', sch.summary?.total>=1&&sch.summary.crawlKey&&sch.running===false, JSON.stringify(sch.summary));
await page.evaluate(()=>[...document.querySelectorAll('.schedule .btn')].find(b=>b.textContent.includes('Open last result')).click());
await sleep(800);
ok('open last result', (await page.$eval('#countPages',e=>e.textContent))>='1'&&await page.$eval('#viewResults',e=>!e.hidden));
const meta=await page.evaluate(async id=>{const r=await new Promise(res=>{const q=indexedDB.open('blue-dragon');q.onsuccess=()=>res(q.result)});return new Promise(res=>{const g=r.transaction('crawls').objectStore('crawls').get(id);g.onsuccess=()=>res(g.result)})},sch.summary.crawlKey);
ok('scheduled crawl has settings + source', meta.settings.maxConnections>0&&meta.source.type==='schedule'&&meta.settings.respectRobots===true, JSON.stringify(meta.source));

console.log('Security: hostile page content');
await startUrlXss();
async function startUrlXss(){
  const s=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(q.url==='/robots.txt'?'':`<html><head><title>&lt;img src=x onerror="window.pwned=1"&gt;</title><meta name="description" content="<img src=x onerror=window.pwned=2>"></head><body><h1><img src=x onerror="window.pwned=3"></h1><a href="/<img src=x onerror=window.pwned=4>">x</a></body></html>`)});
  await new Promise(r=>s.listen(8124,r));
  await page.$eval('input[name=source][value=website]',e=>e.click());
  await page.$eval('#startUrl',e=>{e.value=''}); await page.type('#startUrl','http://localhost:8124/');
  await page.click('#crawlBtn'); await sleep(300); await waitState('done',15000); await sleep(700);
  await page.evaluate(()=>document.querySelector('#pagesTable .url-cell').click()); await sleep(400);
  await page.click('#tab-issues'); await sleep(300); await page.click('#tab-overview'); await sleep(300);
  ok('no script/img injection from crawled pages', !(await page.evaluate(()=>window.pwned)));
  s.closeAllConnections(); s.close();
}

console.log('Performance: 10k rows');
const perf=await page.evaluate(async()=>{
  const r=await new Promise(res=>{const q=indexedDB.open('blue-dragon');q.onsuccess=()=>res(q.result)});
  const id='crawl-1234567890';
  const t=r.transaction(['crawls','pages'],'readwrite');
  t.objectStore('crawls').put({id,name:'big',createdAt:new Date().toISOString(),status:'done',schemaVersion:2,source:{type:'manual'},startURL:'https://big.test/',settings:{},counts:{crawled:10000}},id);
  for(let i=0;i<10000;i++)t.objectStore('pages').put({crawlId:id,url:`https://big.test/p/${i}`,depth:i%5,indexable:true,title:`Title ${i}`,fetch:{status:i%50?200:404,ok:!!(i%50),duration:i%700,contentType:'text/html',encodedBodySize:1234},links:[0,1,2,3,4,5,6,7,8,9].map(k=>({url:`https://big.test/p/${(i+k)%10000}`,follow:'follow',internal:true}))});
  await new Promise(res=>t.oncomplete=res); return true});
await page.click('#savedBtn'); await sleep(300);
const t0=Date.now();
await page.evaluate(()=>[...document.querySelectorAll('.saved-open')].find(b=>b.textContent.startsWith('big')).click());
await page.click('#tab-pages').catch(()=>{});
await page.waitForFunction(()=>document.querySelector('#countPages').textContent==='10,000',{timeout:30000});
await page.waitForFunction(()=>document.querySelector('#countIssues').textContent!=='0',{timeout:30000});
const loadMs=Date.now()-t0;
await sleep(800);
const dom=await page.evaluate(()=>document.querySelectorAll('#pagesTable .tabulator-row').length);
warn('10k crawl loads in under 6 s', loadMs<6000, loadMs); console.log('   load ms',loadMs);
ok('virtual DOM: few rows in document', dom<80, dom);
const scroll=await page.evaluate(async()=>{const h=document.querySelector('#pagesTable .tabulator-tableholder');const s=performance.now();let max=0,l=s;for(let i=0;i<30;i++){h.scrollTop=i*3000;await new Promise(r=>requestAnimationFrame(r));const n=performance.now();max=Math.max(max,n-l);l=n}return {total:performance.now()-s,max}});
warn('scroll stays smooth (worst frame < 120 ms)', scroll.max<120, scroll); console.log('   scroll',scroll);
const f0=Date.now();
await page.type('#tableSearch','p/999'); await page.waitForFunction(()=>document.querySelectorAll('#pagesTable .tabulator-row').length<20&&document.querySelectorAll('#pagesTable .tabulator-row').length>0,{timeout:5000});
warn('filter responds under 1 s', Date.now()-f0<1000, Date.now()-f0);
await page.$eval('#tableSearch',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))});await sleep(400);

console.log('Accessibility (axe, WCAG A/AA)');
await page.evaluate(axeSource());
const audit=async(label)=>{const v=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa'],resultTypes:['violations']});return r.violations.map(x=>({id:x.id,n:x.nodes.length,ex:x.nodes.slice(0,2).map(n=>n.target.join(' ')+' :: '+(n.any[0]?.message||'').slice(0,110))}))});ok(`axe ${label}`,v.length===0,JSON.stringify(v,null,1))};
for(const theme of ['light','dark']){
  await page.evaluate(t=>{document.documentElement.dataset.theme=t},theme);
  await page.click('#tab-pages'); await sleep(500); await audit(`pages ${theme}`);
  await page.click('#tab-overview'); await sleep(400); await audit(`overview ${theme}`);
  await page.click('#tab-issues'); await sleep(400); await page.click('.issue summary'); await sleep(200); await audit(`issues ${theme}`);
}
for(const p of ['options.html','robots.html']){await page.goto(url(p));await sleep(400);await page.evaluate(axeSource());await audit(p)}

console.log('Keyboard');
await page.goto(url('dragon.html')); await page.waitForSelector('#crawlBtn'); await sleep(500);
await page.focus('#tab-pages'); await page.keyboard.press('ArrowRight'); await sleep(100);
ok('arrow key moves tabs', await page.$eval('#tab-overview',e=>e.getAttribute('aria-selected')==='true'&&document.activeElement===e));
await page.keyboard.press('/'); await sleep(100);
ok('/ focuses filter', await page.evaluate(()=>document.activeElement.id==='tableSearch'));


const passed = checks.finish();
await close();
site.srv.closeAllConnections();
site.srv.close();
process.exit(passed && !errors.length ? 0 : 1);
