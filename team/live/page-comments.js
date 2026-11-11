// The comments' HTML: a pin on the map, an open thread or the box for a new one, and the list in the Comments
// panel. A page module (see page-modules.js): the page hands in what it needs of it, as `view`:
//   me     who is looking          esc    how the page writes text into HTML
//   pcol   a person's colour       label  a box's or a view's name by id, if there is one

/** @param {{ me: string, esc: (t: unknown) => string, pcol: (who: string) => string, label: (id: string) => string | undefined }} view */
export function commentScreens(view){
  const { esc, pcol } = view;
  const ago = (/** @type {any} */ t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`; const h = Math.round(m / 60); return `${h} hour${h === 1 ? '' : 's'} ago`; };
  const av = (/** @type {any} */ who) => `<span class="av" style="background:${pcol(who)}">${esc(who[0] || "")}</span>`;
  const mention = (/** @type {any} */ t) => esc(t).replace(/@(\w+)/g, '<span class="at">$1</span>');
  /** a thread's pin @param {any} c @param {boolean} open */
  const pin = (c, open) => `<div class="pinc ${open ? 'on' : ''} ${c.resolved ? 'done' : ''}" data-pin="${c.id}" style="left:${c.x}px;top:${c.y}px">${`<i style="background:${pcol(c.msgs[0].who)}">${esc(c.msgs[0].who[0] || "")}</i>`}${c.msgs.length > 1 ? `<span class="cnt">${c.msgs.length}</span>` : ''}</div>`;
  /** the pin of a comment being written @param {{ x: number, y: number }} d */
  const draftPin = (d) => `<div class="pinc on" style="left:${d.x}px;top:${d.y}px"><i style="background:${pcol(view.me)}">${view.me[0]}</i></div>`;
  /** an open thread, or with none the one row for a new comment @param {any} c */
  const thread = (c) => c ? `<div class="th-head">Comment<span class="sp"></span><span class="ib ${c.resolved ? 'done' : ''}" data-resolve="${c.id}" title="${c.resolved ? 'Reopen' : 'Resolve'}">✓</span><span class="ib" data-close-th title="Close">✕</span></div>
        <div class="th-body">${c.msgs.map((/** @type {any} */ m) => `<div class="th-msg">${av(m.who)}<div><span class="who">${esc(m.who)}</span><span class="ago">${ago(m.at)}</span><div class="tx">${mention(m.text)}</div></div></div>`).join('')}</div>
        <form class="th-reply" data-reply="${c.id}">${av(view.me)}<input placeholder="Reply" autocomplete="off"><button type="submit" title="Send">↑</button></form>`
        // a new comment is one row beside its pin, the way Figma opens it
        : `<form class="th-reply" data-new><input placeholder="Add a comment" autocomplete="off"><button type="submit" title="Post">↑</button></form>`;
  /** the Comments panel: its search, Show resolved and the threads @param {{ comments: any[], resolved: number, query: string, showResolved: boolean, open: unknown }} p */
  const panel = ({ comments, resolved, query, showResolved, open }) => `<div class="cp-head"><input id="cpq" placeholder="Search" value="${query.replace(/"/g, '&quot;')}"><span class="x" data-close-cp title="Close">×</span></div>
        ${resolved ? `<label class="cp-res"><input type="checkbox" id="cpres" ${showResolved ? 'checked' : ''}> Show resolved (${resolved})</label>` : ''}
        <div class="cp-list">${comments.length ? comments.map((x) => `<div class="cp-item ${open === x.id ? 'on' : ''} ${x.resolved ? 'done' : ''}" data-goto="${x.id}">
          <div class="cp-top">${av(x.msgs[0].who)}<span class="cp-acts"><span class="ib" data-resolve="${x.id}" title="${x.resolved ? 'Reopen' : 'Resolve'}"><svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.25"/><path d="M7.6 11.2l2.4 2.4 4.4-4.8"/></svg></span></span></div>
          <div class="meta">#${x.id} · ${esc(x.node ? view.label(x.node) || x.node : x.view === 'system' ? 'System' : view.label(x.view) || '')}${x.resolved ? ' · resolved' : ''}</div>
          <div class="by"><span class="who">${esc(x.msgs[0].who)}</span><span class="ago">${ago(x.msgs[0].at)}</span></div><div class="tx">${mention(x.msgs[0].text)}</div>
          ${x.msgs.length > 1 ? `<div class="rp">${x.msgs.length - 1} repl${x.msgs.length === 2 ? 'y' : 'ies'}</div>` : ''}</div>`).join('') : '<div class="cp-empty">No comments yet. Pick the comment tool and click anywhere on the map.</div>'}</div>`;
  return { ago, av, mention, pin, draftPin, thread, panel };
}
