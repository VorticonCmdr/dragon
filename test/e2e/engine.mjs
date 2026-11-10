// The crawl engine, driven through the same port as the UI: robots, redirects,
// charsets, limits, pause, stop, a killed service worker, and database migration.

import { createChecks, launchExtension, watchErrors } from './helpers.mjs';
import { startSite } from './site.mjs';

const errors = [];
const { ok, ...checks } = createChecks();
const site = await startSite();
const base = 'http://localhost:8123';
const { browser, worker: swT, url, close } = await launchExtension();
const page=await browser.newPage();
watchErrors(page, errors);
await page.goto(url('options.html'));
await page.evaluate(()=>{
  window.msgs=[]; window.connect=()=>{ window.port=chrome.runtime.connect({name:'dragon-ui'});
    port.onMessage.addListener(m=>msgs.push(m)); port.onDisconnect.addListener(()=>setTimeout(connect,200)); };
  connect();
  window.send=m=>{ try{port.postMessage(m)}catch{ connect(); port.postMessage(m)} };
  window.wait=(t,ms=60000)=>new Promise((res,rej)=>{const s=Date.now();const i=setInterval(()=>{const f=msgs.find(m=>t(m));if(f){clearInterval(i);res(f)}else if(Date.now()-s>ms){clearInterval(i);rej(new Error('timeout'))}},50)});
});
const settings={crawlMode:'recursive',stayonhostname:true,maxPages:100,maxRetries:1,maxConnections:8,timeoutMs:1500,fetchOutbound:true,respectRobots:true};
const pages=id=>page.evaluate(async id=>{const {crawlDB}=await import('/db.js');return {meta:await crawlDB.getMeta(id),pages:await crawlDB.getPages(id),state:await crawlDB.getState(id)}},id);

console.log('A: full recursive crawl');
let id='crawl-1000';
let t0=Date.now();
await page.evaluate((id,base,settings)=>{msgs.length=0;send({type:'startCrawl',crawlId:id,name:'t',seeds:[base+'/',base+'/'],settings})},id,base,settings);
const comp=await page.evaluate(id=>wait(m=>m.type==='crawlComplete'&&m.crawlId===id),id);
let d=await pages(id); const by=Object.fromEntries(d.pages.map(p=>[p.url,p]));
ok('status done',comp.status==='done'&&d.meta.status==='done',comp);
ok('no fragment dup', !d.pages.some(p=>p.url.includes('#')) && site.hits.filter(h=>h==='GET localhost:8123 /b').length===1, site.hits.filter(h=>h.endsWith('/b')));
ok('robots blocked not fetched', by[base+'/blocked/x']?.blockedByRobots===true && !site.hits.some(h=>h.includes('/blocked/x')));
ok('pdf row but body not read', by[base+'/file.pdf']?.fetch.status===200 && by[base+'/file.pdf'].fetch.contentType==='application/pdf' && by[base+'/file.pdf'].title==='' && Date.now()-t0<20000);
const r=by[base+'/redir'];
ok('redirect final + relative resolved', r?.fetch.finalUrl===base+'/final/page' && by[base+'/final/sibling']?.fetch.ok, JSON.stringify(r?.fetch));
ok('redirect chain recorded', r?.fetch.redirectChain?.length===2 && r.fetch.redirectChain[0].status===301, JSON.stringify(r?.fetch.redirectChain));
ok('final url not refetched', site.hits.filter(h=>h.endsWith(' /final/page')).length===1);
ok('latin1 title', by[base+'/latin']?.title==='München', by[base+'/latin']?.title);
ok('5xx retried', by[base+'/flaky']?.fetch.status===200 && by[base+'/flaky'].fetch.retries===1, JSON.stringify(by[base+'/flaky']?.fetch));
ok('404 recorded', by[base+'/missing']?.fetch.status===404 && d.meta.counts.failed>=1);
ok('NOINDEX uppercase', by[base+'/noindex']?.indexable===false && by[base+'/noindex'].robots.includes('NOINDEX'));
ok('x-robots-tag + link canonical', by[base+'/hdr']?.indexable===false && by[base+'/hdr'].xRobotsTag==='noindex');
ok('base href', !!by[base+'/dir/sub/x']?.fetch.ok);
ok('byte cap', by[base+'/huge']?.fetch.truncated===true && by[base+'/huge'].fetch.decodedBodySize===5*1024*1024, JSON.stringify(by[base+'/huge']?.fetch));
ok('timeout -> failed page', /timeout/.test(by[base+'/hang']?.error||''), JSON.stringify(by[base+'/hang']));
ok('canonical absolute', by[base+'/a']?.canonical===base+'/a', by[base+'/a']?.canonical);
ok('outbound ok', by['http://127.0.0.1:8123/ext-ok']?.isOutbound && by['http://127.0.0.1:8123/ext-ok'].fetch.status===200);
ok('outbound 404', by['http://127.0.0.1:8123/ext-404']?.fetch.status===404);
ok('home links stored', by[base+'/']?.links?.length>10);
ok('state removed', !d.state);
ok('pageDone rows arrived', await page.evaluate(n=>msgs.filter(m=>m.type==='pageDone').flatMap(m=>m.rows).length===n,d.pages.length));
ok('counts match pages', d.meta.counts.crawled===d.pages.length, JSON.stringify(d.meta.counts));

