// Records redirect hops of the crawler's own requests. fetch() cannot report
// them: `redirect: 'manual'` yields an opaque response without status or
// Location. webRequest sees each hop's status and target.

const chains = new Map();          // requested URL → [{url, status, location}]
const requestToUrl = new Map();    // webRequest requestId → requested URL
let tracked = null;

export function trackRedirects(inflight) {
  tracked = inflight;
}

export function initRedirectListener() {
  if (!chrome.webRequest?.onBeforeRedirect) return;
  chrome.webRequest.onBeforeRedirect.addListener(details => {
    if (!tracked || details.tabId !== -1) return;
    if (details.initiator && !details.initiator.includes(chrome.runtime.id)) return;
    // Hops share a requestId, so later hops are matched even though their URL
    // is no longer the one the crawler asked for.
    const requested = requestToUrl.get(details.requestId) ?? (tracked.has(details.url) ? details.url : null);
    if (!requested) return;
    requestToUrl.set(details.requestId, requested);
    const chain = chains.get(requested) ?? [];
    chain.push({ url: details.url, status: details.statusCode, location: details.redirectUrl });
    chains.set(requested, chain);
  }, { urls: ['<all_urls>'], types: ['xmlhttprequest', 'other'] });
}

export function takeChain(url) {
  const chain = chains.get(url);
  if (!chain) return undefined;
  chains.delete(url);
  for (const [id, requested] of requestToUrl) {
    if (requested === url) requestToUrl.delete(id);
  }
  return chain;
}
