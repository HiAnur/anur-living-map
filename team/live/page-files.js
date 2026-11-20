/**
 * The same folder tree beside the home page and an open document. Local only: a shared map never lists other
 * documents, and a saved file needs no server. All content in the tree is escaped before it reaches HTML.
 * @param {{current?: string, beforeNavigate?: () => Promise<boolean>, navigate?: (href:string) => Promise<boolean>, resized?: () => void, folderChanged?: (folder:string) => void, fileUI?: {mount: typeof import('./page-file-info.js').mountFileInfo, sorts: string[][], normalize: typeof import('./page-file-info.js').fileSort, order: typeof import('./page-file-info.js').orderFiles}}} options
 */
export function mountFiles({ current = '', beforeNavigate = async () => true, navigate = async () => false, resized = () => {}, folderChanged = () => {}, fileUI } = {}) {
  const escape = (/** @type {any} */ v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  const style = document.createElement('style');
  style.textContent = `
    body{--files-width:248px;--files-left:0px}
    body.files-open{--files-left:var(--files-width)}
    #files-toggle{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule-2);border-radius:7px;background:var(--box,#fff);padding:5px 7px;font:12.5px var(--plex);color:var(--text);cursor:pointer}
    #files-toggle[hidden]{display:none}#files-toggle .files-sidebar-fill{fill:currentColor;stroke:none;opacity:0}#files-toggle[aria-expanded=true] .files-sidebar-fill{opacity:1}#files-toggle svg,#files-pane svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
    #files-pane{position:fixed;top:var(--topbar,44px);left:0;bottom:0;width:var(--files-width);z-index:18;background:var(--canvas);border-right:1px solid var(--rule);display:flex;flex-direction:column;transform:translateX(-100%);visibility:hidden}
    .files-open #files-pane{transform:none;visibility:visible}
    .files-open #canvas{left:var(--files-width)}
    .files-open .home{margin-left:var(--files-width)}
    .files-open #sysdraw{left:calc(var(--files-width) + 16px);width:min(400px,calc(100% - var(--files-width) - 104px))}
    .files-open #legend{left:calc(var(--files-width) + 16px)}
    .files-open #backb{left:calc(var(--files-width) + 16px)}
    .files-open #tools{left:calc(var(--files-width) + (100% - var(--files-width) - 72px)/2)}
    .files-open.paned #tools{left:calc(var(--files-width) + (100% - var(--files-width) - 72px - var(--pane-width))/2)}
    .files-head{height:48px;flex-shrink:0;display:flex;align-items:center;padding:0 10px;gap:4px;border-bottom:1px solid var(--rule)}
    .files-head a{color:var(--text);font-size:13px;font-weight:500;text-decoration:none;margin-right:auto}
    .files-head button,.files-more,.files-new summary{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:none;color:var(--text-2);cursor:pointer;list-style:none}
    .files-head button:hover,.files-more:hover,.files-new summary:hover{background:var(--rule)}
    .files-new{position:relative}.files-new summary::-webkit-details-marker{display:none}
    .files-new>div{position:absolute;top:32px;left:-110px;width:155px;padding:5px;border:1px solid var(--rule-2);border-radius:9px;background:var(--box,#fff);box-shadow:0 6px 20px var(--rule);z-index:3}
    .files-new>div button{display:block;text-align:left;width:100%;height:32px;padding:4px 10px;font-size:13px;color:var(--text)}
    .files-sort{position:relative;display:grid;place-items:center;width:28px;height:28px;color:var(--text-2);cursor:pointer}
    .files-sort select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
    .files-sort:focus-within{outline:2px solid var(--new);border-radius:5px}
    .files-bookmark-heading{display:flex;align-items:center;gap:7px;width:100%;padding:5px 8px;border:0;background:none;color:var(--text-2);font:500 12px var(--plex);text-align:left;cursor:pointer}
    .files-bookmark-heading svg{width:14px!important;height:14px!important}.files-bookmark-heading small{margin-left:auto;font-weight:400}
    .files-bookmarks{flex:0 1 auto;max-height:40%;overflow:auto;padding:10px 8px;border-top:1px solid var(--rule);scrollbar-width:thin}
    #files-pane .file-cloud{flex:none;display:inline-flex;color:var(--file-cloud)}#files-pane .file-cloud svg{width:14px;height:14px;fill:var(--file-cloud-fill)}
    #files-tree{padding:10px 8px;overflow:auto;flex:1;min-height:0;scrollbar-width:thin}
    .files-row{position:relative;display:flex;align-items:center;min-height:32px;border-radius:6px;padding-left:calc(var(--depth,0)*14px)}
    .files-row:hover{background:var(--rule)}.files-row.chosen{background:var(--new-tint,rgba(47,111,228,.07));color:var(--new)}
    .files-row.target{outline:1px solid var(--new);background:var(--new-tint,rgba(47,111,228,.07))}
    .files-pick{display:flex;align-items:center;gap:7px;min-width:0;flex:1;padding:6px 5px;border:0;border-radius:6px;background:none;color:inherit;font:13px/20px var(--plex);text-decoration:none;text-align:left;cursor:pointer}
    .files-row[data-file] .files-pick{padding-left:22px}
    .files-pick span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .files-chevron{width:10px!important;height:10px!important;transition:transform .1s;transform-origin:center}.files-chevron.expanded{transform:rotate(90deg)}
    .files-more{width:24px;height:24px;font-size:18px;margin-right:3px;opacity:0}
    .files-row:hover .files-more,.files-row:focus-within .files-more{opacity:1}
    .files-empty{padding:8px 12px;color:var(--text-2);font-size:12px}
    .files-trash{flex:none;padding:8px;border-top:1px solid var(--rule)}
    .files-trash .files-pick[aria-current=page]{border-radius:6px;background:var(--new-tint,rgba(47,111,228,.07));color:var(--new)}
    .files-trash-count{margin-left:auto;color:var(--text-2);font-size:12px;padding:0 8px}
    #files-trash-view{user-select:text}
    .files-trash-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:24px}
    .files-trash-head h1{font:500 22px/1.3 var(--plex);margin:0}
    .files-trash-actions{display:flex;align-items:center;gap:8px}
    .files-trash-actions a,.files-trash-actions button,.files-trash-card button,.files-trash-retry{flex:none;display:inline-block;border:1px solid var(--rule-2);border-radius:6px;background:var(--box,#fff);color:var(--text);padding:6px 10px;font:12px var(--plex);text-decoration:none;cursor:pointer}
    .files-trash-card{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:10px 0;padding:16px;border:1px solid var(--rule-2);border-radius:9px;background:var(--box,#fff)}
    .files-trash-card>div{min-width:0}.files-trash-card strong{font-weight:500;overflow-wrap:anywhere}.files-trash-card p{margin:5px 0 0;font:12px/1.5 var(--plex);color:var(--text-2)}
    .files-trash-card button:disabled{opacity:.5;cursor:wait}
    #files-trash-error{color:var(--gone,#b42318);font-size:13px;margin-bottom:14px}#files-trash-error:empty{display:none}
    #files-trash-view :focus-visible{outline:2px solid var(--new);outline-offset:2px}
    #files-error{padding:0 14px 12px;color:var(--gone,#b42318);font-size:12px}#files-error:empty{display:none}
    #files-dialog{margin:auto;width:min(380px,calc(100vw - 32px));padding:22px;border:1px solid var(--rule-2);border-radius:12px;background:var(--box,#fff);color:var(--text);font:14px/1.5 var(--plex);box-shadow:0 12px 40px var(--rule)}
    #files-dialog::backdrop{background:rgba(20,20,19,.2)}
    #files-dialog h2{font-size:18px;font-weight:500;margin-bottom:18px}
    #files-dialog label{display:block;font-size:12px;color:var(--text-2);margin-top:14px}
    #files-dialog input,#files-dialog select{display:block;width:100%;height:36px;padding:6px 9px;margin-top:5px;border:1px solid var(--rule-2);border-radius:6px;background:var(--canvas);font:14px var(--plex);color:var(--text)}
    #files-dialog .files-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px;flex-wrap:wrap}
    #files-dialog button{padding:6px 12px;border:1px solid var(--rule-2);border-radius:6px;background:none;color:var(--text);font:13px var(--plex);cursor:pointer}
    #files-dialog button[type=submit]{background:var(--text);color:var(--box,#fff)}
    #files-dialog p[role=alert]{margin-top:12px;color:var(--gone,#b42318);font-size:12px}
    #files-pane :focus-visible,#files-toggle:focus-visible{outline:2px solid var(--new);outline-offset:1px}
    @media(max-width:900px){.files-open #canvas{left:0}.files-open .home{margin-left:0}.files-open #files-pane{box-shadow:10px 0 30px var(--rule)}.files-open #backb,.files-open #sysdraw,.files-open #legend{left:16px}.files-open #sysdraw{width:min(400px,calc(100% - 104px))}.files-more{opacity:1}}
    @media(prefers-reduced-motion:reduce){.files-chevron{transition:none}}
  `;
  document.head.append(style);
  const icon = (/** @type {string} */ path) => `<svg viewBox="0 0 20 20" aria-hidden="true">${path}</svg>`;
  const folderIcon = icon('<path d="M2.5 5.5h6l2-2h7v13h-15z"/>');
  const fileIcon = icon('<path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4M8 10h4M8 13h4"/>');
  const mapIcon = icon('<rect x="7" y="7" width="6" height="6" rx="1"/><path d="M10 2v5m0 6v5M2 10h5m6 0h5"/>');
  const sidebarIcon = icon('<path class="files-sidebar-fill" d="M5 3h3v14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M8 3v14"/>');
  const trashIcon = icon('<path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/>');
  const button = document.createElement('button');
  button.id = 'files-toggle'; button.type = 'button'; button.setAttribute('aria-controls', 'files-pane');
  button.innerHTML = sidebarIcon; button.setAttribute('aria-label', 'Toggle files sidebar');
  const previous = document.querySelector('#top .mapb');
  if (previous) previous.replaceWith(button); else document.querySelector('#top .brand')?.after(button);
  const pane = document.createElement('aside'); pane.id = 'files-pane'; pane.setAttribute('aria-label', 'Files');
  pane.innerHTML = `<div class="files-head"><a href="/">Your files</a><button type="button" data-new-folder title="New folder" aria-label="New folder">${folderIcon}</button><details class="files-new"><summary aria-label="New file" title="New file">${icon('<path d="M10 4v12M4 10h12"/>')}</summary><div><button type="button" data-new-file="note">New note</button><button type="button" data-new-file="map">New map</button></div></details><label class="files-sort" title="Sort files">${icon('<path d="M5 3v14m-3-3 3 3 3-3M11 4h6M11 8h4M11 12h2"/>')}<select aria-label="Sort files">${(fileUI?.sorts || []).map(([id, label]) => `<option value="${id}">${escape(label)}</option>`).join('')}</select></label><button type="button" data-refresh title="Refresh files" aria-label="Refresh files">${icon('<path d="M16 7a6 6 0 10.2 5M16 3v4h-4"/>')}</button></div><div id="files-tree" aria-label="Folders and files"></div><p id="files-error" role="status"></p><section class="files-trash" aria-label="Trash"></section><section class="files-bookmarks" aria-label="Bookmarks"></section>`;
  document.body.append(pane);
  /** @type {{revision:number, folders:any[], files:any[]}} */
  let library = { revision: 0, folders: [], files: [] };
  const tree = /** @type {HTMLElement} */ (pane.querySelector('#files-tree'));
  const trashTree = /** @type {HTMLElement} */ (pane.querySelector('.files-trash'));
  const savedFiles = /** @type {HTMLElement} */ (pane.querySelector('.files-bookmarks'));
  const error = /** @type {HTMLElement} */ (pane.querySelector('#files-error'));
  let parent = '', expanded = new Set(), refreshSerial = 0, sortBy = 'name-asc', bookmarksOpen = true;
  /** @type {any[]} */ let trashItems = [];
  let trashError = '';
  const trashPage = !current && new URLSearchParams(location.search).get('folder') === 'trash';
  /** @type {HTMLElement | null} */ let trashView = null;
  if (trashPage) {
    document.getElementById('home-new-map')?.setAttribute('hidden', '');
    trashView = document.createElement('section'); trashView.id = 'files-trash-view'; trashView.setAttribute('aria-label', 'Trash');
    trashView.innerHTML = '<p role="status">Loading Trash…</p>'; document.querySelector('.home > main')?.append(trashView); document.title = 'Living Map · Trash';
  }
  try { sortBy = fileUI?.normalize(localStorage.getItem('lm.files-sort') || localStorage.getItem('lm.sort')) || sortBy; bookmarksOpen = localStorage.getItem('lm.bookmarks-open') !== 'false'; } catch { /* use this page's default order */ }
  const order = (/** @type {any[]} */ files) => fileUI?.order(files, sortBy) || [...files].sort((a, b) => a.title.localeCompare(b.title));
  const fileTools = fileUI?.mount({ current, beforeNavigate, navigate, move: (file) => { choose(file.parent); dialog({ heading: `Move ${file.title}`, op: 'movefile', name: file.name }); },
    changed: async (kind, file, result) => {
      await refresh();
      if (kind === 'duplicate') await change({ op: 'movefile', name: result.name, parent: file.parent || '', view: file.view || 'map' });
      if (kind === 'bookmark') [.../** @type {NodeListOf<HTMLButtonElement>} */ (tree.querySelectorAll('button[data-file-more]'))].find((el) => /** @type {HTMLElement} */ (el).dataset.fileMore === file.name)?.focus();
      window.dispatchEvent(new CustomEvent('lm-files-changed'));
    },
  });
  try { parent = sessionStorage.getItem('lm.files-folder') || ''; expanded = new Set(JSON.parse(localStorage.getItem('lm.files-expanded') || '[]')); } catch { /* folders still open for this page */ }
  const choose = (/** @type {string} */ id) => { parent = id; try { sessionStorage.setItem('lm.files-folder', id); localStorage.setItem('lm.files-expanded', JSON.stringify([...expanded])); } catch { /* this page still keeps its choice */ } };
  const toggle = (/** @type {boolean} */ open) => { document.body.classList.toggle('files-open', open); button.setAttribute('aria-expanded', String(open)); button.title = `${open ? 'Collapse' : 'Expand'} files sidebar`; try { localStorage.setItem('lm.files-open', String(open)); } catch { /* this page still opens */ } resized(); };
  let open = innerWidth > 900;
  try { const saved = localStorage.getItem('lm.files-open'); if (saved !== null) open = saved === 'true'; } catch { /* use the window's width */ }
  if (trashPage && innerWidth <= 900) open = false;
  toggle(open); button.onclick = () => { fileTools?.close(); toggle(!document.body.classList.contains('files-open')); };
  const viewHref = (/** @type {any} */ f) => `${f.href}?document=${f.view}`;
  /** @param {any} f @param {number} depth @param {boolean} [saved] */
  const fileRow = (f, depth, saved = false) => `<div class="files-row${f.name === current ? ' chosen' : ''}" style="--depth:${depth}" data-file="${escape(f.name)}"${saved ? ' data-bookmark-file' : ''} draggable="true"><a class="files-pick" href="${escape(viewHref(f))}"${f.name === current ? ' aria-current="page"' : ''}>${f.view === 'note' ? fileIcon : mapIcon}<span>${escape(f.title)}</span>${f.cloud ? `<span class="file-cloud" role="img" aria-label="Stored in the cloud">${fileTools?.cloud || ''}</span>` : ''}</a><button type="button" class="files-more" data-file-more="${escape(f.name)}" aria-label="File actions for ${escape(f.title)}" aria-expanded="false">···</button></div>`;
  function draw() {
    const visited = new Set();
    const select = /** @type {HTMLSelectElement | null} */ (pane.querySelector('.files-sort select')); if (select) select.value = sortBy;
    /** @param {string} id @param {number} depth @returns {string} */
    function rows(id, depth) {
      let html = '';
      for (const f of order(library.folders.filter((f) => f.parent === id))) {
        if (visited.has(f.id)) continue; visited.add(f.id);
        const on = expanded.has(f.id);
        html += `<div class="files-row${parent === f.id ? ' chosen' : ''}" style="--depth:${depth}" data-folder="${escape(f.id)}" draggable="true"><button class="files-pick" type="button" data-folder-pick="${escape(f.id)}" aria-expanded="${on}"><svg class="files-chevron${on ? ' expanded' : ''}" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 5 5-5 5"/></svg>${folderIcon}<span>${escape(f.title)}</span></button><button class="files-more" type="button" data-folder-more="${escape(f.id)}" aria-label="Actions for ${escape(f.title)}">···</button></div>`;
        if (on) html += rows(f.id, depth + 1);
      }
      for (const f of order(library.files.filter((f) => f.parent === id))) html += fileRow(f, depth);
      return html;
    }
    const bookmarks = order(library.files.filter((f) => f.bookmarked));
    tree.innerHTML = `<div class="files-row" data-folder="">${trashPage ? `<a class="files-pick" href="/" data-root>${folderIcon}<span>All files</span></a>` : `<button class="files-pick" type="button" data-root>${folderIcon}<span>All files</span></button>`}</div>${rows('', 0)}${!library.folders.length && !library.files.length ? '<p class="files-empty">Create a note, map or folder above.</p>' : ''}`;
    trashTree.innerHTML = `<a class="files-pick" href="/?folder=trash" aria-label="Trash"${trashPage ? ' aria-current="page"' : ''} title="${trashItems.length} files in Trash">${trashIcon}<span>Trash</span><small class="files-trash-count" aria-hidden="true">${trashItems.length}</small></a>`;
    if (trashView) trashView.innerHTML = `<div class="files-trash-head"><h1 tabindex="-1">Trash</h1><div class="files-trash-actions"><a href="/">Back to files</a><button type="button" data-trash-refresh>Refresh</button></div></div><p id="files-trash-error" role="alert"></p><div id="files-trash-list">${trashError ? `<p role="alert">${escape(trashError)}</p><button type="button" class="files-trash-retry" data-trash-refresh>Try again</button>` : trashItems.length ? trashItems.map((f) => `<div class="files-trash-card" data-trashed-file="${escape(f.name)}"><div><strong>${escape(f.title)}</strong><p>Moved to Trash ${escape(new Date(f.at).toLocaleString())}</p></div><button type="button" data-restore-file="${escape(f.id)}" aria-label="Restore ${escape(f.title)}">Restore</button></div>`).join('') : '<p>Trash is empty.</p>'}</div>`;
    savedFiles.innerHTML = `<button type="button" class="files-bookmark-heading" data-bookmarks aria-expanded="${bookmarksOpen}">${fileTools?.bookmark || ''}<span>Bookmarks</span><small>${bookmarks.length}</small></button>${bookmarksOpen ? `<div data-bookmark-list>${bookmarks.map((f) => fileRow(f, 0, true)).join('')}${!bookmarks.length ? '<p class="files-empty">No bookmarks yet.</p>' : ''}</div>` : ''}`;
    fileTools?.update(library.files.find((f) => f.name === current));
  }
  async function refresh() {
    const serial = ++refreshSerial;
    try {
      const [files, trash] = await Promise.allSettled(['/api/library', '/api/maps/trash'].map(async (route) => { const r = await window.fetch(route); if (!r.ok) throw new Error('Could not load your files. Use Refresh files to retry.'); return r.json(); }));
      if (serial !== refreshSerial) return;
      if (trash.status === 'fulfilled') { trashItems = trash.value; trashError = ''; }
      else trashError = 'Trash could not be opened. Try again.';
      if (files.status === 'rejected') { error.textContent = files.reason?.message || 'Your files could not be opened. Use Refresh files to retry.'; draw(); return; }
      library = files.value;
      if (!library.folders.some((f) => f.id === parent)) choose('');
      const active = library.files.find((f) => f.name === current);
      const path = [];
      for (let p = active?.parent; p; p = library.folders.find((f) => f.id === p)?.parent) path.unshift(library.folders.find((f) => f.id === p)?.title);
      folderChanged(path.join(' / ') || 'Your files');
      for (let p = active?.parent; p; p = library.folders.find((f) => f.id === p)?.parent) expanded.add(p);
      error.textContent = ''; draw();
    } catch (/** @type {any} */ e) { error.textContent = e.message; }
  }
  /** @param {any} a */
  async function change(a) {
    const r = await window.fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...a, revision: library.revision }) });
    const result = await r.json();
    if (!r.ok) { if (r.status === 409) await refresh(); throw new Error(result.error || 'That change could not be saved.'); }
    await refresh(); return result;
  }
  /** @param {{heading:string, op:string, id?:string, name?:string, title?:string, view?:string, rename?:boolean}} o */
  function dialog(o) {
    document.getElementById('files-dialog')?.remove();
    const el = document.createElement('dialog'); el.id = 'files-dialog';
    const choices = [{ id: '', title: 'All files', parent: '' }, ...library.folders];
    const folderPath = (/** @type {any} */ f) => { let text = f.title; for (let p = f.parent; p; p = library.folders.find((f) => f.id === p)?.parent) text = `${library.folders.find((f) => f.id === p)?.title} / ${text}`; return text; };
    el.innerHTML = `<form><h2>${escape(o.heading)}</h2>${o.op.startsWith('create') || o.rename ? `<label>Name<input name="title" required maxlength="${o.view ? 60 : 80}" value="${escape(o.title || '')}" autocomplete="off"></label>` : ''}${!o.rename ? `<label for="files-parent">Folder</label><select id="files-parent" name="parent">${choices.map((f) => `<option value="${escape(f.id)}"${f.id === parent ? ' selected' : ''}>${escape(folderPath(f))}</option>`).join('')}</select>` : ''}<p role="alert"></p><div class="files-dialog-actions">${o.rename ? '<button type="button" data-move-folder>Move folder</button><button type="button" data-remove>Delete empty folder</button>' : ''}<button type="button" data-cancel>Cancel</button><button type="submit">${o.op.startsWith('create') ? 'Create' : o.rename ? 'Rename' : 'Move'}</button></div></form>`;
    el.querySelector('[data-move-folder]')?.addEventListener('click', () => dialog({ heading: 'Move folder', op: 'movefolder', id: o.id }));
    el.querySelector('[data-cancel]')?.addEventListener('click', () => el.close());
    const apply = async (/** @type {string} */ op) => {
      const submit = /** @type {HTMLButtonElement} */ (el.querySelector('button[type=submit]')); submit.disabled = true;
      try {
        const form = new FormData(/** @type {HTMLFormElement} */ (el.querySelector('form')));
        const r = await change({ op, id: o.id, name: o.name, title: form.get('title'), parent: o.rename ? '' : form.get('parent'), view: o.view });
        if (r.id) { expanded.add(r.id); choose(r.id); draw(); }
        if (r.href && !await navigate(r.href) && await beforeNavigate()) location.href = r.href;
        el.close();
      } catch (/** @type {any} */ e) { /** @type {HTMLElement} */ (el.querySelector('[role=alert]')).textContent = e.message; }
      finally { submit.disabled = false; }
    };
    el.querySelector('form')?.addEventListener('submit', (e) => { e.preventDefault(); void apply(o.op); });
    el.querySelector('[data-remove]')?.addEventListener('click', () => { void apply('removefolder'); });
    el.addEventListener('close', () => el.remove()); document.body.append(el); el.showModal();
    el.querySelector('input')?.select();
  }
  trashView?.addEventListener('click', async (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('[data-trash-refresh]')) { void refresh(); return; }
    const restore = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-restore-file]'));
    if (restore) {
      restore.disabled = true;
      try {
        const r = await window.fetch('/api/maps/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: restore.dataset.restoreFile }) });
        const result = await r.json(); if (!r.ok) throw new Error(result.error || 'That file could not be restored. Try again.');
        await refresh(); window.dispatchEvent(new CustomEvent('lm-files-changed')); fileTools?.notify('File restored.'); trashView?.querySelector('h1')?.focus({ preventScroll: true });
      } catch (/** @type {any} */ err) { /** @type {HTMLElement} */ (trashView?.querySelector('#files-trash-error')).textContent = err.message; restore.disabled = false; }
    }
  });
  pane.addEventListener('click', async (e) => {
    const t = /** @type {HTMLElement} */ (e.target), row = t.closest('[data-folder-pick]');
    if (row) { const id = /** @type {HTMLElement} */ (row).dataset.folderPick || ''; expanded.has(id) ? expanded.delete(id) : expanded.add(id); choose(id); draw(); }
    if (t.closest('[data-bookmarks]')) { bookmarksOpen = !bookmarksOpen; try { localStorage.setItem('lm.bookmarks-open', String(bookmarksOpen)); } catch { /* this page keeps the choice */ } draw(); }
    if (t.closest('[data-root]')) { choose(''); draw(); }
    if (t.closest('[data-refresh]')) void refresh();
    if (t.closest('[data-new-folder]')) dialog({ heading: 'New folder', op: 'createfolder' });
    const create = /** @type {HTMLElement | null} */ (t.closest('[data-new-file]'));
    if (create) { /** @type {HTMLDetailsElement} */ (pane.querySelector('details')).open = false; dialog({ heading: create.dataset.newFile === 'note' ? 'New note' : 'New map', op: 'createfile', view: create.dataset.newFile }); }
    const more = /** @type {HTMLElement | null} */ (t.closest('[data-folder-more]'));
    if (more) { const f = library.folders.find((f) => f.id === more.dataset.folderMore); choose(f.parent); dialog({ heading: 'Rename folder', op: 'renamefolder', id: f.id, title: f.title, rename: true }); }
    const move = /** @type {HTMLElement | null} */ (t.closest('[data-file-more]'));
    if (move) { const f = library.files.find((f) => f.name === move.dataset.fileMore); if (f) fileTools?.show(f, move); }
    const link = /** @type {HTMLAnchorElement | null} */ (t.closest('a'));
    if (link && !/** @type {MouseEvent} */ (e).metaKey && !/** @type {MouseEvent} */ (e).ctrlKey && !/** @type {MouseEvent} */ (e).shiftKey) { e.preventDefault(); if (!await navigate(link.href) && await beforeNavigate()) location.href = link.href; }
  });
  pane.addEventListener('keydown', (e) => { const more = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-file-more]')); if (e.key === 'ArrowDown' && more) { e.preventDefault(); more.click(); } });
  pane.addEventListener('dragstart', (e) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[draggable]'));
    if (row) e.dataTransfer?.setData('application/x-lm-file', JSON.stringify(row.dataset.file ? { op: 'movefile', name: row.dataset.file } : { op: 'movefolder', id: row.dataset.folder }));
  });
  pane.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-lm-file')) { e.preventDefault(); const row = /** @type {HTMLElement} */ (e.target).closest('[data-folder]'); row?.classList.add('target'); } });
  pane.addEventListener('dragleave', (e) => /** @type {HTMLElement} */ (e.target).closest('[data-folder]')?.classList.remove('target'));
  pane.addEventListener('drop', async (e) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-folder]'));
    row?.classList.remove('target'); const data = e.dataTransfer?.getData('application/x-lm-file'); if (!data || !row) return;
    e.preventDefault();
    try { await change({ ...JSON.parse(data), parent: row.dataset.folder }); expanded.add(row.dataset.folder); draw(); }
    catch (/** @type {any} */ err) { error.textContent = err.message; }
  });
  pane.querySelector('.files-sort select')?.addEventListener('change', (e) => {
    sortBy = /** @type {HTMLSelectElement} */ (e.target).value;
    try { localStorage.setItem('lm.files-sort', sortBy); } catch { /* this page keeps its order */ }
    window.dispatchEvent(new CustomEvent('lm-files-sort', { detail: sortBy })); draw();
  });
  window.addEventListener('lm-files-sort', (e) => { sortBy = fileUI?.normalize(/** @type {CustomEvent} */ (e).detail) || sortBy; draw(); });
  window.addEventListener('storage', (e) => { if (e.key === 'lm.files-sort') { sortBy = fileUI?.normalize(e.newValue) || sortBy; draw(); } });
  window.addEventListener('lm-maps-changed', () => { void refresh(); });
  window.addEventListener('focus' , () => { void refresh(); });
  void refresh();
  return { refresh, setCurrent: (/** @type {string} */ name) => { current = name; fileTools?.setCurrent(name); fileTools?.close(); draw(); void refresh(); }, renameCurrent: (/** @type {string} */ title, /** @type {{at?:number,created?:number}} */ dates = {}) => { const file = library.files.find((f) => f.name === current); if (file && (file.title !== title || dates.at && file.at !== dates.at || dates.created && file.created !== dates.created)) { Object.assign(file, { title }, dates); draw(); } } };
}
