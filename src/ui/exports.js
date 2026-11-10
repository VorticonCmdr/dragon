// ZIP export of a crawl's archived HTML. Stored without compression (HTML in
// OPFS is the source of truth; speed matters more) and built file by file so
// the page stays responsive. A worker is not an option: fflate's async mode
// starts one from a blob URL, which the extension CSP forbids.

import { Zip, ZipPassThrough } from 'fflate';
import { toast } from './components.js';
import { downloadBlob, formatNumber } from './dom.js';
import { state } from './store.js';

function archiveDirOf(session) {
  const path = [...session.rows.values()].find(row => row.opfs_path)?.opfs_path;
  return path ? path.split('/').slice(0, -1) : null;
}

async function openDir(parts) {
  let dir = await navigator.storage.getDirectory();
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  return dir;
}

export async function exportZip() {
  const session = state.session;
  const parts = session && archiveDirOf(session);
  if (!parts) {
    toast('This crawl has no archived HTML.');
    return;
  }
  try {
    const chunks = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    let files = 0;
    for await (const [name, handle] of (await openDir(parts)).entries()) {
      if (handle.kind !== 'file') continue;
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(new Uint8Array(await (await handle.getFile()).arrayBuffer()), true);
      files++;
    }
    zip.end();
    const name = session.meta.name.replace(/[/\\:*?"<>|,]/g, '-').replace(/\s+/g, '_');
    downloadBlob(new Blob(chunks, { type: 'application/zip' }), `${name}.zip`);
    toast(`${formatNumber(files)} archived pages exported.`, 'success');
  } catch (e) {
    toast(`ZIP export failed: ${e.message}`, 'error');
  }
}
