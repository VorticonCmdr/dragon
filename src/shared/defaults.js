// The single source of truth for crawl settings. Page, service worker and
// schedules all start from this object, so what the UI shows is what is sent.

export const MAX_CONNECTIONS = 32;

export const DEFAULT_SETTINGS = Object.freeze({
  crawlMode: 'list',         // 'list' | 'recursive'
  maxPages: 500,             // only limits recursive crawls
  filterRegex: '',
  filterType: '',            // '' | 'include' | 'exclude'
  stayonhostname: false,
  respectRobots: true,
  fetchOutbound: false,
  maxRetries: 2,
  delay: 0,                  // minimum ms between requests to one origin
  maxConnections: 5,
  credentials: 'omit',
  cache: 'no-store',
  charset: 'utf-8',          // fallback when neither header nor <meta> declare one
  timeoutMs: 25_000,         // under the 30 s after which Chrome kills a SW waiting on fetch
  maxBodyBytes: 5 * 1024 * 1024,
  maxParseBytes: 2 * 1024 * 1024,
  opfsEnabled: false,
  opfsRootDir: 'crawl_archive',
});

const CACHE_MODES = new Set(['no-store', 'reload', 'default', 'force-cache', 'no-cache']);
const CREDENTIALS = new Set(['omit', 'same-origin', 'include']);

// Fill gaps and clamp values, so stale stored settings can never reach the engine.
export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (input[key] !== undefined && input[key] !== null) s[key] = input[key];
  }
  s.maxConnections = clampInt(s.maxConnections, 1, MAX_CONNECTIONS, DEFAULT_SETTINGS.maxConnections);
  s.maxRetries = clampInt(s.maxRetries, 0, 5, DEFAULT_SETTINGS.maxRetries);
  s.delay = clampInt(s.delay, 0, 60_000, DEFAULT_SETTINGS.delay);
  s.maxPages = clampInt(s.maxPages, 1, 1_000_000, DEFAULT_SETTINGS.maxPages);
  // 'only-if-cached' throws for every cross-origin fetch, so it cannot be honoured.
  if (!CACHE_MODES.has(s.cache)) s.cache = 'default';
  if (!CREDENTIALS.has(s.credentials)) s.credentials = 'omit';
  if (s.filterType !== 'include' && s.filterType !== 'exclude') s.filterType = '';
  s.opfsRootDir = String(s.opfsRootDir || '').trim() || DEFAULT_SETTINGS.opfsRootDir;
  return s;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
