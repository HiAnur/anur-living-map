// What people do with an Action box, by hand: make it, prepare it, answer, revise, cancel, reopen, hand it over,
// execute, continue, stop and confirm it. Each hands the box to actionBoxes (action-box.js), which checks the
// stage and who may; archiving lives in archive-acts.js.

/** @param {{ getState: () => MapState, actions: ReturnType<typeof import('./action-box.js').actionBoxes> }} deps */
export function actionActs({ getState, actions }) {
  return {
    // the schema lets an id come as a number, which finds no box, so an Action box reads every id as text
    /** @param {Act<'actionbox'>} a */
    actionbox(a) { return actions.begin(/** @type {string} */ (a.id), a.by); },
    /** @param {Act<'actionstart'>} a */
    actionstart(a) { return actions.start(/** @type {string} */ (a.id), a.by, a.intent); },
    /** @param {Act<'actionretry'>} a */
    actionretry(a) { return actions.prepare(/** @type {string} */ (a.id), a.by); },
    /** @param {Act<'actionanswer'>} a */
    actionanswer(a) { return actions.prepare(/** @type {string} */ (a.id), a.by, a.answer); },
    /** @param {Act<'actionrevise'>} a */
    actionrevise(a) { return actions.revise(/** @type {string} */ (a.id), a.by); },
    /** @param {Act<'actioncancel'>} a */
    actioncancel(a) { return actions.cancel(/** @type {string} */ (a.id), a.by); },
    /** @param {Act<'actionreopen'>} a */
    actionreopen(a) { return actions.reopen(/** @type {string} */ (a.id), a.by); },
    // the new author must be a person on the map, not a name typed in
    /** @param {Act<'actionhandover'>} a */
    actionhandover(a) { return !!getState().people?.some((/** @type {any} */ p) => p.id === a.to) && actions.handover(/** @type {string} */ (a.id), a.by, a.to); },
    /** @param {Act<'actionconfirm'>} a */
    actionconfirm(a) { return actions.confirm(/** @type {string} */ (a.id), a.by, a.revision); },
    /** @param {Act<'actionexecute'>} a */
    actionexecute(a) { return actions.execute(/** @type {string} */ (a.id), a.by, a.revision); },
    /** @param {Act<'actioncontinue'>} a */
    actioncontinue(a) { return actions.continue(/** @type {string} */ (a.id), a.by, a.revision, a.answer); },
    /** @param {Act<'actionstop'>} a */
    actionstop(a) { return actions.stop(/** @type {string} */ (a.id), a.by, a.revision); },
  };
}
