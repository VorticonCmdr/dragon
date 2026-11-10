import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUrl, parseUrlList } from '../../src/shared/url.js';
import { decodeXmlEntities, parseSitemapXml } from '../../src/shared/sitemap.js';

test('normalizeUrl keeps crawlable URLs only', () => {
  assert.equal(normalizeUrl(' https://a.b/x#frag '), 'https://a.b/x');
  assert.equal(normalizeUrl('rel', 'https://a.b/dir/'), 'https://a.b/dir/rel');
  assert.equal(normalizeUrl('mailto:a@b.c'), '');
  assert.equal(normalizeUrl(''), '');
});

test('parseUrlList drops duplicates and invalid lines', () => {
  assert.deepEqual(parseUrlList('https://a.b/\nnonsense\nhttps://a.b/#x\n\nhttps://a.b/2'), ['https://a.b/', 'https://a.b/2']);
});

test('sitemaps: entities, CDATA and image locations', () => {
  const { kind, urls } = parseSitemapXml('<urlset><url><loc>https://a.b/?x=1&amp;y=2</loc><image:image><image:loc>https://a.b/i.png</image:loc></image:image></url><url><loc><![CDATA[https://a.b/q]]></loc></url></urlset>');
  assert.equal(kind, 'urlset');
  assert.deepEqual(urls, ['https://a.b/?x=1&y=2', 'https://a.b/q']);
  assert.equal(decodeXmlEntities('&#65;&#x42;&lt;'), 'AB<');
});

test('sitemap indexes are recognised', () => {
  const { kind, urls } = parseSitemapXml('<sitemapindex><sitemap><loc>https://a.b/s.xml</loc></sitemap></sitemapindex>');
  assert.equal(kind, 'index');
  assert.deepEqual(urls, ['https://a.b/s.xml']);
});
