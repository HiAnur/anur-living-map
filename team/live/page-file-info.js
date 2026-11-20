/** The file orders offered in both the tree and the home page. */
export const FILE_SORTS = [
  ['name-asc', 'File name (A to Z)'], ['name-desc', 'File name (Z to A)'],
  ['modified-desc', 'Modified time (new to old)'], ['modified-asc', 'Modified time (old to new)'],
  ['created-desc', 'Created time (new to old)'], ['created-asc', 'Created time (old to new)'],
];

/** @param {string | null | undefined} value @param {string} [fallback] */
export function fileSort(value, fallback = 'name-asc') {
  const key = value === 'time' ? 'modified-desc' : value === 'name' ? 'name-asc' : value;
  return FILE_SORTS.some(([id]) => id === key) ? /** @type {string} */ (key) : fallback;
}

/** A stable order, with unknown dates last in either direction. @param {any[]} files @param {string} sort */
export function orderFiles(files, sort) {
  const key = fileSort(sort), direction = key.endsWith('desc') ? -1 : 1;
  const name = (/** @type {any} */ a, /** @type {any} */ b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), undefined, { sensitivity: 'base', numeric: true }) || String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''));
  return [...files].sort((a, b) => {
    if (key.startsWith('name')) return direction * name(a, b);
    const field = key.startsWith('created') ? 'created' : 'at', A = Number(a[field]) || 0, B = Number(b[field]) || 0;
    return !A || !B ? Number(!A) - Number(!B) || name(a, b) : direction * (A - B) || name(a, b);
  });
}

