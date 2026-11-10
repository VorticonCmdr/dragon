// A small site with one of everything a crawler must cope with.

import http from 'node:http';
export function startSite(port = 8123) {
  const hits = []; const hitTimes = {}; let flaky = 0;
  const page = (title, body='') => `<!doctype html><html><head><title>${title}</title><meta name="description" content="d ${title}"><link rel="canonical" href="/${title}"></head><body><h1>${title}</h1>${body}</body></html>`;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname; hits.push(`${req.method} ${req.headers.host} ${p}`);
    (hitTimes[p] ??= []).push(Date.now());
    const html = (s, code=200, extra={}) => { res.writeHead(code, {'content-type':'text/html; charset=utf-8', ...extra}); res.end(s); };
    if (p === '/robots.txt') { res.writeHead(200,{'content-type':'text/plain'}); return res.end('User-agent: *\nDisallow: /blocked/\n'); }
    if (p === '/') return html(page('home', `<a href="/a">a</a><a href="/b#frag">b</a><a href="/b">b2</a><a href="/blocked/x">x</a>
      <a href="/file.pdf">pdf</a><a href="/redir">r</a><a href="/latin">l</a><a href="/flaky">f</a><a href="/missing">m</a>
      <a href="/noindex">n</a><a href="/hdr">h</a><a href="/dir/rel">rel</a><a href="/huge">huge</a><a href="/hang">hang</a>
      <a href="http://127.0.0.1:${port}/ext-ok">e</a><a href="http://127.0.0.1:${port}/ext-404">e2</a>`));
    if (p === '/a') return html(page('a', '<a href="/">home</a><a href="/b">b</a>'));
    if (p === '/b') return html(page('b'));
    if (p === '/blocked/x') return html(page('should-never-be-fetched'));
    if (p === '/file.pdf') { res.writeHead(200,{'content-type':'application/pdf','content-length':String(9e6)}); res.write(Buffer.alloc(65536)); return setTimeout(()=>res.destroy(),3000); }
    if (p === '/redir') { res.writeHead(301,{location:'/redir2'}); return res.end(); }
    if (p === '/redir2') { res.writeHead(302,{location:'/final/page'}); return res.end(); }
    if (p === '/final/page') return html(page('final', '<a href="sibling">s</a>'));
    if (p === '/final/sibling') return html(page('sibling'));
    if (p === '/latin') { res.writeHead(200,{'content-type':'text/html'}); return res.end(Buffer.from('<html><head><meta charset="iso-8859-1"><title>M\xfcnchen</title></head><body></body></html>','latin1')); }
    if (p === '/flaky') { if (flaky++ < 1) return html('nope',503,{'retry-after':'0'}); return html(page('flaky-ok')); }
    if (p === '/missing') return html(page('missing'),404);
    if (p === '/noindex') return html('<html><head><title>n</title><meta name="ROBOTS" content="NOINDEX,follow"></head></html>');
    if (p === '/hdr') return html(page('hdr'),200,{'x-robots-tag':'noindex','link':'</canon>; rel="canonical"'});
    if (p === '/dir/rel') return html('<html><head><base href="/dir/sub/"><title>rel</title></head><body><a href="x">x</a></body></html>');
    if (p === '/dir/sub/x') return html(page('x'));
    if (p === '/huge') return html('<html><title>huge</title>'+'x'.repeat(8e6));
    if (p === '/hang') return; // never answers
    if (p === '/ext-ok') { res.writeHead(200,{'content-type':'text/html'}); return res.end(req.method==='HEAD'?'':'ok'); }
    if (p === '/ext-404') { res.writeHead(404); return res.end(); }
    if (p.startsWith('/slow/')) { const n=+p.split('/')[2]; return setTimeout(()=>html(page('s'+n, n<60?`<a href="/slow/${n+1}">n</a><a href="/slow/${n+100}">m</a>`:'')),120); }
    html('not found',404);
  });
  return new Promise(r => srv.listen(port, () => r({ srv, hits, hitTimes })));
}