console.log('B: pause/resume');
id='crawl-2000';
const s2={...settings,timeoutMs:5000,fetchOutbound:false,maxConnections:2};
await page.evaluate((id,base,s)=>{msgs.length=0;send({type:'startCrawl',crawlId:id,name:'p',seeds:[base+'/slow/1'],settings:s})},id,base,s2);
await page.evaluate(()=>wait(m=>m.type==='crawlProgress'&&m.crawled>=3));
await page.evaluate(id=>send({type:'pauseCrawl',crawlId:id}),id);
await new Promise(r=>setTimeout(r,1500));
let before=site.hits.length;
await new Promise(r=>setTimeout(r,2500));
ok('paused: no more fetches', site.hits.length===before, site.hits.length-before);
ok('paused: no complete', !(await page.evaluate(()=>msgs.some(m=>m.type==='crawlComplete'))));
d=await pages(id); ok('paused persisted', d.meta.status==='paused', d.meta.status);
const st=await page.evaluate(()=>{msgs.length=0;send({type:'startCrawl',crawlId:'crawl-x',name:'x',seeds:['http://localhost:8123/a'],settings:{}});return wait(m=>m.type==='error')});
ok('second crawl rejected while paused', /already/.test(st.message));
await page.evaluate(id=>{msgs.length=0;send({type:'resumeCrawl',crawlId:id})},id);
const c2=await page.evaluate(id=>wait(m=>m.type==='crawlComplete'&&m.crawlId===id),id);
d=await pages(id);
ok('resumed to completion', c2.status==='done' && d.pages.length>=60, d.pages.length);
ok('no duplicate fetch across pause', new Set(site.hits.filter(h=>h.includes('/slow/'))).size===site.hits.filter(h=>h.includes('/slow/')).length);

console.log('C: stop');
id='crawl-3000'; site.hits.length=0;
await page.evaluate((id,base,s)=>{msgs.length=0;send({type:'startCrawl',crawlId:id,name:'s',seeds:[base+'/slow/1'],settings:s})},id,base,s2);
await page.evaluate(()=>wait(m=>m.type==='crawlProgress'&&m.crawled>=2));
t0=Date.now();
await page.evaluate(id=>send({type:'stopCrawl',crawlId:id}),id);
const c3=await page.evaluate(id=>wait(m=>m.type==='crawlComplete'&&m.crawlId===id),id);
d=await pages(id);
ok('stopped quickly', c3.status==='stopped'&&Date.now()-t0<2000, Date.now()-t0);
ok('partial results kept', d.pages.length>=2&&d.meta.status==='stopped');

console.log('D: stop while paused');
id='crawl-3500';
await page.evaluate((id,base,s)=>{msgs.length=0;send({type:'startCrawl',crawlId:id,name:'s',seeds:[base+'/slow/1'],settings:s})},id,base,s2);
await page.evaluate(()=>wait(m=>m.type==='crawlProgress'&&m.crawled>=2));
await page.evaluate(id=>send({type:'pauseCrawl',crawlId:id}),id);
await new Promise(r=>setTimeout(r,800));
await page.evaluate(id=>send({type:'stopCrawl',crawlId:id}),id);
const c35=await page.evaluate(id=>wait(m=>m.type==='crawlComplete'&&m.crawlId===id,8000),id);
ok('stop while paused finishes', c35.status==='stopped');
const fresh=await page.evaluate((base)=>{msgs.length=0;send({type:'startCrawl',crawlId:'crawl-3600',name:'n',seeds:[base+'/a'],settings:{}});return wait(m=>m.type==='crawlComplete'&&m.crawlId==='crawl-3600',8000)},base);
ok('new crawl possible afterwards', fresh.status==='done');

