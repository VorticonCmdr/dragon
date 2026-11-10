// URL helpers shared by the crawler and the page.

// Absolute http(s) URL without fragment, or '' when `input` is not crawlable.
export function normalizeUrl(input, base) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  let u;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  // Chrome percent-encodes what other parsers reject: 'http://exa mple' becomes
  // the host 'exa%20mple'. No real hostname contains a percent sign.
  if (u.hostname.includes('%')) return '';
  u.hash = '';
  return u.href;
}

// Unique, normalized URLs from free text or an array, in first-seen order.
export function parseUrlList(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const seen = new Set();
  for (const line of lines) {
    const url = normalizeUrl(line);
    if (url) seen.add(url);
  }
  return [...seen];
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function resolveNameTemplate(template, firstUrl, now = new Date()) {
  const hostname = hostnameOf(firstUrl) || firstUrl || 'crawl';
  return String(template || '{hostname} {datetime}')
    .replace(/\{hostname\}/g, hostname)
    .replace(/\{datetime\}/g, now.toLocaleString());
}
