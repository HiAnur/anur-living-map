// What an Action box shows of where it stands: whether it was executed, the words and tone of its status pill,
// and whether it can still be turned back into an Info box. A page module: see page-modules.js.

/** @param {any} a */
export const actionExecuted = (a) => a?.stage === 'finished' && a.completion?.status === 'completed' && a.completion.evidence?.length > 0;
/** @param {any} a */
export function actionStatus(a){
  if (!a?.stage || a.stage === 'draft') return null;
  if (actionExecuted(a)) return {label:'Executed',tone:'completed'};
  if (a?.stage === 'finished') return a.completion?.status === 'unverified' ? {label:'Done, unverified',tone:'waiting'} : a.completion?.status === 'needs_input' ? {label:'Needs clarity',tone:'waiting'} : a.completion?.status === 'blocked' ? {label:'Blocked',tone:'blocked'} : {label:'Unconfirmed',tone:'waiting'};
  return /** @type {Record<string, { label: string, tone: string }>} */ ({
    gathering:{label:'Preparing',tone:'active'},
    clarify:{label:'Needs clarity',tone:'waiting'},
    waiting:{label:'Waiting',tone:'waiting'},
    ready:{label:'Ready to execute',tone:'active'},
    running:{label:'Executing',tone:'active'},
    // preparation stopped: prepare it again; a run that was blocked is Continued instead
    error:{label:'Couldn\'t prepare',tone:'blocked'},
    blocked:{label:'Blocked',tone:'blocked'},
    cancelled:{label:'Cancelled',tone:'cancelled'},
    unconfirmed:{label:'Unconfirmed',tone:'waiting'},
  })[a.stage] || {label:'Unconfirmed',tone:'waiting'};
}
// A draft nobody wrote anything in can go back to being an Info box; anything more is cancelled and kept.
// action-box.js decides the same on the server.
/** @param {any} a */
export const actionUntouched = (a) => a?.stage === 'draft' && !a.intent && !a.plan && !a.history?.length && !a.documents?.length;
// An Action's history as the page shows it, newest first: what happened, who did it ("the map" for what the map
// did itself), when, and what code recorded of it. action-box.js writes the steps.
const ACTION_STEPS = /** @type {Record<string, string>} */ ({
  created:'Made an Action', preparing:'Started preparing', asked:'Claude asked a question', answered:'Answered',
  ready:'Brief ready', revised:'Asked to revise', executed:'Executed', stopped:'Stopped', continued:'Continued',
  finished:'Run ended', interrupted:'Interrupted by a restart', waiting:'Waiting on a prerequisite',
  released:'Prerequisites finished', failed:'Preparation stopped', cancelled:'Cancelled', reopened:'Prepared again', confirmed:'Confirmed done',
  branched:'Made a branch', built:'Committed and pushed', 'handed over':'Handed over', archived:'Archived', restored:'Put back on the map',
  unblocked:'Stopped waiting on a deleted box', alone:'Set to run on its own', manual:'Set to wait for your go',
  held:'Waits for your go',
});
const ACTION_ENDS = /** @type {Record<string, string>} */ ({ completed:'completed, verified', unverified:'done, unverified', needs_input:'needs an answer', blocked:'blocked', unconfirmed:'unconfirmed' });
/** @param {number} ms */
const actionTook = (ms) => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`;
/** @param {any[] | undefined} events @returns {{ label: string, who: string, at: number, detail: string }[]} */
export function actionHistory(events) {
  return (events || []).map((e) => ({
    label: ACTION_STEPS[e.what] || e.what,
    who: e.by === 'Map' ? 'the map' : String(e.by || ''),
    at: e.at,
    detail: [e.what === 'finished' ? ACTION_ENDS[e.status] : '', Number.isFinite(e.ms) ? actionTook(e.ms) : '', e.tools?.length ? `tools: ${e.tools.join(', ')}` : '', e.ran?.length ? `ran: ${e.ran.join(', ')}` : '', e.branch ? `branch: ${e.branch}` : '', e.pull ? `pull request: ${e.pull}` : '', e.to ? `${e.from} → ${e.to}` : '', e.boxes?.length ? `boxes: ${e.boxes.join(', ')}` : ''].filter(Boolean).join(' · '),
  })).reverse();
}

// The Action box's screens on the box card: its status pill, its chat, the card for where it stands, a planned
// Action's card, its history and the Info box / Action box switch. The page hands in what they need of it:
//   me        who is looking            live    they may act here (not a view link, a saved file or a past version)
//   admin     they are an Admin         people  the map's people
//   esc, prose, md                      how the page writes text into HTML
//   claudes, yours                      a message from Claude or from them in a chat
//   attached  what is attached to a box's chat          sendIcon  the send button's icon
//   opened    whether a folded section is open          box       a box by id, null when it is not theirs to see
//   cancellable                         whether an Action can still be cancelled (action-stages.js)
/** @param {any} view */
export function actionScreens(view){
  const { esc, prose, md, claudes, yours, attached } = view;
  function actionStatusPill(/** @type {any} */ a = undefined, below = false){
    const status = actionStatus(a);
    if (!status) return '';
    return `<span class="action-status-pill${below ? ' below' : ''}" data-tone="${status.tone}" aria-label="Action status: ${status.label}">${['gathering','running'].includes(a?.stage) ? actionSpinner(a) : ''}${status.label}</span>`;
  }
  function actionSpinner(/** @type {any} */ action){
    // A redraw keeps the spinner at the same point in its turn.
    const elapsed = Math.max(0, Date.now() - (Number(action.since) || Date.now()));
    return `<span class="action-spin" aria-hidden="true" style="animation-delay:-${elapsed}ms"></span>`;
  }
  function actionDocuments(/** @type {any} */ a){
    return (a.documents || []).map((/** @type {any} */ file) => {
      const key = `action-document:${file.id}`;
      return `<section class="action-document" aria-label="Previous action document"><a download="${esc(file.name)}" href="data:text/markdown;charset=utf-8,${esc(encodeURIComponent(file.content))}">${esc(file.name)}</a><details data-open-key="${esc(key)}" ${view.opened(key) ? 'open' : ''}><summary>View document</summary><pre>${esc(file.content)}</pre></details></section>`;
    }).join('');
  }
  function boxTypeButton(/** @type {any} */ n){
    if (n.proposed) return '';
    // an Action goes back to an Info box only while nothing is written in it; after that it is cancelled and kept
    const disabled = !view.live || n.action && (n.action.by !== view.me || !actionUntouched(n.action));
    return `<button class="action-type-toggle" role="switch" aria-checked="${!!n.action}" data-box-action="${n.action ? 'actioncancel' : 'actionbox'}" data-action-id="${esc(n.id)}" ${disabled ? 'disabled' : ''}${n.action && !actionUntouched(n.action) ? ' title="An Action stays an Action. Cancel it to set it aside; it keeps what it has."' : ''}><span>${n.action ? 'Action box' : 'Info box'}</span><span class="action-type-track" aria-hidden="true"></span></button>`;
  }
  function actionChat(/** @type {any} */ n, /** @type {any} */ previousChat){
    const a = n.action, mine = a.by === view.me && view.live;
    const asking = a.stage === 'draft' || a.stage === 'clarify';
    const turns = `${a.intent && a.stage !== 'draft' ? yours(a.intent) : ''}${(a.history || []).map((/** @type {any} */ t) => claudes(md(t.question)) + yours(t.answer)).join('')}`;
    const choices = mine && a.stage === 'clarify' ? `<div class="action-choices">${(a.choices || []).map((/** @type {any} */ c) => `<button class="gb" data-action-choice="${esc(c)}" data-action-id="${esc(n.id)}">${esc(c)}</button>`).join('')}</div>` : '';
    const current = a.stage === 'draft' ? a.plan ? plannedActionCard(n,a.plan) : claudes('<p>What do you want to do?</p>')
      : a.stage === 'clarify' ? claudes(`${md(a.question)}${choices}${mine ? '' : `<p class="quiet">Waiting for ${esc(a.by)}.</p>`}`)
      : a.stage === 'gathering' ? claudes(`<div class="action-progress">${actionSpinner(a)}<span>Gathering information…</span></div>`)
      : a.session ? `${(a.turns || []).map((/** @type {any} */ t, /** @type {any} */ i) => t.who === 'Claude' ? claudes(actionResult(t, `${n.id}:${i}`)) : yours(t.text)).join('')}${a.stage === 'running' ? claudes(`${a.progress ? md(a.progress) : ''}<div class="action-progress">${actionSpinner(a)}<span>Claude is working…</span></div>${mine ? `<button class="action-plain" data-box-action="actionstop" data-action-id="${esc(n.id)}" data-action-revision="${esc(a.id)}">Stop</button>` : ''}`) : ''}`
      : actionCard(n);
    const continuing = a.session && ['finished','blocked'].includes(a.stage);
    const confirmDone = mine && a.stage === 'finished' && a.completion?.status === 'unverified' ? `<div class="action-controls"><button class="gb" data-box-action="actionconfirm" data-action-id="${esc(n.id)}" data-action-revision="${esc(a.id)}" title="The map could not see this done. Confirm it if it is.">Confirm done</button></div>` : '';
    const composer = continuing && mine ? `<form class="ask cbox side-ask" data-action-continue="${esc(n.id)}" data-action-revision="${esc(a.id)}">${attached(n)}<div class="crow"><textarea rows="2" aria-label="Continue execution" placeholder="Reply or continue…" maxlength="4000"></textarea><button class="send continue-send" type="submit" title="Continue this chat (Enter)">Continue</button></div></form>` : asking && mine ? `<form class="ask cbox side-ask" data-action-${a.stage === 'draft' ? 'start' : 'answer'}="${esc(n.id)}">${attached(n)}<div class="crow"><textarea rows="2" aria-label="${a.stage === 'draft' ? 'Action instructions' : 'Clarification answer'}" placeholder="${a.stage === 'draft' ? 'Write your action…' : 'Your answer…'}" maxlength="${a.stage === 'draft' ? 4000 : 2000}" required>${a.stage === 'draft' ? esc(a.intent || '') : ''}</textarea><button class="send${a.plan && a.stage === 'draft' ? ' continue-send' : ''}" type="submit" title="${a.stage === 'draft' ? 'Prepare action' : 'Send answer'} (Enter)" aria-label="${a.stage === 'draft' ? 'Prepare action' : 'Send answer'}">${a.plan && a.stage === 'draft' ? 'Prepare' : view.sendIcon}</button></div></form>` : '';
    // its author lets it run on its own once ready; the map still holds anything that sends or changes things
    const alone = mine && view.cancellable(a) && (a.intent || a.plan) ? `<button class="action-type-toggle action-alone" role="switch" aria-checked="${!!a.auto}" data-box-action="actionalone" data-action-id="${esc(n.id)}" data-action-on="${!a.auto}" title="Once it is ready, the map runs it for you if it only looks things up. Anything that sends, posts or changes code still waits for your go."><span>Run on its own</span><span class="action-type-track" aria-hidden="true"></span></button>` : '';
    const cancel = mine && view.cancellable(a) && !actionUntouched(a) ? `<button class="gb action-cancel" data-box-action="actioncancel" data-action-id="${esc(n.id)}">Cancel Action</button>` : '';
    // an Admin can hand an Action to another member while nothing is under way for its author
    const others = view.people.filter((/** @type {any} */ p) => p.id !== a.by && (p.sees === 'all' || !p.sees || p.sees === n.area));
    const handover = view.live && view.admin && !['gathering','running'].includes(a.stage) && others.length
      ? `<details class="action-handover"><summary>Hand over</summary><div>${others.map((/** @type {any} */ p) => `<button class="gb" data-box-action="actionhandover" data-action-id="${esc(n.id)}" data-action-to="${esc(p.id)}">${esc(p.id)}</button>`).join('')}</div></details>` : '';
    return `<div class="action-chat-head"><span class="action-chat-title">Action box ${actionStatusPill(a)}</span>${alone}${handover}${cancel}</div>${actionHistoryList(n)}<div class="sc-msgs">${previousChat}${actionDocuments(a)}${turns}${current}${confirmDone}</div>${composer}`;
  }
  // what code recorded of this Action, newest first, folded away until opened
  function actionHistoryList(/** @type {any} */ n){
    const rows = actionHistory(n.action?.events), key = `action-history:${n.id}`;
    if (!rows.length) return '';
    const when = (/** @type {any} */ at) => Number.isFinite(at) ? prose(new Date(at).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })) : '';
    return `<details class="action-history" data-open-key="${esc(key)}" ${view.opened(key) ? 'open' : ''}><summary>Action history</summary><ol>${rows.map((r) => `<li><b>${esc(r.label)}</b>${r.who ? ` · ${esc(r.who)}` : ''}${when(r.at) ? ` · <span class="quiet">${when(r.at)}</span>` : ''}${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</li>`).join('')}</ol></details>`;
  }
  function actionSummary(/** @type {any} */ turn){
    const text = String(turn.completion?.summary || turn.text || '').split(/\n\s*\n/, 1)[0].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();
    return text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, '') + '…' : text;
  }
  function actionResult(/** @type {any} */ turn, /** @type {any} */ key){
    const c = turn.completion, openKey = `action-result:${key}`;
    const done = c?.status === 'completed' && c.evidence?.length > 0;
    const label = done ? 'Executed' : /** @type {Record<string, string>} */ ({needs_input:'Needs clarity',blocked:'Blocked',unverified:'Done, unverified'})[c?.status] || 'Completion unconfirmed';
    // Confirmation is what the map saw the run do; Claude's account is what it says it did, shown apart
    const evidence = (c?.evidence?.length ? `<div class="action-evidence"><b>Confirmation</b><ul>${c.evidence.map((/** @type {any} */ e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '')
      + (c?.claimed?.length && !done ? `<div class="action-evidence claimed"><b>Claude's account</b><ul>${c.claimed.map((/** @type {any} */ e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '')
      + (c?.note ? `<p class="action-note">${esc(c.note)}</p>` : '');
    return `<section class="action-result" aria-label="Task result"><h3>${done ? `<span class="result-pill">Executed</span>` : label}</h3>${done ? `<p class="result-summary">${esc(actionSummary(turn))}</p><details class="result-details" data-open-key="${esc(openKey)}" ${view.opened(openKey) ? 'open' : ''}><summary>View details</summary><div class="result-detail-body">${md(turn.text)}${evidence}</div></details>` : `${md(turn.text)}${c?.status === 'unconfirmed' || !c ? '<p class="action-note">No completion confirmation was returned.</p>' : ''}${evidence}`}</section>`;
  }
  function actionCard(/** @type {any} */ n){
    const a = n.action; if (!a) return '';
    const mine = a.by === view.me && view.live;
    const button = (/** @type {any} */ type, /** @type {any} */ label, extra = '') => mine ? `<button class="gb ${extra}" data-box-action="${type}" data-action-id="${esc(n.id)}" data-action-revision="${esc(a.id)}">${label}</button>` : '';
    const legacy = a.stage === 'unconfirmed';
    let content = '';
    if (a.stage === 'ready' || legacy) {
      const b = a.brief;
      content = `<h3>${legacy ? 'Completion unconfirmed' : 'Ready to execute'}</h3><p><b>${esc(b.goal)}</b></p><p class="action-note">${esc(b.target)}</p>${legacy ? '<p>No result came back from the earlier attempt. This task is not marked complete.</p>' : `<ol>${b.steps.map((/** @type {any} */ step) => `<li>${esc(step)}</li>`).join('')}</ol><p><b>Expected result:</b> ${esc(b.result)}</p>`}${b.email ? `<details><summary>Review email</summary><p><b>To:</b> ${esc(b.email.to)}</p><p><b>Subject:</b> ${esc(b.email.subject)}</p><pre>${esc(b.email.body)}</pre></details>` : ''}<p class="action-note">${legacy ? 'Execute here checks for prior work before doing more, then returns the result to this chat.' : a.held ? esc(a.held) : 'Execute runs this task and replies here.'}</p><div class="action-controls">${button('actionexecute',legacy ? 'Execute here' : 'Execute','action-execute')}${legacy ? '' : button('actionrevise','Revise')}</div>`;
    } else if (a.stage === 'cancelled') content = `<h3>Cancelled</h3>${a.brief ? `<p><b>${esc(a.brief.goal)}</b></p>` : ''}<p>${esc(a.cancelled?.by || a.by)} cancelled this Action${a.cancelled?.at ? ` on ${prose(new Date(a.cancelled.at).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }))}` : ''}. Its instructions, answers and versions are kept.</p><div class="action-controls">${button('actionreopen','Prepare again')}</div>`;
    else if (a.stage === 'waiting') content = `<h3>Waiting on a dependency</h3><ul>${(a.waiting || []).map((/** @type {any} */ w) => `<li>${esc(w.detail)}</li>`).join('')}</ul><p class="action-note">Finish the prerequisite Actions first. This Action will still need preparation and review.</p><div class="action-controls">${button('actionretry','Check again')}</div>`;
    else content = `<h3>Preparation stopped</h3><p>${esc(a.error || 'Try gathering information again.')}</p><div class="action-controls">${button('actionretry','Try again')}</div>`;
    return `<section class="action-card" aria-label="Action box">${content}</section>`;
  }
  function plannedActionCard(/** @type {any} */ n, /** @type {any} */ plan){
    const list = (/** @type {any} */ title, /** @type {any} */ items) => items?.length ? `<p><b>${title}</b></p><ul>${items.map((/** @type {any} */ s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
    const deps = (plan.dependsOn || []).map((/** @type {any} */ id) => { const box=view.box(id); return box ? `${box.label}${actionExecuted(box.action) ? ' · Completed' : ''}` : 'A prerequisite that is not available'; });
    const released = n.action?.stage === 'draft' && plan.readiness === 'waiting';
    const readiness = released ? 'Prerequisites completed. Ready for preparation' : /** @type {Record<string, string>} */ ({ready:'Ready for preparation',needs_information:'Needs information',waiting:'Waiting on a dependency'})[plan.readiness] || 'Needs information';
    const key = `action-plan:${n.id}`;
    const notes = list('Planner notes', (plan.blockers || []).map((/** @type {any} */ b) => `${b.detail} (${b.resolver})`));
    return `<section class="action-card" aria-label="Planned Action"><h3>Planned Action</h3><p><b>${esc(plan.goal)}</b></p><p><b>Expected result:</b> ${esc(plan.result)}</p><p><b>Save to:</b> ${esc(plan.destination || 'Confirm during preparation')}</p><p class="action-note">${readiness}. Preparation checks the plan and available tools before you can review and Execute.</p>${released ? '' : notes}${list('Prerequisite Actions',deps)}<details data-open-key="${esc(key)}" ${view.opened(key) ? 'open' : ''}><summary>Task details</summary>${list('Inputs',plan.inputs)}${list('Steps',plan.steps)}${list('Completion evidence',plan.evidence)}${released ? notes : ''}</details></section>`;
  }
  return { actionStatusPill, actionSpinner, actionDocuments, boxTypeButton, actionChat, actionHistoryList, actionSummary, actionResult, actionCard, plannedActionCard };
}
