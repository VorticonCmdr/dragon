// Page record (nested, as stored in IndexedDB) → flat table row.
// An explicit field map instead of a generic flatten: no deep clone, and large
// fields such as `links` never reach the table's memory.

export function toRow(page) {
  const f = page.fetch ?? {};
  const og = page.og ?? {};
  const schema = page.schema ?? {};
  const chain = f.redirectChain;
  return {
    href: page.url,
    depth: page.depth ?? null,
    fetch_status: f.status ?? null,
    fetch_statusText: f.statusText ?? '',
    fetch_ok: !!f.ok,
    fetch_duration: f.duration ?? null,
    fetch_redirected: !!f.redirected,
    fetch_redirectStatus: chain?.[0]?.status ?? null,
    fetch_finalUrl: f.finalUrl ?? '',
    fetch_encodedBodySize: f.encodedBodySize ?? null,
    fetch_decodedBodySize: f.decodedBodySize ?? null,
    fetch_contentType: f.contentType ?? '',
    fetch_contentEncoding: f.contentEncoding ?? '',
    fetch_charset: f.charset ?? '',
    fetch_truncated: !!f.truncated,
    fetch_timestamp: f.timestamp ?? '',
    fetch_retries: f.retries ?? 0,
    title: page.title ?? '',
    description: page.description ?? '',
    h1: page.h1 ?? '',
    keyword: page.keyword ?? '',
    canonical: page.canonical ?? '',
    canonicalCount: page.canonicalCount ?? null,
    robots: page.robots ?? '',
    xRobotsTag: page.xRobotsTag ?? '',
    hreflang_count: page.hreflang?.length ?? 0,
    og_image: og.image ?? '',
    og_title: og.title ?? '',
    og_site_name: og.site_name ?? '',
    og_description: og.description ?? '',
    schema_publisher: schema.publisher ?? '',
    schema_dateModified: schema.dateModified ?? '',
    schema_datePublished: schema.datePublished ?? '',
    schema_authors: schema.authors ?? '',
    schema_headline: schema.headline ?? '',
    schema_alternateHeadline: schema.alternateHeadline ?? '',
    isOutbound: !!page.isOutbound,
    crawlable: page.crawlable ?? true,
    blockedByRobots: !!page.blockedByRobots,
    blockReason: page.blockReason ?? '',
    indexable: !!page.indexable,
    outbound_count: page.links?.length ?? null,
    pagerank: page.rank?.pagerank ?? null,
    cheirank: page.rank?.cheirank ?? null,
    pagerank_rank: page.rank?.pagerankRank ?? null,
    cheirank_rank: page.rank?.cheirankRank ?? null,
    opfs_path: page.opfs_path ?? '',
    error: page.error ?? '',
  };
}
