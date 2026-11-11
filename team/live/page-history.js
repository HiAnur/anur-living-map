// The History panel's HTML (the archived Actions, then every version) and the bar over a version on show. A page
// module (see page-modules.js): the page hands in what it needs of it, as `view`:
//   me, admin   who is looking, and whether they are an Admin      live   they may act here (not a view link)
//   esc         how the page writes text into HTML                 vtime  how it writes when something happened
//   statusLabel an Action's status pill's words

/** @param {{ me: string, admin: boolean, live: boolean, esc: (t: unknown) => string, vtime: (t: number) => string, statusLabel: (a: any) => string | undefined }} view */
export function historyScreens(view){
  const { esc, vtime } = view;
  /** the panel @param {{ archived: any[], versions: any[], current: unknown }} p */
  const panel = ({ archived, versions, current }) => `<div class="ct"><span>History</span><span class="x" data-close-rail>×</span></div>
      ${archived.length ? `<div class="hs">Archived Actions</div>${archived.map((x) => `<div class="hv ha"><span class="hv-t">${esc(view.statusLabel(x.box.action) || 'Action')} · archived by ${esc(x.by)}, ${vtime(x.at)}</span><span class="hv-w" data-content>${esc(x.box.label)}</span>${view.live && (x.box.action?.by === view.me || view.admin) ? `<button class="gb" data-unarchive="${esc(x.box.id)}">Put back on the map</button>` : ''}</div>`).join('')}<div class="hs">Versions</div>` : ''}
      ${versions.map((v, i) => `<button class="hv ${v.id === current ? 'on' : ''}" data-hver="${v.id}"><span class="hv-t">${i === 0 ? 'Now' : vtime(v.at)}</span><span class="hv-w">${esc(v.what)}</span></button>`).join('')
        || '<div class="d-wait">No changes yet.</div>'}`;
  /** the bar over a version on show, or over a saved file @param {{ preview: any, file: any }} p */
  const bar = ({ preview, file }) => preview ? `<span class="hb-w">${vtime(preview.at)} · ${esc(preview.what)}</span><button class="go" data-hrestore>Restore this version</button><button data-hnow>Back to now</button>`
      : file ? `<span class="hb-w">A saved copy from ${esc(new Date(file).toLocaleString())}.</span><button class="go" data-fload>Load into Living Map</button>` : '';
  return { panel, bar };
}