console.log('E: service worker killed mid-crawl');
id='crawl-4000'; site.hits.length=0;
await page.evaluate((id,base,s)=>{msgs.length=0;send({type:'startCrawl',crawlId:id,name:'k',seeds:[base+'/slow/1'],settings:s})},id,base,s2);
await page.evaluate(()=>wait(m=>m.type==='crawlProgress'&&m.crawled>=25));
await page.evaluate(()=>{window.disconnects=0;port.onDisconnect.addListener(()=>window.disconnects++)});
const w=await swT.worker(); await w.close();
await new Promise(r=>setTimeout(r,300));
ok('worker really died (port dropped)', await page.evaluate(()=>window.disconnects)>=1);
const hitsAtKill=site.hits.length;
await new Promise(r=>setTimeout(r,500));
const c4=await page.evaluate(id=>wait(m=>m.type==='crawlComplete'&&m.crawlId===id,90000),id);
d=await pages(id);
ok('resumed after kill and finished', c4.status==='done'&&d.pages.length>=60&&d.pages.every(p=>p.fetch?.ok), `${d.pages.length} ${JSON.stringify(d.meta.counts)}`);
ok('crawling continued after the kill', site.hits.length>hitsAtKill, site.hits.length-hitsAtKill);
const uniqueKilled=new Set(d.pages.map(p=>p.url)).size;
ok('counts rebuilt', d.meta.counts.crawled===uniqueKilled, JSON.stringify(d.meta.counts));

console.log('F: migration of a real v1 database');
const mig=await page.evaluate(async()=>{
  const {crawlDB}=await import('/db.js');
  await new Promise((res,rej)=>{const r=indexedDB.deleteDatabase('blue-dragon');r.onsuccess=res;r.onerror=rej;r.onblocked=()=>{}});
  await new Promise((res,rej)=>{const r=indexedDB.open('blue-dragon',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('crawls');r.result.createObjectStore('crawlMeta')};
    r.onsuccess=()=>{const db=r.result;const t=db.transaction(['crawls','crawlMeta'],'readwrite');
      const blob={id:1700000000000,name:'old',settings:{delay:5},data:{startURL:'https://e.com/',queue:[],results:{
        'https://e.com/':{href:'https://e.com/',fetch:{status:200,ok:true,contentType:'text/html'},title:'T',links:[{url:'https://e.com/a',follow:'follow'}],content:'huge'},
        'https://e.com/a':{href:'https://e.com/a',fetch:{status:404,ok:false}}}}};
      t.objectStore('crawls').put(blob,'crawl-1700000000000');
      t.objectStore('crawls').put({id:1,name:'partial',data:{startURL:'https://f.com/',queue:['https://f.com/x'],results:{}}},'crawl-1700000000001');
      t.objectStore('crawlMeta').put({id:'crawl-1700000000000',name:'old'},'crawl-1700000000000');
      t.oncomplete=()=>{db.close();res()};t.onerror=rej}});
  return {list:await crawlDB.list(),pages:await crawlDB.getPages('crawl-1700000000000')};
});
ok('both crawls listed', mig.list.length===2, JSON.stringify(mig.list));
const old=mig.list.find(c=>c.id==='crawl-1700000000000');
ok('meta migrated', old?.name==='old'&&old.status==='done'&&old.counts.crawled===2&&old.counts.ok===1&&old.settings.delay===5, JSON.stringify(old));
ok('interrupted crawl marked stopped', mig.list.find(c=>c.id==='crawl-1700000000001')?.status==='stopped');
ok('pages migrated', mig.pages.length===2&&mig.pages[0].title==='T'&&mig.pages[0].indexable===true&&mig.pages[0].links[0].internal===true&&!('content' in mig.pages[0]), JSON.stringify(mig.pages[0]));


const passed = checks.finish();
await close();
site.srv.closeAllConnections();
site.srv.close();
process.exit(passed && !errors.length ? 0 : 1);
