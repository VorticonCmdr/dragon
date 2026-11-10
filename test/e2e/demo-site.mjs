// A made-up outdoor shop with realistic flaws, for the rank chart tests and the
// docs screenshots. Chrome maps the reserved domain *.example onto this server
// (DEMO_ARGS), so nothing leaves the machine.

import http from 'node:http';

const sleep = ms => new Promise(done => setTimeout(done, ms));
export const DEMO_ARGS = ['--host-resolver-rules=MAP *.example 127.0.0.1:8130'];

const cats={'hiking-boots':'Hiking Boots','tents':'Tents','backpacks':'Backpacks','sleeping-bags':'Sleeping Bags','rain-jackets':'Rain Jackets'};
const words=['Summit','Ridge','Alpine','Trail','Canyon','Glacier','Pioneer','Nomad'];
const products=[];for(const c of Object.keys(cats))for(const w of words)products.push({c,slug:`${w.toLowerCase()}-${c.replace(/s$/,'').replace('hiking-','')}`,name:`${w} ${cats[c].replace(/s$/,'')}`});
const nav=`<nav><a href="/">Home</a>${Object.entries(cats).map(([k,v])=>`<a href="/${k}/">${v}</a>`).join('')}<a href="/journal/">Journal</a><a href="/about">About</a><a href="/old-sale">Sale</a><a href="/account/orders">Orders</a></nav>`;
const doc=(title,{desc,h1,canon,body='',robots}={})=>`<!doctype html><html lang="en"><head><title>${title}</title>${desc===null?'':`<meta name="description" content="${desc??`${title}: gear for every trail, tested in the field and shipped within two days.`}">`}${canon===null?'':`<link rel="canonical" href="http://shop.example${canon}">`}${robots?`<meta name="robots" content="${robots}">`:''}<meta property="og:title" content="${title}"><meta property="og:site_name" content="Trailhead Outfitters"></head><body>${nav}${h1===null?'':`<h1>${h1??title}</h1>`}${body}</body></html>`;
const srv=http.createServer(async(q,r)=>{
 const p=new URL(q.url,'http://x').pathname;
 if((q.headers.host||'').startsWith('partner.')){r.writeHead(p==='/'?200:404,{'content-type':'text/html'});return r.end()}
 const html=(s,c=200,h={})=>{r.writeHead(c,{'content-type':'text/html; charset=utf-8',...h});r.end(s)};
 if(p==='/robots.txt'){r.writeHead(200,{'content-type':'text/plain'});return r.end('User-agent: *\nDisallow: /account/\nDisallow: /cart\n')}
 const h=[...p].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7)>>>0;
 await sleep(70+h%330+(h%11===0?900:0));
 if(p==='/')return html(doc('Trailhead Outfitters: Outdoor Gear for Every Trail',{canon:'/',h1:'Gear for every trail',body:'<a href="/journal/packing-list">Packing list</a><a href="/cart">Cart</a>'}));
 if(p==='/about')return html(doc('About Trailhead Outfitters',{canon:'/about',body:'<a href="/contact">Contact</a><a href="/shipping">Shipping</a><a href="http://partner.example/">Partner</a><a href="http://partner.example/closed-offer">Offer</a>'}));
 if(p==='/contact')return html(doc('Contact us',{canon:'/contact',desc:null}));
 if(p==='/shipping')return html(doc('Shipping and returns',{canon:null,h1:null}));
 if(p==='/old-sale'){r.writeHead(301,{location:'/sale/'});return r.end()}
 if(p==='/sale/')return html(doc('Sale: last season gear',{canon:'/sale/',robots:'noindex,follow'}));
 if(p==='/journal/')return html(doc('The Trailhead Journal',{canon:'/journal/',body:'<a href="/journal/packing-list">Packing list</a><a href="/journal/layering">Layering</a><a href="/journal/2019-gear-guide">Gear guide</a>'}));
 if(p==='/journal/packing-list')return html(doc('The Ultimate Packing List',{canon:'/journal/packing-list',body:'<a href="/tents/old-basecamp-tent">Basecamp</a>'}));
 if(p==='/journal/layering')return html(doc('The Ultimate Packing List',{canon:'/journal/layering'}));
 if(p==='/journal/2019-gear-guide')return html(doc('Removed',{canon:null}),410);
 const m=p.match(/^\/([\w-]+)\/$/);
 if(m&&cats[m[1]])return html(doc(`${cats[m[1]]} | Trailhead Outfitters`,{canon:p,h1:cats[m[1]],body:products.filter(x=>x.c===m[1]).map(x=>`<a href="/${x.c}/${x.slug}">${x.name}</a>`).join('')}));
 const pr=products.find(x=>p===`/${x.c}/${x.slug}`);
 if(pr){const i=products.indexOf(pr);return html(doc(`${pr.name} | Trailhead Outfitters`,{canon:p,desc:i%9===4?null:undefined,h1:i%13===5?null:pr.name,body:`<p>${'Built for long days outside. '.repeat(120+h%300)}</p>`}));}
 html(doc('Page not found',{canon:null}),404);
});

export const startDemoSite = () => new Promise(done => srv.listen(8130, '127.0.0.1', () => done(srv)));
