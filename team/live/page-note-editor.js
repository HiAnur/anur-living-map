/** A continuous note editor. The rich editor owns typing, selection and undo; this workspace owns saving.
 * @param {{project:(state:any) => any, rich:(el:HTMLElement,options:any) => any, save:(payload:any) => Promise<any>, changed:() => void, editable:() => boolean}} deps
 */
export function mountNoteEditor({ project, rich, save, changed, editable }) {
  const style = document.createElement('style');
  style.textContent = `
    #document-bar{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}
    #document-tabs{display:flex;gap:2px;padding:3px;border:1px solid var(--rule);border-radius:8px;background:var(--box)}
    #document-tabs button{height:26px;padding:0 14px;border:0;border-radius:5px;background:none;color:var(--text-2);font:13px var(--plex);cursor:pointer}
    #document-tabs button[aria-selected=true]{background:var(--text);color:var(--box)}
    #note-save-state{max-width:800px;margin:0 auto;padding:12px 48px 0;color:var(--text-2);font:12px/1.5 var(--plex)}#note-save-state:empty{display:none}
    #note-save:disabled{opacity:.5;cursor:default}#note-save[hidden],#note-reload[hidden]{display:none}
    #note-reload{border:0;background:none;color:var(--new);font:12px var(--plex);cursor:pointer}
    body.has-document #side,body.has-document #chat,body.has-document #design,body.has-document #decs,body.has-document #hist,body.has-document #mem,body.has-document #scs,body.has-document #cpanel,body.has-document #chatgrip{top:var(--topbar)}
    body.note-open #savew,body.note-open #rail{display:none}body.note-open #note-pane{right:0}
    body.note-open #map-search-button{display:grid;right:16px}body.note-open #map-search{right:16px;max-width:calc(100vw - 32px)}
    body.has-document #canvas{top:var(--topbar)}body.has-document #backb{top:calc(var(--topbar) + 16px)}
    body.has-document #tidyb,body.has-document #sysdraw{top:calc(var(--topbar) + 16px)}
    #note-pane{position:fixed;top:var(--topbar);left:var(--files-left,0px);right:72px;bottom:0;overflow:auto;user-select:text;background:var(--box);z-index:14}
    #note-pane[hidden]{display:none}#note-paper{max-width:800px;margin:0 auto;padding:36px 48px 120px}
    #note-title{display:block;width:100%;margin:0 0 20px;padding:0;border:0;outline:none;background:none;color:var(--text);font:500 30px/1.4 var(--plex)}
    #note-format{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:8px 0;background:var(--box);border-bottom:1px solid var(--rule);margin-bottom:18px;font:12px var(--plex);color:var(--text-2)}
    #note-format button,#note-format select{border:1px solid var(--rule);border-radius:5px;background:var(--box);color:var(--text-2);font:12px var(--plex);padding:4px 7px;cursor:pointer}
    #note-format button:disabled{opacity:.4;cursor:default}#note-current-level{margin-left:auto;font-size:11px}
    #note-input .ProseMirror{outline:none;min-height:50vh;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text);font:15px/1.75 var(--plex);font-variant-ligatures:none}
    #note-input p{margin:0 0 14px}#note-input h1,#note-input h2,#note-input h3,#note-input h4,#note-input h5,#note-input h6{position:relative;margin:26px 0 12px;padding:0;font-weight:500;line-height:1.5;scroll-margin-top:70px}
    #note-input h1{font-size:25px}#note-input h2{font-size:22px}#note-input h3{font-size:20px}#note-input h4{font-size:18px}#note-input h5{font-size:17px}#note-input h6{font-size:16px}
    #note-input .note-heading-active:before{content:'L' attr(data-level);position:absolute;right:calc(100% + 10px);top:3px;color:var(--text-3);font:11px/1.75 var(--plex);white-space:nowrap}
    #note-input ul,#note-input ol{padding-left:24px;margin:10px 0 16px}#note-input li p{margin-bottom:4px}
    #note-input blockquote{margin:16px 0;padding:0 16px;border-left:2px solid var(--rule-2);color:var(--text-2)}
    #note-input pre{padding:12px;background:var(--canvas);border:1px solid var(--rule);border-radius:6px;overflow:auto;white-space:pre}
    #note-input code{font-family:var(--mono,ui-monospace,monospace);font-size:.9em;background:var(--canvas)}#note-input a{color:var(--new)}
    #note-input img{max-width:100%}.ProseMirror-selectednode{outline:2px solid var(--new)}
    body.note-open #canvas,body.note-open #tools,body.note-open #tidyb,body.note-open #foot,body.note-open #legend,body.note-open #backb,body.note-open #plan,body.note-open #sysdraw,body.note-open .panel,body.note-open #chatgrip{visibility:hidden!important}
    #document-bar :focus-visible,#note-format :focus-visible{outline:2px solid var(--new);outline-offset:2px}
    @media(max-width:900px){#note-paper{padding:24px 30px 100px}}@media(max-width:540px){#note-save-state{padding:12px 30px 0}#note-title{font-size:25px}}
  `;
  document.head.append(style); document.body.classList.add('has-document');
  const bar = document.createElement('div'); bar.id = 'document-bar';
  bar.innerHTML = '<div id="document-tabs" role="tablist" aria-label="Document view"><button type="button" role="tab" aria-selected="true" data-document="map" aria-controls="canvas">Map</button><button type="button" role="tab" aria-selected="false" data-document="note" aria-controls="note-pane">Note</button></div><button id="note-reload" type="button" hidden>Discard draft and reload</button>';
  const pane = document.createElement('main'); pane.id = 'note-pane'; pane.hidden = true; pane.setAttribute('role','tabpanel'); pane.setAttribute('aria-label','Note');
  const status = document.createElement('div'); status.id = 'note-save-state'; status.setAttribute('role','status');
  const saveButton = document.createElement('button'); saveButton.id = 'note-save'; saveButton.type = 'button'; saveButton.className = 'tbtn'; saveButton.hidden = true; saveButton.textContent = 'Save'; saveButton.setAttribute('aria-label','Save note');
  document.body.append(pane); document.getElementById('crumbs')?.after(bar); document.getElementById('savew')?.after(saveButton);
  const reloadButton = /** @type {HTMLButtonElement} */ (bar.querySelector('#note-reload'));
  /** @type {any} */ let state = null;
  /** @type {any} */ let draft = null;
  /** @type {any} */ let editor = null;
  /** @type {any} */ let richDraft = null;
  let base = '', dirty = false, saving = false, active = 'map', message = '', restored = false;
  let draftKey = `lm.note-draft:${location.pathname}`;
  const title = () => /** @type {HTMLInputElement | null} */ (pane.querySelector('#note-title'))?.value || draft?.title || '';
  function showStatus() {
    pane.inert = saving || document.body.classList.contains('file-switching');
    status.textContent = active === 'note' ? message || (saving ? 'Saving…' : dirty ? 'Unsaved changes' : '') : '';
    saveButton.hidden = active !== 'note' || !editable(); saveButton.disabled = saving || !dirty;
    reloadButton.hidden = active !== 'note' || !dirty || !message;
  }
  function keep() {
    if (!editor) return;
    richDraft = editor.json(); dirty = true; message = '';
    try { draft = editor.document(title()); } catch (/** @type {any} */ error) { message = error.message; }
    try { localStorage.setItem(draftKey, JSON.stringify({ base, document:draft, rich:richDraft })); } catch { message = 'Keep this page open until your note is saved.'; }
    showStatus();
  }
  function renderDocument() {
    if (!draft) return;
    editor?.destroy();
    pane.innerHTML = '<article id="note-paper"><input id="note-title" aria-label="Note title" maxlength="60"><div id="note-format"><select aria-label="Text style"><option value="0">Text</option>'+[1,2,3,4,5,6].map((n)=>`<option value="${n}">Heading ${n}</option>`).join('')+'</select><button type="button" id="note-shallower" title="Move this heading up one level (Alt+Left)">Shallower</button><button type="button" id="note-deeper" title="Move this heading down one level (Alt+Right)">Deeper</button><span id="note-current-level"></span></div><div id="note-input"></div></article>';
    pane.prepend(status); const input = /** @type {HTMLInputElement} */ (pane.querySelector('#note-title')); input.value = draft.title; input.readOnly = !editable();
    editor = rich(/** @type {HTMLElement} */ (pane.querySelector('#note-input')), { document:draft, json:richDraft, editable, changed:keep, selected:(/** @type {number} */ level, /** @type {number} */ textStyle) => {
      const select = /** @type {HTMLSelectElement} */ (pane.querySelector('#note-format select'));
      select.querySelector('[data-deep-option]')?.remove(); if (textStyle > 6) { const option = new Option(`Heading ${textStyle}`,String(textStyle)); option.dataset.deepOption = ''; select.add(option); }
      select.value = String(textStyle); select.disabled = !editable();
      /** @type {HTMLElement} */ (pane.querySelector('#note-current-level')).textContent = level ? `Level ${level}` : '';
      /** @type {HTMLButtonElement} */ (pane.querySelector('#note-shallower')).disabled = !editable() || level <= 1;
      /** @type {HTMLButtonElement} */ (pane.querySelector('#note-deeper')).disabled = !editable() || !level;
    } });
    input.oninput = keep;
    /** @type {HTMLSelectElement} */ (pane.querySelector('#note-format select')).onchange = (e) => editor.level(Number(/** @type {HTMLSelectElement} */ (e.target).value));
    /** @type {HTMLButtonElement} */ (pane.querySelector('#note-shallower')).onclick = () => editor.shallower();
    /** @type {HTMLButtonElement} */ (pane.querySelector('#note-deeper')).onclick = () => editor.deeper();
    showStatus();
  }
  function takeState(/** @type {any} */ next) {
    state = next; const document = project(next), json = JSON.stringify(document);
    if (!dirty && !saving && json !== base) { draft = document; base = json; richDraft = null; if (active === 'note') renderDocument(); else { editor?.destroy(); editor = null; } }
    else if (dirty && !saving && json !== base) { message = 'The map changed. Your draft is kept.'; showStatus(); }
  }
  /** @type {Promise<boolean>} */ let pending = Promise.resolve(true);
  function flush() {
    if (!dirty) return Promise.resolve(true); if (saving) return pending;
    try { if (editor) draft = editor.document(title()); } catch (/** @type {any} */ error) { message = error.message; showStatus(); return Promise.resolve(false); }
    saving = true; message = ''; showStatus();
    pending = (async () => {
      try {
        const next = await save({ base, title:draft.title, description:draft.description, sections:draft.sections, structure:true });
        state = next; draft = project(next); base = JSON.stringify(draft); editor?.saved(draft, next.noteSectionIds); richDraft = null; dirty = false; message = '';
        try { localStorage.removeItem(draftKey); } catch { /* the saved map is authoritative */ }
        return true;
      } catch (/** @type {any} */ error) { message = error.message || 'Your note could not be saved. Your draft is kept.'; return false; }
      finally { saving = false; showStatus(); }
    })(); return pending;
  }
  async function switchView(/** @type {string} */ view) {
    if (!state || view === active || (view === 'map' && !await flush())) return;
    active = view; pane.hidden = view !== 'note'; document.body.classList.toggle('note-open',view === 'note');
    for (const button of bar.querySelectorAll('[data-document]')) button.setAttribute('aria-selected',String(/** @type {HTMLElement} */ (button).dataset.document === view));
    const url = new URL(location.href); url.searchParams.set('document',view); history.replaceState(null,'',url);
    if (view === 'note' && !editor) renderDocument(); changed(); showStatus();
  }
  bar.querySelectorAll('[data-document]').forEach((b) => b.addEventListener('click',()=>{ void switchView(/** @type {HTMLElement} */ (b).dataset.document || 'map'); }));
  saveButton.onclick = () => { void flush(); };
  reloadButton.onclick = () => { dirty = false; message = ''; base = ''; richDraft = null; takeState(state); };
  pane.addEventListener('keydown',(e)=>{ e.stopPropagation(); if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='s') { e.preventDefault(); e.stopPropagation(); void flush(); } });
  window.addEventListener('beforeunload',(e)=>{ if (dirty) { e.preventDefault(); e.returnValue = true; } });
  return {
    flush, open:switchView,
    reset:(/** @type {string} */ pathname)=>{ editor?.destroy(); editor = state = draft = richDraft = null; base = ''; dirty = saving = restored = false; active = 'map'; message = ''; draftKey = `lm.note-draft:${pathname}`; pane.hidden = true; document.body.classList.remove('note-open'); for (const b of bar.querySelectorAll('[data-document]')) b.setAttribute('aria-selected',String(/** @type {HTMLElement} */ (b).dataset.document === 'map')); showStatus(); },
    reveal:(/** @type {string} */ id,/** @type {boolean} */ focus)=>editor?.reveal(id,focus),
    update:(/** @type {any} */ next)=>{
      takeState(next);
      if (!restored) {
        restored = true;
        try { const kept = JSON.parse(localStorage.getItem(draftKey) || 'null'); if (kept?.document && typeof kept.base === 'string') { const current = project(next); const oldBase = JSON.parse(kept.base); for (const s of oldBase.sections || []) if (!Object.hasOwn(s,'inside')) s.inside = current.sections.find((/** @type {any} */ n) => n.id === s.id)?.inside || false; for (const s of kept.document.sections || []) if (!Object.hasOwn(s,'inside')) s.inside = current.sections.find((/** @type {any} */ n) => n.id === s.id)?.inside || false; draft = kept.document; base = JSON.stringify(oldBase); richDraft = kept.rich || null; dirty = true; message = base === JSON.stringify(project(next)) ? 'Your unsaved draft is restored.' : 'The map changed. Your unsaved draft is restored.'; } } catch { /* no readable draft to restore */ }
        if (new URLSearchParams(location.search).get('document') === 'note' || dirty) void switchView('note');
      }
    },
  };
}
