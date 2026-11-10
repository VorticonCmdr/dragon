// Importing URLs (sitemaps, CSV, links of a page), the URL filter, schedules queued
// behind a crawl, and whether service-worker memory stays flat over a long crawl.

import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { createChecks, launchExtension, sleep, watchErrors } from './helpers.mjs';

const errors = [];
const { ok, ...checks } = createChecks();
const B='http://localhost:8125';
const srv=http.createServer((q,r)=>{const p=new URL(q.url,'http://x').pathname;
 const x=(s,t='application/xml')=>{r.writeHead(200,{'content-type':t});r.end(s)};
 if(p==='/robots.txt'){r.writeHead(404);return r.end()}
 if(p==='/idx.xml')return x(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${B}/idx.xml</loc></sitemap><sitemap><loc>${B}/a.xml</loc></sitemap><sitemap><loc>${B}/b.xml.gz</loc></sitemap><sitemap><loc>${B}/gone.xml</loc></sitemap></sitemapindex>`);
 if(p==='/a.xml')return x(`<urlset><url><loc>${B}/p?a=1&amp;b=2</loc><image:image><image:loc>${B}/img.png</image:loc></image:image></url><url><loc><![CDATA[${B}/q]]></loc></url></urlset>`);
 if(p==='/b.xml.gz'){r.writeHead(200,{'content-type':'application/octet-stream'});return r.end(zlib.gzipSync(`<urlset><url><loc>${B}/gz1</loc></url></urlset>`))}
 if(p==='/gone.xml'){r.writeHead(404);return r.end()}
 if(p==='/links')return x(`<html><a href="/l1">1</a><a href="l2#x">2</a><a href="mailto:a@b.c">m</a></html>`,'text/html');
 if(p.startsWith('/m/')){const n=+p.split('/')[2];const L=[];for(let i=1;i<=3;i++){const k=n*3+i;if(k<3000)L.push(`<a href="/m/${k}">x</a>`)}return x(`<html><head><title>m${n}</title></head><body>${'<p>lorem ipsum dolor</p>'.repeat(800)}${L.join('')}</body></html>`,'text/html')}
 x('<html><title>ok</title></html>','text/html')});
await new Promise(r=>srv.listen(8125,r));
const { browser, worker: swT, url, work, close } = await launchExtension();
const page=await browser.newPage();
watchErrors(page, errors);
await page.goto(url('dragon.html')); await page.waitForSelector('#crawlBtn'); await sleep(500);
const src=v=>page.$eval(`input[name=source][value=${v}]`,e=>e.click());
const list=()=>page.$eval('#urlList',e=>e.value.split('\n').filter(Boolean));
const state=s=>page.waitForFunction(s=>document.querySelector('#statusbar').dataset.state===s,{timeout:90000},s);

console.log('Sitemap via URL: index, self-cycle, gzip, entities, CDATA, image locs, 404 child');
await src('sitemap'); await page.type('#sitemapUrl',B+'/idx.xml'); await page.click('#sitemapBtn');
await page.waitForFunction(()=>!document.querySelector('[data-source=list]').hidden,{timeout:10000}); await sleep(300);
let l=await list();
ok('urls exact', l.length===3&&l.includes(B+'/p?a=1&b=2')&&l.includes(B+'/q')&&l.includes(B+'/gz1')&&!l.some(u=>u.includes('img.png')), l);
ok('partial failure reported', (await page.$eval('#toasts',e=>e.textContent)).includes('1 sitemaps failed')||(await page.$eval('#toasts',e=>e.textContent)).includes('failed'), await page.$eval('#toasts',e=>e.textContent));

console.log('Sitemap via file (.gz) appends without duplicates');
const gzPath=join(work,'t.xml.gz'); fs.writeFileSync(gzPath,zlib.gzipSync(`<urlset><url><loc>${B}/file1</loc></url><url><loc>${B}/q</loc></url></urlset>`));
await src('sitemap'); const inp=await page.$('#sitemapFile'); await inp.uploadFile(gzPath);
await page.waitForFunction(()=>!document.querySelector('[data-source=list]').hidden,{timeout:8000}); await sleep(300);
l=await list(); ok('gz file merged', l.length===4&&l.includes(B+'/file1'), l);

console.log('Links from a page');
await page.type('#spiderUrl',B+'/links'); await page.click('#spiderBtn'); await sleep(700);
l=await list(); ok('links resolved, mailto ignored, no fragment', l.includes(B+'/l1')&&l.includes(B+'/l2')&&!l.some(u=>u.startsWith('mailto')||u.includes('#')), l);

console.log('CSV import with metrics');
const csvPath=join(work,'t.csv'); fs.writeFileSync(csvPath,`﻿Page,Clicks,Impressions\n${B}/c1,"1,200",5000\n${B}/c2,3,10\n\n`);
await page.$eval('#urlList',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))});
await src('csv'); await (await page.$('#csvFile')).uploadFile(csvPath);
await page.waitForFunction(()=>!document.querySelector('[data-source=list]').hidden,{timeout:8000}); await sleep(300);
l=await list(); ok('csv urls (BOM + Windows-type safe)', l.length===2, l);
await page.click('#crawlBtn'); await sleep(300); await state('done'); await sleep(900);
await page.$eval('#columnsBtn',e=>e.click()); await sleep(100);
await page.evaluate(()=>[...document.querySelectorAll('#columnsPanel label')].find(x=>x.textContent==='Clicks').click()); await sleep(300);
const cols=await page.$eval('#columnsPanel',e=>!e.hidden);
ok('column panel stays open between toggles', cols);
await page.keyboard.press('Escape');
const cell=await page.$$eval('#pagesTable .tabulator-cell[tabulator-field=clicks]',c=>c.map(x=>x.textContent));
ok('clicks merged from csv', cell.includes('1,200')&&cell.includes('3'), cell);
const hidden=await page.reload().then(async()=>{await page.waitForSelector('#crawlBtn');await sleep(400);return page.evaluate(()=>JSON.parse(localStorage.getItem('visibleColumns')).includes('clicks'))});
ok('column choice persists', hidden);

console.log('Filter excludes in list mode, non-destructively');
await page.$eval('input[name=filterType][value=exclude]',e=>e.click());
await page.$eval('input[name=source][value=list]',e=>e.click());
await page.$eval('#urlList',e=>{e.value='http://localhost:8125/keep\nhttp://localhost:8125/drop';e.dispatchEvent(new Event('input',{bubbles:true}))});
await page.type('#filterRegex','['); await sleep(300);
ok('invalid regex explained inline', await page.$eval('#filterError',e=>!e.hidden));
await page.$eval('#filterRegex',e=>{e.value='';}); await page.type('#filterRegex','drop'); await sleep(300);
ok('match count', (await page.$eval('#filterMatch',e=>e.textContent)).startsWith('1 of 2'), await page.$eval('#filterMatch',e=>e.textContent));
ok('list unchanged', (await list()).length===2);
await page.$eval('input[name=filterType][value=""]',e=>e.click()); await sleep(400);

console.log('Schedule queued behind a paused crawl');
await page.evaluate(B=>{chrome.runtime.sendMessage({type:'setSchedule',schedule:{id:'schedule-q',nameTemplate:'q {hostname}',intervalMinutes:1440,timeStr:'03:00',dayOfWeek:1,enabled:true,sources:{spiderUrl:'',urlList:B+'/x1',sitemapUrl:''},filter:{regex:'',type:''},crawlMode:'list',maxPages:5}})},B);
await sleep(300);
await src('website'); await page.$eval('#startUrl',e=>{e.value=''}); await page.type('#startUrl',B+'/m/0');
await page.$eval('#maxPages',e=>{e.value=2900;e.dispatchEvent(new Event('change',{bubbles:true}))});
await page.$eval('#maxConnections',e=>{e.value=16;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))});
await sleep(400);
const t0=Date.now();
await page.click('#crawlBtn'); await state('running');
await page.waitForFunction(()=>+document.querySelector('#countPages').textContent.replace(/,/g,'')>50,{timeout:15000});
await page.click('#pauseBtn'); await state('paused');
const r=await page.evaluate(()=>chrome.runtime.sendMessage({type:'runSchedule',id:'schedule-q'}));
ok('schedule queued, not parallel', r.ok&&r.queued===true, r);
await sleep(600);
await page.click('#pauseBtn'); await state('running');

console.log('SW memory over 2900 pages');
const w=await swT.worker();
const heap=async()=>{const c=await swT.createCDPSession();await c.send('HeapProfiler.enable').catch(()=>{});await c.send('HeapProfiler.collectGarbage').catch(()=>{});const m=await c.send('Runtime.getHeapUsage');await c.detach();return Math.round(m.usedSize/1048576*10)/10};
const samples=[];
for(;;){const n=+(await page.$eval('#countPages',e=>e.textContent)).replace(/,/g,'');samples.push([n,await heap()]);if(await page.$eval('#statusbar',e=>e.dataset.state)!=='running')break;await sleep(1800)}
console.log('   pages → heap MB',JSON.stringify(samples.filter((_,i)=>i%Math.ceil(samples.length/8)===0)),'took',Date.now()-t0);
const mid=samples.find(s=>s[0]>=500)?.[1]??samples[0][1]; const peak=Math.max(...samples.map(s=>s[1]));
ok('heap does not grow with pages', peak<mid*2.5&&peak<60, {mid,peak});
await sleep(1500);
const pending=await page.evaluate(async()=>{const {schedules,pendingScheduleIds}=await chrome.storage.local.get(['schedules','pendingScheduleIds']);return {s:schedules['schedule-q'],p:pendingScheduleIds}});
ok('queued schedule ran after the crawl ended', pending.s.summary?.total===1&&!pending.p?.length, JSON.stringify(pending));
const shown=await page.$eval('#statusTitle',e=>e.textContent);
ok('finished crawl stayed on screen, not replaced by schedule', shown.startsWith('localhost')&&!shown.startsWith('q '), shown);

const passed = checks.finish();
await close();
srv.closeAllConnections();
srv.close();
process.exit(passed && !errors.length ? 0 : 1);
