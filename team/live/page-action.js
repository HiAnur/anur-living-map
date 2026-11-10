// What an Action box shows of where it stands: whether it was executed, and the words and tone of its status
// pill. A page module: see page-modules.js.

/** @param {any} a */
export const actionExecuted = (a) => a?.stage === 'finished' && a.completion?.status === 'completed' && a.completion.evidence?.length > 0;
/** @param {any} a */
export function actionStatus(a){
  if (!a?.stage || a.stage === 'draft') return null;
  if (actionExecuted(a)) return {label:'Executed',tone:'completed'};
  if (a?.stage === 'finished') return a.completion?.status === 'needs_input' ? {label:'Needs clarity',tone:'waiting'} : a.completion?.status === 'blocked' ? {label:'Blocked',tone:'blocked'} : {label:'Unconfirmed',tone:'waiting'};
  return /** @type {Record<string, { label: string, tone: string }>} */ ({
    gathering:{label:'Preparing',tone:'active'},
    clarify:{label:'Needs clarity',tone:'waiting'},
    waiting:{label:'Waiting',tone:'waiting'},
    ready:{label:'Ready to execute',tone:'active'},
    running:{label:'Executing',tone:'active'},
    error:{label:'Blocked',tone:'blocked'},
    blocked:{label:'Blocked',tone:'blocked'},
    sent:{label:'Unconfirmed',tone:'waiting'},
    unconfirmed:{label:'Unconfirmed',tone:'waiting'},
  })[a.stage] || {label:'Unconfirmed',tone:'waiting'};
}
