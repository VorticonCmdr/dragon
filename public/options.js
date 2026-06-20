const PRESETS = [
  { label: 'Googlebot Desktop', value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://google.com)' },
  { label: 'Googlebot Smartphone', value: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://google.com)' },
  { label: 'Googlebot-Image', value: 'Googlebot-Image/1.0' },
  { label: 'Googlebot-Video', value: 'Googlebot-Video/1.0' },
  { label: 'Google-Other', value: 'Mozilla/5.0 (compatible; Google-Other; +http://google.com)' },
  { label: 'Bingbot Desktop', value: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://bing.com)' },
  { label: 'Bingbot Mobile', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.1 Mobile/15E148 Safari/604.1 (compatible; bingbot/2.0; +http://bing.com)' },
  { label: 'YandexBot', value: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com)' },
  { label: 'Baiduspider', value: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://baidu.com)' },
  { label: 'DuckDuckBot', value: 'DuckDuckBot/1.1; (+http://duckduckgo.com)' },
  { label: 'GPTBot', value: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com)' },
  { label: 'ClaudeBot', value: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' },
  { label: 'Custom…', value: '__custom__' },
  { label: 'Default (Browser UA)', value: '' },
];

const DEFAULT_UA = PRESETS[0].value;
const DNR_RULE_ID = 10;

async function applyUA(ua) {
  if (!ua) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [DNR_RULE_ID] });
    return;
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [{
      id: DNR_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'User-Agent', operation: 'set', value: ua }],
      },
      condition: {
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const select = document.getElementById('preset');
  const customWrap = document.getElementById('customWrap');
  const customUA = document.getElementById('customUA');
  const currentUAEl = document.getElementById('currentUA');
  const status = document.getElementById('status');

  PRESETS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.value;
    opt.textContent = p.label;
    select.appendChild(opt);
  });

  const { userAgent = DEFAULT_UA } = await chrome.storage.local.get('userAgent');
  const isCustom = userAgent !== '' && !PRESETS.some(p => p.value === userAgent);
  if (isCustom) {
    select.value = '__custom__';
    customUA.value = userAgent;
    customWrap.style.display = 'block';
  } else {
    select.value = userAgent;
  }
  currentUAEl.textContent = userAgent || '(Browser default)';

  select.addEventListener('change', () => {
    customWrap.style.display = select.value === '__custom__' ? 'block' : 'none';
  });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const ua = select.value === '__custom__'
      ? customUA.value.trim()
      : select.value;
    await chrome.storage.local.set({ userAgent: ua });
    await applyUA(ua);
    currentUAEl.textContent = ua || '(Browser default)';
    status.textContent = 'Saved.';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });

  // ── URL-Filter Presets ───────────────────────────────────────────────────

  const presetList = document.getElementById('presetList');
  const regexStatus = document.getElementById('regexStatus');

  function renderPresets(presets) {
    presetList.innerHTML = '';
    if (!presets.length) {
      presetList.innerHTML = '<span class="empty-hint">No presets saved yet.</span>';
      return;
    }
    presets.forEach(p => {
      const row = document.createElement('div');
      row.className = 'preset-row';
      row.innerHTML = `
        <span class="preset-name">${escapeHtml(p.name)}</span>
        <span class="preset-regex" title="${escapeHtml(p.regex)}">${escapeHtml(p.regex)}</span>
        <span class="badge badge-${p.type}">${p.type}</span>
        <button class="btn-delete" data-id="${p.id}">✕</button>
      `;
      presetList.appendChild(row);
    });

    presetList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { regexPresets = [] } = await chrome.storage.local.get('regexPresets');
        const updated = regexPresets.filter(p => p.id !== btn.dataset.id);
        await chrome.storage.local.set({ regexPresets: updated });
        renderPresets(updated);
      });
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const { regexPresets: initialPresets = [] } = await chrome.storage.local.get('regexPresets');
  renderPresets(initialPresets);

  document.getElementById('addPresetBtn').addEventListener('click', async () => {
    const name = document.getElementById('newName').value.trim();
    const regex = document.getElementById('newRegex').value.trim();
    const type = document.getElementById('newType').value;

    if (!name || !regex) {
      regexStatus.style.color = '#dc2626';
      regexStatus.textContent = 'Name and regex are required.';
      setTimeout(() => { regexStatus.textContent = ''; }, 2500);
      return;
    }

    try {
      new RegExp(regex);
    } catch {
      regexStatus.style.color = '#dc2626';
      regexStatus.textContent = 'Invalid regex.';
      setTimeout(() => { regexStatus.textContent = ''; }, 2500);
      return;
    }

    const { regexPresets = [] } = await chrome.storage.local.get('regexPresets');
    const newPreset = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, regex, type };
    const updated = [...regexPresets, newPreset];
    await chrome.storage.local.set({ regexPresets: updated });
    renderPresets(updated);

    document.getElementById('newName').value = '';
    document.getElementById('newRegex').value = '';
    document.getElementById('newType').value = 'include';
    regexStatus.style.color = '#16a34a';
    regexStatus.textContent = 'Preset saved.';
    setTimeout(() => { regexStatus.textContent = ''; }, 2000);
  });

  // ── Crawl Manager ────────────────────────────────────────────────────────

  const crawlList = document.getElementById('crawlList');
  const cmStatus = document.getElementById('crawlManagerStatus');

  function formatBytes(b) {
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }

  function cmMsg(text, ok = true) {
    cmStatus.style.color = ok ? '#16a34a' : '#dc2626';
    cmStatus.textContent = text;
    setTimeout(() => { cmStatus.textContent = ''; }, 3000);
  }

  // ── ZIP (store-only, no compression) ──────────────────────────────────────

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function concatBytes(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  function buildZip(files) {
    const enc = new TextEncoder();
    const locals = [], cds = [];
    let localOffset = 0;
    for (const { name, data } of files) {
      const nb = enc.encode(name);
      const crc = crc32(data);
      const local = new Uint8Array(30 + nb.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true); lv.setUint16(26, nb.length, true);
      local.set(nb, 30);
      const cd = new Uint8Array(46 + nb.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true); cv.setUint16(28, nb.length, true);
      cv.setUint32(42, localOffset, true); cd.set(nb, 46);
      cds.push(cd);
      locals.push(local, data);
      localOffset += local.length + data.length;
    }
    const cdBytes = concatBytes(cds);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdBytes.length, true); ev.setUint32(16, localOffset, true);
    return concatBytes([...locals, cdBytes, eocd]);
  }

  // ── OPFS helpers ──────────────────────────────────────────────────────────

  async function getOpfsRootDir() {
    const { opfsSettings = {} } = await chrome.storage.local.get('opfsSettings');
    return opfsSettings.rootDir || 'crawl_archive';
  }

  async function getOpfsCrawls(rootDirName) {
    try {
      const root = await navigator.storage.getDirectory();
      const rootDir = await root.getDirectoryHandle(rootDirName);
      const crawls = [];
      for await (const [name, handle] of rootDir.entries()) {
        if (handle.kind !== 'directory') continue;
        let size = 0, fileCount = 0;
        for await (const [, fh] of handle.entries()) {
          if (fh.kind !== 'file') continue;
          const f = await fh.getFile();
          size += f.size; fileCount++;
        }
        crawls.push({ dirName: name, size, fileCount });
      }
      return crawls;
    } catch { return []; }
  }

  async function deleteOpfsDir(rootDirName, crawlDirName) {
    const root = await navigator.storage.getDirectory();
    const rootDir = await root.getDirectoryHandle(rootDirName);
    await rootDir.removeEntry(crawlDirName, { recursive: true });
  }

  async function exportZip(rootDirName, crawlDirName, filename) {
    const root = await navigator.storage.getDirectory();
    const crawlDir = await (await root.getDirectoryHandle(rootDirName)).getDirectoryHandle(crawlDirName);
    const files = [];
    for await (const [name, handle] of crawlDir.entries()) {
      if (handle.kind !== 'file') continue;
      files.push({ name, data: new Uint8Array(await (await handle.getFile()).arrayBuffer()) });
    }
    if (!files.length) { cmMsg('No OPFS files found.', false); return; }
    const zip = buildZip(files);
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([zip], { type: 'application/zip' })),
      download: filename,
    });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ── Inline rename ─────────────────────────────────────────────────────────

  function startInlineRename(nameEl, crawlId) {
    const current = nameEl.textContent;
    const input = document.createElement('input');
    input.value = current;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus(); input.select();
    async function commit() {
      const newName = input.value.trim() || current;
      try {
        await crawlDB.rename(crawlId, newName);
        nameEl.textContent = newName;
        cmMsg('Renamed.');
      } catch { nameEl.textContent = current; }
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = current; }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  async function loadCrawlManager() {
    const rootDirName = await getOpfsRootDir();

    const [estimate, idbEntries, opfsCrawls] = await Promise.all([
      navigator.storage.estimate(),
      crawlDB.list(),
      getOpfsCrawls(rootDirName),
    ]);

    // Quota bar
    const pct = estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0;
    document.getElementById('quotaFill').style.width = pct + '%';
    document.getElementById('quotaLabel').textContent =
      `Storage: ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} (${pct}%)`;

    // Build maps
    const idbMap = new Map(idbEntries.map(e => [e.id, e]));
    const opfsMap = new Map(opfsCrawls.map(c => [c.dirName, c]));

    // All crawl IDs (union)
    const allIds = new Set([...idbMap.keys(), ...opfsMap.keys()]);

    if (!allIds.size) {
      crawlList.innerHTML = '<span class="crawl-empty">No saved crawls found.</span>';
      return;
    }

    crawlList.innerHTML = '';
    // Sort: IDB entries by id desc (newest first), orphans last
    const sorted = [...allIds].sort((a, b) => {
      const aIsOrphan = !idbMap.has(a);
      const bIsOrphan = !idbMap.has(b);
      if (aIsOrphan !== bIsOrphan) return aIsOrphan ? 1 : -1;
      return b.localeCompare(a);
    });

    for (const id of sorted) {
      const idb = idbMap.get(id);
      const opfs = opfsMap.get(id);
      const isOrphan = !idb;

      const row = document.createElement('div');
      row.className = 'crawl-row' + (isOrphan ? ' orphan' : '');

      const displayName = idb?.name || id;

      // Meta line
      const metaParts = [];
      if (idb) metaParts.push('IDB');
      if (opfs) metaParts.push(`OPFS: ${formatBytes(opfs.size)} · ${opfs.fileCount} files`);

      // Actions
      const actions = [];
      if (idb) actions.push(`<button class="btn-sm btn-rename" data-id="${id}">Rename</button>`);
      if (opfs) actions.push(`<button class="btn-sm btn-zip" data-id="${id}" data-dir="${opfs.dirName}">↓ ZIP</button>`);
      if (idb && !opfs) actions.push(`<button class="btn-sm danger btn-del-idb" data-id="${id}">Delete IDB</button>`);
      if (idb && opfs) {
        actions.push(`<button class="btn-sm danger btn-del-idb" data-id="${id}">Delete IDB</button>`);
        actions.push(`<button class="btn-sm danger btn-del-opfs" data-dir="${opfs.dirName}">Delete OPFS</button>`);
        actions.push(`<button class="btn-sm danger btn-del-all" data-id="${id}" data-dir="${opfs.dirName}">Delete all</button>`);
      }
      if (isOrphan && opfs) {
        actions.push(`<button class="btn-sm danger btn-del-opfs" data-dir="${opfs.dirName}">Delete OPFS</button>`);
      }

      row.innerHTML = `
        <div class="crawl-row-top">
          <span class="crawl-row-name">${isOrphan ? '' : escapeHtml(displayName)}</span>
          ${isOrphan ? '<span class="orphan-badge">⚠ no IDB entry</span>' : ''}
          ${isOrphan ? `<span style="font-size:0.75rem;color:#92400e;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(id)}</span>` : ''}
        </div>
        <div class="crawl-row-meta">${metaParts.join(' · ')}</div>
        <div class="crawl-row-actions">${actions.join('')}</div>`;

      crawlList.appendChild(row);
    }

    // Wire up actions
    crawlList.querySelectorAll('.btn-rename').forEach(btn => {
      btn.addEventListener('click', () => {
        const nameEl = btn.closest('.crawl-row').querySelector('.crawl-row-name');
        startInlineRename(nameEl, btn.dataset.id);
      });
    });

    crawlList.querySelectorAll('.btn-zip').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '…';
        await exportZip(rootDirName, btn.dataset.dir, btn.dataset.dir + '.zip');
        btn.disabled = false; btn.textContent = '↓ ZIP';
      });
    });

    crawlList.querySelectorAll('.btn-del-idb').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete IDB entry? OPFS files will be kept.')) return;
        await crawlDB.remove(btn.dataset.id);
        cmMsg('IDB entry deleted.');
        await loadCrawlManager();
      });
    });

    crawlList.querySelectorAll('.btn-del-opfs').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete OPFS directory "${btn.dataset.dir}"?`)) return;
        await deleteOpfsDir(rootDirName, btn.dataset.dir);
        cmMsg('OPFS data deleted.');
        await loadCrawlManager();
      });
    });

    crawlList.querySelectorAll('.btn-del-all').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete IDB entry and all OPFS data?')) return;
        await Promise.all([
          crawlDB.remove(btn.dataset.id),
          deleteOpfsDir(rootDirName, btn.dataset.dir),
        ]);
        cmMsg('Crawl deleted.');
        await loadCrawlManager();
      });
    });
  }

  loadCrawlManager();
});
