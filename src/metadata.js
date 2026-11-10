// Shared metadata extraction. Works with both DOMParser documents and
// node-html-parser roots — both implement querySelector/getAttribute/textContent.

export function getValues(obj, key) {
  let found = [];
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    if (k === key) found.push(obj[k]);
    else if (typeof obj[k] === 'object') found = found.concat(getValues(obj[k], key));
  }
  return found;
}

function extractAuthors(data) {
  const authors = [];
  if (Array.isArray(data['@graph'])) {
    data['@graph'].forEach(item => {
      if (item['@type'] === 'Person' && item.name) authors.push(item.name);
    });
  }
  return authors;
}

function authorName(author) {
  return typeof author === 'string' ? author : author?.name ?? '';
}

function extractSchema(root) {
  const schema = {
    publisher: '',
    dateModified: '',
    datePublished: '',
    authors: '',
    headline: '',
    alternateHeadline: '',
  };

  [...root.querySelectorAll('script[type="application/ld+json"]')].forEach(el => {
    if (!el.textContent) return;
    let obj;
    try {
      obj = JSON.parse(el.textContent);
    } catch {
      return;
    }

    const publisher = getValues(obj, 'publisher')[0];
    if (typeof publisher === 'string') schema.publisher = publisher;
    else if (publisher?.name) schema.publisher = publisher.name;

    const headline = getValues(obj, 'headline')[0];
    if (headline) schema.headline = headline;

    const altHeadline = getValues(obj, 'alternateHeadline')[0];
    if (altHeadline) schema.alternateHeadline = altHeadline;

    const dateModified = getValues(obj, 'dateModified')[0];
    if (dateModified) schema.dateModified = dateModified;

    const datePublished = getValues(obj, 'datePublished')[0];
    if (datePublished) schema.datePublished = datePublished;

    const authors = getValues(obj, 'author')[0];
    if (Array.isArray(authors)) {
      schema.authors = authors.map(authorName).filter(Boolean).join(', ');
    } else if (authors) {
      schema.authors = authorName(authors);
    }
    if (!schema.authors) {
      schema.authors = extractAuthors(obj).join(', ');
    }
  });

  return schema;
}

// Robots directives from a meta tag or X-Robots-Tag value. Header values can be
// scoped ("otherbot: noindex"); directives for other crawlers do not apply.
export function robotsDirectives(value, agents = ['googlebot', 'robots']) {
  const directives = new Set();
  for (const part of String(value ?? '').toLowerCase().split(',')) {
    const match = part.trim().match(/^([a-z0-9_-]+):\s*(.*)$/);
    const isScoped = match && !KNOWN_VALUED_DIRECTIVES.has(match[1]);
    if (isScoped && !agents.includes(match[1])) continue;
    const token = (isScoped ? match[2] : part).trim();
    if (token) directives.add(token);
  }
  return directives;
}

const KNOWN_VALUED_DIRECTIVES = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after']);

function hasNoindex(directives) {
  return directives.has('noindex') || directives.has('none');
}

export function hasNofollow(directives) {
  return directives.has('nofollow') || directives.has('none');
}

// Canonical target from an HTTP `Link: <url>; rel="canonical"` header.
function canonicalFromLinkHeader(header) {
  for (const part of String(header ?? '').split(/,(?=\s*<)/)) {
    const match = part.match(/<([^>]*)>/);
    if (match && /;\s*rel="?[^";]*\bcanonical\b/i.test(part)) return match[1].trim();
  }
  return '';
}

function absolute(href, base) {
  if (!href) return '';
  try {
    return new URL(href.trim(), base).href;
  } catch {
    return href;
  }
}

function collectMeta(root) {
  const byName = new Map();
  const byProperty = new Map();
  for (const el of root.querySelectorAll('meta')) {
    const name = el.getAttribute('name')?.toLowerCase();
    const property = el.getAttribute('property')?.toLowerCase();
    const content = el.getAttribute('content') ?? '';
    if (name && !byName.has(name)) byName.set(name, content);
    if (property && !byProperty.has(property)) byProperty.set(property, content);
  }
  return { byName, byProperty };
}

function collectLinkTags(root, base) {
  const canonicals = [];
  const hreflang = [];
  for (const el of root.querySelectorAll('link')) {
    const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const href = el.getAttribute('href');
    if (!href) continue;
    if (rel.includes('canonical')) canonicals.push(absolute(href, base));
    const lang = el.getAttribute('hreflang');
    if (lang && rel.includes('alternate')) hreflang.push({ lang, href: absolute(href, base) });
  }
  return { canonicals, hreflang };
}

export function extractPageMetadata(root, href, { xRobotsTag = '', linkHeader = '' } = {}) {
  const { byName, byProperty } = collectMeta(root);
  const { canonicals, hreflang } = collectLinkTags(root, href);
  const headerCanonical = absolute(canonicalFromLinkHeader(linkHeader), href);

  let schema;
  try {
    schema = extractSchema(root);
  } catch {
    schema = { publisher: '', dateModified: '', datePublished: '', authors: '', headline: '', alternateHeadline: '' };
  }

  const robots = [byName.get('robots'), byName.get('googlebot')].filter(Boolean).join(', ');
  const directives = new Set([...robotsDirectives(robots), ...robotsDirectives(xRobotsTag)]);

  return {
    title: root.querySelector('title')?.textContent?.trim() || '',
    description: byName.get('description') ?? '',
    href,
    og: {
      image: byProperty.get('og:image') ?? '',
      title: byProperty.get('og:title') ?? '',
      site_name: byProperty.get('og:site_name') ?? '',
      description: byProperty.get('og:description') ?? '',
    },
    robots,
    xRobotsTag,
    noindex: hasNoindex(directives),
    nofollow: hasNofollow(directives),
    canonical: canonicals[0] || headerCanonical,
    canonicalCount: canonicals.length + (headerCanonical ? 1 : 0),
    hreflang,
    h1: root.querySelector('h1')?.textContent?.trim() || '',
    keyword: byName.get('keywords') ?? '',
    schema,
  };
}
