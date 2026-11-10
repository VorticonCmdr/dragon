// A single page fetch: retries, timeouts, content gating, size limit, charset.

const HEADER_ALLOWLIST = [
  'content-type', 'x-robots-tag', 'link', 'cache-control', 'content-encoding', 'last-modified', 'server',
];
const MAX_RETRY_AFTER_MS = 60_000;

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

function backoffMs(attempt) {
  return Math.min(1000 * 2 ** attempt, 30_000) + Math.random() * 250;
}

function retryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isNaN(seconds) ? Date.parse(value) - Date.now() : seconds * 1000;
  return Number.isNaN(ms) ? null : Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

function pickHeaders(response) {
  const headers = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function isHtml(contentType) {
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

async function readCapped(response, maxBytes) {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - length));
      length = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    length += value.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, truncated };
}

function charsetFromContentType(contentType) {
  return contentType.match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1] ?? '';
}

// The HTML spec only looks for <meta charset> in the first 1024 bytes.
function charsetFromMeta(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i)?.[1] ?? '';
}

function decodeBody(bytes, contentType, fallback) {
  const candidates = [charsetFromContentType(contentType), charsetFromMeta(bytes), fallback, 'utf-8'];
  for (const charset of candidates.filter(Boolean)) {
    try {
      return { html: new TextDecoder(charset).decode(bytes), charset: charset.toLowerCase() };
    } catch {
      // Unknown label: try the next candidate.
    }
  }
  return { html: '', charset: '' };
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

// Stop/abort must surface as-is; anything else is a page-level failure.
function isAbort(error, signal) {
  return signal?.aborted && (error === signal.reason || error?.name === 'AbortError');
}

export async function fetchPage(url, settings, { signal } = {}) {
  let lastError;
  let attempt = 0;
  for (; attempt <= settings.maxRetries; attempt++) {
    const started = performance.now();
    const signals = [AbortSignal.timeout(settings.timeoutMs)];
    if (signal) signals.push(signal);
    try {
      const response = await fetch(url, {
        cache: settings.cache,
        credentials: settings.credentials,
        signal: AbortSignal.any(signals),
      });

      if (isRetryableStatus(response.status) && attempt < settings.maxRetries) {
        const wait = retryAfterMs(response) ?? backoffMs(attempt);
        await response.body?.cancel();
        await sleep(wait, signal);
        continue;
      }
      return await readResponse(response, url, settings, started, attempt);
    } catch (e) {
      if (isAbort(e, signal)) throw e;
      lastError = e;
      if (attempt < settings.maxRetries) await sleep(backoffMs(attempt), signal);
    }
  }
  const error = new Error(lastError?.name === 'TimeoutError' ? 'timeout' : lastError?.message ?? 'fetch failed');
  error.retries = settings.maxRetries;
  throw error;
}

async function readResponse(response, url, settings, started, retries) {
  const contentType = response.headers.get('content-type') ?? '';
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10) || 0;
  const headers = pickHeaders(response);
  const summary = {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    redirected: response.redirected,
    finalUrl: response.redirected ? response.url : undefined,
    contentType,
    contentEncoding: response.headers.get('content-encoding') ?? '',
    timestamp: new Date().toISOString(),
    retries,
  };

  // Binary files and other non-HTML bodies are never downloaded.
  if (!isHtml(contentType)) {
    await response.body?.cancel();
    return {
      fetch: {
        ...summary,
        duration: Math.round(performance.now() - started),
        encodedBodySize: declaredLength,
        decodedBodySize: declaredLength,
      },
      headers,
      html: null,
    };
  }

  const { bytes, truncated } = await readCapped(response, settings.maxBodyBytes);
  const { html, charset } = decodeBody(bytes, contentType, settings.charset);
  return {
    fetch: {
      ...summary,
      duration: Math.round(performance.now() - started),
      encodedBodySize: declaredLength || bytes.byteLength,
      decodedBodySize: bytes.byteLength,
      charset,
      truncated,
    },
    headers,
    html,
  };
}

// Liveness check of an external link: HEAD, falling back to a one-byte GET for
// servers that reject HEAD. No retries and no body: it only needs a status.
export async function checkLink(url, settings, { signal } = {}) {
  const started = performance.now();
  const request = (method, headers) => fetch(url, {
    method,
    headers,
    cache: settings.cache,
    credentials: 'omit',
    signal: AbortSignal.any([AbortSignal.timeout(settings.timeoutMs), ...(signal ? [signal] : [])]),
  });
  let response = await request('HEAD');
  if (response.status === 405 || response.status === 501 || response.status === 403) {
    response = await request('GET', { Range: 'bytes=0-0' });
    await response.body?.cancel();
  }
  return {
    fetch: {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      redirected: response.redirected,
      finalUrl: response.redirected ? response.url : undefined,
      contentType: response.headers.get('content-type') ?? '',
      timestamp: new Date().toISOString(),
      duration: Math.round(performance.now() - started),
    },
    headers: pickHeaders(response),
  };
}
