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
    if (publisher?.['@type'] === 'Organization') schema.publisher = publisher.name;

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
      schema.authors = authors.map(a => a?.name).join(', ');
    } else if (authors?.name) {
      schema.authors = authors.name;
    }
    if (!schema.authors) {
      schema.authors = extractAuthors(obj).join(', ');
    }
  });

  return schema;
}

export function extractPageMetadata(root, href) {
  const get = (sel, attr = 'content') => root.querySelector(sel)?.getAttribute(attr) || '';

  let schema;
  try {
    schema = extractSchema(root);
  } catch (e) {
    schema = { publisher: '', dateModified: '', datePublished: '', authors: '', headline: '', alternateHeadline: '' };
  }

  return {
    title: root.querySelector('title')?.textContent?.trim() || '',
    description: get('meta[name="description"]'),
    href,
    og: {
      image: get('meta[property="og:image"]'),
      title: get('meta[property="og:title"]'),
      site_name: get('meta[property="og:site_name"]'),
      description: get('meta[property="og:description"]'),
    },
    robots: get('meta[name="robots"]'),
    canonical: get('link[rel="canonical"]', 'href'),
    h1: root.querySelector('h1')?.textContent?.trim() || '',
    keyword: get('meta[name="keywords"]'),
    schema,
  };
}
