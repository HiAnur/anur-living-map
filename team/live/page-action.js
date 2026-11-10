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
    error:{label:'Blocked',tone:'blocked'},
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
  unblocked:'Stopped waiting on a deleted box',
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
