// Turns one HTML document into metadata and links. This is the only place that
// parses HTML in the crawler, so each page is parsed exactly once.

import { parse } from 'node-html-parser';
import { extractPageMetadata } from '../metadata.js';
import { normalizeUrl } from '../shared/url.js';

const PARSE_OPTIONS = {
  // <style> contents are never read: dropping them saves memory on inlined CSS.
  blockTextElements: { script: true, noscript: true, style: false, pre: true },
};
const NOFOLLOW_RELS = ['nofollow', 'ugc', 'sponsored'];

function baseHref(root, pageUrl) {
  const href = root.querySelector('base')?.getAttribute('href');
  return href ? normalizeUrl(href, pageUrl) || pageUrl : pageUrl;
}

function isTemplateOrScriptHref(href) {
  return !href || href.startsWith('#') || /^javascript:/i.test(href)
    || href.includes('${') || href.includes('{{');
}

function extractLinks(root, pageUrl, pageNofollow) {
  const base = baseHref(root, pageUrl);
  const pageHost = new URL(pageUrl).hostname;
  const links = new Map();
  for (const el of root.querySelectorAll('a[href], area[href]')) {
    const href = (el.getAttribute('href') ?? '').trim();
    if (isTemplateOrScriptHref(href)) continue;
    const url = normalizeUrl(href, base);
    if (!url || links.has(url)) continue;
    const rels = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const anchorRel = rels.find(rel => NOFOLLOW_RELS.includes(rel));
    links.set(url, {
      url,
      internal: new URL(url).hostname === pageHost,
      follow: anchorRel ?? (pageNofollow ? 'nofollow' : 'follow'),
      directive_source: anchorRel ? 'anchor' : pageNofollow ? 'meta' : '',
    });
  }
  return [...links.values()];
}

// `finalUrl` is the URL after redirects: relative links resolve against it.
export function parsePage(html, finalUrl, headers = {}) {
  const root = parse(html, PARSE_OPTIONS);
  const meta = extractPageMetadata(root, finalUrl, {
    xRobotsTag: headers['x-robots-tag'] ?? '',
    linkHeader: headers.link ?? '',
  });
  return { meta, links: extractLinks(root, finalUrl, meta.nofollow) };
}
