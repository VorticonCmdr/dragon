function urlToFilename(url) {
  try {
    const u = new URL(url);
    const safe = (u.hostname + u.pathname + u.search)
      .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 200);
    return safe + '.html';
  } catch {
    return btoa(url).replace(/[+/=]/g, '_').slice(0, 200) + '.html';
  }
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'write') return;
  const { rootDir, crawlDir, url, html } = data;
  try {
    const root = await navigator.storage.getDirectory();
    const rDir = await root.getDirectoryHandle(rootDir, { create: true });
    const cDir = await rDir.getDirectoryHandle(crawlDir, { create: true });
    const filename = urlToFilename(url);
    const fh = await cDir.getFileHandle(filename, { create: true });
    const handle = await fh.createSyncAccessHandle();
    const encoded = new TextEncoder().encode(html);
    handle.truncate(0);
    handle.write(encoded);
    handle.flush();
    handle.close();
    self.postMessage({ type: 'done', url, path: `${rootDir}/${crawlDir}/${filename}` });
  } catch (e) {
    console.error('opfs-worker write failed:', e);
    self.postMessage({ type: 'error', url, error: e.message });
  }
};
