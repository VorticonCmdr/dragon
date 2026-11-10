// Sitemap fetching and parsing. Regex-based on purpose: service workers have no
// DOMParser, and sitemaps have a flat, predictable shape.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (match, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

function cleanLoc(raw) {
  return decodeXmlEntities(raw.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim());
}

function locsIn(xml, tag) {
  const blockRe = new RegExp(`<(?:[\\w-]+:)?${tag}[\\s>][\\s\\S]*?<\\/(?:[\\w-]+:)?${tag}>`, 'gi');
  const locRe = /<(?:[\w-]+:)?loc\s*>([\s\S]*?)<\/(?:[\w-]+:)?loc\s*>/i;
  const out = [];
  for (const [block] of xml.matchAll(blockRe)) {
    const loc = block.match(locRe)?.[1];
    if (loc) out.push(cleanLoc(loc));
  }
  return out.filter(Boolean);
}

export function parseSitemapXml(xml) {
  const isIndex = /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(xml);
  return isIndex
    ? { kind: 'index', urls: locsIn(xml, 'sitemap') }
    : { kind: 'urlset', urls: locsIn(xml, 'url') };
}

function isGzip(bytes) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Bytes (from a file or a response) → XML text, gunzipping by magic number
// because servers often send .xml.gz with a misleading content type.
export async function sitemapBytesToText(buffer) {
  let bytes = new Uint8Array(buffer);
  if (isGzip(bytes)) bytes = await gunzip(bytes);
  return new TextDecoder().decode(bytes);
}

// Follows sitemap indexes with cycle protection and depth/count limits.
export async function fetchSitemapUrls(url, options = {}) {
  const { maxDepth = 5, maxSitemaps = 500, credentials = 'omit', onProgress } = options;
  const seen = new Set();
  const urls = new Set();
  const errors = [];

  async function visit(sitemapUrl, depth) {
    if (seen.has(sitemapUrl) || depth > maxDepth || seen.size >= maxSitemaps) return;
    seen.add(sitemapUrl);
    try {
      const response = await fetch(sitemapUrl, {
        cache: 'no-cache',
        credentials,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseSitemapXml(await sitemapBytesToText(await response.arrayBuffer()));
      if (parsed.kind === 'index') {
        for (const child of parsed.urls) await visit(child, depth + 1);
      } else {
        for (const entry of parsed.urls) urls.add(entry);
      }
      onProgress?.({ sitemaps: seen.size, urls: urls.size });
    } catch (e) {
      errors.push({ url: sitemapUrl, message: e.message });
    }
  }

  await visit(url, 0);
  return { urls: [...urls], sitemaps: seen.size, errors };
}
