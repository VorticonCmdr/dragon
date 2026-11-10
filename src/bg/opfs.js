// HTML archive in the origin-private file system: <rootDir>/<crawlId>/<file>.html

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The hash keeps distinct URLs apart; the slug keeps files recognizable in a ZIP.
export async function urlToFilename(url) {
  const { hostname, pathname } = new URL(url);
  const slug = `${hostname}${pathname}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return `${(await sha1Hex(url)).slice(0, 16)}-${slug}.html`;
}

export async function openCrawlDir(rootDir, crawlId) {
  const root = await navigator.storage.getDirectory();
  const archive = await root.getDirectoryHandle(rootDir, { create: true });
  return archive.getDirectoryHandle(crawlId, { create: true });
}

export async function writeHtml(dir, rootDir, crawlId, url, html) {
  const filename = await urlToFilename(url);
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(html);
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
  return `${rootDir}/${crawlId}/${filename}`;
}
