import '@fontsource-variable/plus-jakarta-sans';

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function load() {
  const { robotsFetched = {}, robotsOverrides = {} } =
    await chrome.storage.local.get(['robotsFetched', 'robotsOverrides']);

  const list = document.getElementById('robotsList');
  list.innerHTML = '';

  const origins = [...new Set([...Object.keys(robotsFetched), ...Object.keys(robotsOverrides)])].sort();

  if (origins.length === 0) {
    list.innerHTML = '<p class="hint">No robots.txt files yet. Run a crawl, or add an override below.</p>';
    return;
  }

  origins.forEach(origin => {
    const fetched = robotsFetched[origin];
    const override = robotsOverrides[origin];
    const hasOverride = override !== undefined;

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.origin = origin;

    const fetchedHtml = fetched != null
      ? `<label class="field">
           <span class="field-label">Fetched robots.txt</span>
           <textarea class="input input-mono" readonly rows="6">${fetched ? escHtml(fetched) : ''}</textarea>
         </label>`
      : '';

    card.innerHTML = `
      <div class="robots-head">
        <span class="robots-origin">${escHtml(origin)}</span>
        <span class="pill ${hasOverride ? 'pill-3xx' : 'pill-blocked'}">${hasOverride ? 'Override active' : 'As fetched'}</span>
      </div>
      <div class="robots-cols">
        ${fetchedHtml}
        <label class="field">
          <span class="field-label">Override (empty allows everything)</span>
          <textarea class="input input-mono override-input" rows="6" spellcheck="false"
            placeholder="User-agent: *&#10;Disallow:">${hasOverride ? escHtml(override) : ''}</textarea>
        </label>
      </div>
      <div class="form-row">
        <button class="btn btn-primary save-btn">Save override</button>
        ${hasOverride ? '<button class="btn clear-btn">Remove override</button>' : ''}
        <button class="btn btn-ghost fetch-btn">Fetch again</button>
        <span class="status-msg card-status" role="status"></span>
      </div>`;

    list.appendChild(card);
  });

  list.querySelectorAll('.save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const origin = card.dataset.origin;
      const content = card.querySelector('.override-input').value;
      const { robotsOverrides = {} } = await chrome.storage.local.get('robotsOverrides');
      robotsOverrides[origin] = content;
      await chrome.storage.local.set({ robotsOverrides });
      card.querySelector('.card-status').textContent = 'Saved.';
      setTimeout(() => load(), 1000);
    });
  });

  list.querySelectorAll('.clear-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const origin = btn.closest('.card').dataset.origin;
      const { robotsOverrides = {} } = await chrome.storage.local.get('robotsOverrides');
      delete robotsOverrides[origin];
      await chrome.storage.local.set({ robotsOverrides });
      load();
    });
  });

  list.querySelectorAll('.fetch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const origin = card.dataset.origin;
      const status = card.querySelector('.card-status');
      btn.disabled = true;
      status.textContent = 'Fetching…';
      try {
        const res = await fetch(`${origin}/robots.txt`, { cache: 'no-cache', credentials: 'omit' });
        const text = res.ok ? await res.text() : '';
        const { robotsFetched = {} } = await chrome.storage.local.get('robotsFetched');
        robotsFetched[origin] = text;
        await chrome.storage.local.set({ robotsFetched });
        status.textContent = 'Fetched.';
      } catch {
        status.textContent = 'Fetch failed.';
      }
      setTimeout(() => load(), 800);
    });
  });
}

document.getElementById('fetchNewBtn').addEventListener('click', async () => {
  let origin = document.getElementById('newOrigin').value.trim().replace(/\/$/, '');
  const status = document.getElementById('addStatus');

  try { origin = new URL(origin).origin; } catch {
    status.textContent = 'Invalid URL.';
    setTimeout(() => { status.textContent = ''; }, 2000);
    return;
  }

  const btn = document.getElementById('fetchNewBtn');
  btn.disabled = true;
  status.textContent = 'Fetching…';
  try {
    const res = await fetch(`${origin}/robots.txt`, { cache: 'no-cache', credentials: 'omit' });
    const text = res.ok ? await res.text() : '';
    document.getElementById('newContent').value = text;
    document.getElementById('newOrigin').value = origin;
    status.textContent = text ? 'Fetched.' : 'No robots.txt found.';
  } catch {
    status.textContent = 'Fetch failed.';
  }
  btn.disabled = false;
  setTimeout(() => { status.textContent = ''; }, 2000);
});

document.getElementById('addBtn').addEventListener('click', async () => {
  let origin = document.getElementById('newOrigin').value.trim().replace(/\/$/, '');
  const content = document.getElementById('newContent').value;
  const status = document.getElementById('addStatus');

  try { origin = new URL(origin).origin; } catch {
    status.textContent = 'Invalid URL.';
    setTimeout(() => { status.textContent = ''; }, 2000);
    return;
  }

  const { robotsOverrides = {} } = await chrome.storage.local.get('robotsOverrides');
  robotsOverrides[origin] = content;
  await chrome.storage.local.set({ robotsOverrides });

  document.getElementById('newOrigin').value = '';
  document.getElementById('newContent').value = '';
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 1500);
  load();
});

load();