/** @param {number} at @param {number} [now] */
export function fileAge(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return '';
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

/**
 * File information and the existing map actions, available from the title's (i) and every file's More button.
 * @param {{current:string, beforeNavigate:() => Promise<boolean>, changed:(kind:string, file:any, result:any) => Promise<void>, move:(file:any) => void, navigate?:(href:string) => Promise<boolean>}} deps
 */
export function mountFileInfo({ current, beforeNavigate, changed, move, navigate = async () => false }) {
  const escape = (/** @type {any} */ v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  const svg = (/** @type {string} */ paths) => `<svg viewBox="0 0 20 20" aria-hidden="true">${paths}</svg>`;
  const bookmark = svg('<path d="M5 3h10v14l-5-3-5 3z"/>');
  const cloud = svg('<path d="M5.5 15a4 4 0 110-8 5 5 0 019.5 1A3.5 3.5 0 1115 15z"/>');
  const info = svg('<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6v.2"/>');
  const style = document.createElement('style');
  style.textContent = `
    :root{--file-cloud:#448bb8;--file-cloud-fill:#e0f2ff}
    #top > #file-heading{min-width:0;flex:1 1 0;display:flex;align-items:center;justify-content:center;gap:8px}
    #file-heading #crumbs{flex:0 1 auto;justify-content:flex-start;order:0}
    #file-meta{display:flex;align-items:center;gap:8px;font:12.5px var(--plex);color:var(--text-2);flex-shrink:0}
    #file-meta[hidden]{display:none}#file-meta svg,.file-info svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
    .file-cloud{display:inline-flex;align-items:center;color:var(--file-cloud)}.file-cloud svg{fill:var(--file-cloud-fill)}
    #file-info-button{display:grid;place-items:center;width:26px;height:28px;padding:0;border:0;border-radius:5px;background:none;color:var(--text-2);cursor:pointer}
    #file-info-button:hover,#file-info-button[aria-expanded=true]{background:var(--rule);color:var(--text)}
    .file-info{position:fixed;z-index:65;width:min(330px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:7px;border:1px solid var(--rule-2);border-radius:10px;background:var(--box,#fff);color:var(--text);box-shadow:0 8px 30px var(--rule);font:13px/1.5 var(--plex);user-select:text}
    .file-info h2{font-size:14px;font-weight:500;overflow-wrap:anywhere;margin:2px 0 8px}
    .file-info-details{padding:8px 10px 12px;color:var(--text-2)}.file-info-details p{margin:3px 0}
    .file-info dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;margin:10px 0}
    .file-info dt{color:var(--text-2)}.file-info dd{margin:0;color:var(--text)}
    .file-info .file-location{display:grid;gap:6px;padding-top:10px;margin-top:12px;border-top:1px solid var(--rule)}
    .file-location b{font-weight:500;color:var(--text)}.file-location code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11.5px/1.5 var(--mono,ui-monospace,monospace);user-select:all}
    .file-info button{display:flex;align-items:center;gap:10px;width:100%;border:0;border-radius:6px;padding:8px 10px;background:none;color:var(--text);text-align:left;font:13px var(--plex);cursor:pointer}
    .file-info button:hover{background:var(--canvas)}.file-info button:disabled{opacity:.5;cursor:wait}
    .file-location button{width:max-content;border:1px solid var(--rule-2);font-size:12px;padding:5px 8px}
    .file-info-actions{border-top:1px solid var(--rule);padding-top:5px}.file-info [data-file-action=trash]{color:var(--gone,#b42318)}
    .file-info-error{color:var(--gone,#b42318);padding:4px 10px;font-size:12px}.file-info-error:empty{display:none}
    #file-notice{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;z-index:70;max-width:calc(100vw - 24px);padding:12px 16px;border:1px solid var(--rule-2);border-radius:9px;background:var(--box,#fff);color:var(--text);box-shadow:0 5px 20px var(--rule);font:13px var(--plex)}
    #file-notice button{border:1px solid var(--rule-2);border-radius:5px;background:none;padding:4px 9px;font:12px var(--plex);color:var(--text);cursor:pointer}
    #file-info-button:focus-visible,.file-info button:focus-visible{outline:2px solid var(--new);outline-offset:1px}
    @media(min-width:721px) and (max-width:1100px){body.has-document{--topbar:80px}body.has-document #top{flex-wrap:wrap;align-content:center;gap:6px;padding:6px 12px}body.has-document #top > #file-heading{order:10;flex-basis:100%;justify-content:flex-start;height:28px}body.has-document #top .faces{margin-left:0}}
    @media(max-width:720px){body.has-document #top .faces{margin-left:0}#top > #file-heading{order:10;flex-basis:100%;justify-content:flex-start;height:28px}#file-heading #crumbs{flex:0 1 auto}#file-meta .file-edited{font-size:12px}}
    @media(max-width:540px){body.has-document{--topbar:112px}#top > #file-heading{height:28px}#document-tabs button{padding:0 9px}}
  `;
  document.head.append(style);
  const header = document.createElement('span'); header.id = 'file-meta'; header.hidden = true;
  if (current) {
    const crumbs = document.getElementById('crumbs');
    if (crumbs) { const heading = document.createElement('div'); heading.id = 'file-heading'; crumbs.before(heading); heading.append(crumbs, header); }
  }
  /** @type {any} */ let active = null;
  /** @type {HTMLElement | null} */ let trigger = null;
  const fullDate = (/** @type {number} */ at) => at > 0 ? new Date(at).toLocaleString() : 'Not recorded';
  /** @param {string} route @param {any} [data] */
  async function request(route, data) {
    const r = await window.fetch(route, data ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : undefined);
    const result = await r.json(); if (!r.ok) throw new Error(result.error || 'That change could not be saved. Try again.'); return result;
  }
  function close(focus = false) {
    document.getElementById('file-info')?.remove(); trigger?.setAttribute('aria-expanded', 'false');
    if (focus && trigger?.isConnected) trigger.focus();
  }
  /** @param {any} file @param {HTMLElement} anchor */
  function show(file, anchor) {
    const was = trigger === anchor && !!document.getElementById('file-info'); close(); if (was) return;
    trigger = anchor; anchor.setAttribute('aria-expanded', 'true');
    const el = document.createElement('section'); el.id = 'file-info'; el.className = 'file-info'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', `${file.title} details and actions`);
    const parts = String(file.folder || '').split(/[\\/]/).filter(Boolean), short = parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : file.folder;
    el.innerHTML = `<div class="file-info-details"><h2>${escape(file.title)}</h2>${file.system ? `<p>${file.system === 'running' ? 'Drawing from code' : 'System map'}</p>${file.repos ? `<p>${file.repos} ${file.repos === 1 ? 'repo' : 'repos'}${file.drawn ? ` · Drawn ${fileAge(file.drawn)} ago` : ''}</p>` : ''}${file.newCommits ? `<p>${file.newCommits} ${file.newCommits === 1 ? 'repo' : 'repos'} changed since</p>` : ''}` : ''}<p>${file.cloud ? 'A copy is stored in the cloud.' : 'Stored on this Mac.'}</p>${file.shared ? '<p>Shared by link</p>' : ''}<dl><dt>Last edited</dt><dd>${escape(fullDate(file.at))}</dd><dt>Created</dt><dd>${escape(fullDate(file.created))}</dd></dl>${file.folder ? `<div class="file-location"><b>Local folder</b><code title="${escape(file.folder)}">${escape(short)}</code><button type="button" data-file-action="copy">Copy folder location</button></div>` : ''}</div><div class="file-info-actions"><button type="button" data-file-action="bookmark" aria-pressed="${!!file.bookmarked}">${bookmark}${file.bookmarked ? 'Remove bookmark' : 'Bookmark'}</button><button type="button" data-file-action="move">${svg('<path d="M2.5 5.5h6l2-2h7v13h-15zM7 10h6m-2-2 2 2-2 2"/>')}Move to folder</button>${file.deletable ? `<button type="button" data-file-action="duplicate">${svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M12 7V3H3v9h4"/>')}Duplicate</button><button type="button" data-file-action="trash">${svg('<path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/>')}Move to Trash</button>` : ''}</div><p class="file-info-error" role="alert"></p>`;
    const rect = anchor.getBoundingClientRect();
    const sidebar = anchor.closest('#files-pane');
    el.style.left = `${Math.max(12, Math.min(innerWidth - 342, sidebar && innerWidth >= 700 ? sidebar.getBoundingClientRect().right + 8 : rect.right - 330))}px`;
    el.addEventListener('click', async (e) => {
      const button = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-file-action]')); if (!button) return;
      const action = button.dataset.fileAction; button.disabled = true;
      try {
        if (action === 'copy') { await navigator.clipboard.writeText(file.folder); button.textContent = 'Copied'; }
        else if (action === 'move') { close(); move(file); }
        else if (action === 'bookmark') { const r = await request('/api/maps/pin', { name: file.name, pinned: !file.bookmarked }); close(); await changed('bookmark', file, r); }
        else if (action === 'duplicate' || action === 'trash') {
          if (!await beforeNavigate()) return;
          const r = await request(`/api/maps/${action}`, { name: file.name });
          close(); await changed(action, file, r);
          if (action === 'duplicate') { const href = `${r.href}?document=${file.view || 'map'}`; if (!await navigate(href)) location.href = href; }
          else { notify(`Moved “${file.title}” to Trash.`, r.trashId); if (file.name === current) location.href = '/'; }
        }
      } catch (/** @type {any} */ error) { /** @type {HTMLElement} */ (el.querySelector('[role=alert]')).textContent = error.message || 'Could not complete that action. Try again.'; }
      finally { button.disabled = false; }
    });
    document.body.append(el); el.style.top = `${Math.max(12, Math.min(innerHeight - el.getBoundingClientRect().height - 12, rect.bottom + 8))}px`; el.querySelector('button')?.focus({ preventScroll: true });
  }
  /** @param {string} text @param {string} [id] */
  function notify(text, id = '') {
    document.getElementById('file-notice')?.remove();
    try { sessionStorage.setItem('lm.file-trash', JSON.stringify({ text, id })); } catch { /* the notice still works on this page */ }
    const el = document.createElement('div'); el.id = 'file-notice'; el.setAttribute('role', 'status');
    el.innerHTML = `<span>${escape(text)}</span>${id ? '<button type="button" data-undo>Undo</button>' : ''}<button type="button" data-dismiss aria-label="Dismiss message">×</button>`;
    el.querySelector('[data-dismiss]')?.addEventListener('click', () => { el.remove(); try { sessionStorage.removeItem('lm.file-trash'); } catch { /* already dismissed here */ } });
    el.querySelector('[data-undo]')?.addEventListener('click', async () => {
      try { const r = await request('/api/maps/restore', { id }); await changed('restore', {}, r); notify('File restored.'); }
      catch (/** @type {any} */ e) { /** @type {HTMLElement} */ (el.querySelector('span')).textContent = e.message; }
    });
    document.body.append(el);
  }
  try { const saved = JSON.parse(sessionStorage.getItem('lm.file-trash') || 'null'); if (saved?.text) notify(saved.text, saved.id); } catch { /* no notice to restore */ }
  document.addEventListener('click', (e) => { if (!/** @type {HTMLElement} */ (e.target).closest('#file-info, #file-info-button, [data-file-more]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('file-info')) { e.preventDefault(); close(true); } });
  function render() {
    header.hidden = !active;
    if (!active) return;
    header.innerHTML = `${active.cloud ? `<span class="file-cloud" role="img" aria-label="Stored in the cloud" title="A copy of this file is stored in the cloud.">${cloud}</span>` : ''}<span class="file-edited" aria-label="Last edited ${escape(fileAge(active.at))}" title="Last edited ${escape(fullDate(active.at))}">${escape(fileAge(active.at))}</span><button type="button" id="file-info-button" aria-label="File information" title="File information" aria-expanded="false">${info}</button>`;
    header.querySelector('button')?.addEventListener('click', (e) => show(active, /** @type {HTMLElement} */ (e.currentTarget)));
  }
  const timer = setInterval(render, 60000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return { show, close, notify, bookmark, cloud, setCurrent: (/** @type {string} */ name) => { current = name; }, update: (/** @type {any} */ file) => { active = file; render(); } };
}
