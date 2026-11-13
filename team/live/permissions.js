// Who may take each action on a map: the one table of it, and the one check of it before any handler runs.
//
// A request reaches an action only through permission() in sharing.js: an Admin of the map is its owner, a member
// or a program on this Mac may edit (a program acts as the name it gives), a link's guest has its link's mode, and a
// removed member has nothing. A view link takes no action. Then each action needs a standing:
//   link    anyone who may edit, a guest with an edit link too, who acts as Guest
//   member  anyone who may edit but a link's guest
//   whole   a member who sees the whole map, not one area
//   admin   a member who is an Admin of this map
// mayAct decides the standing, here, before the handler. What depends on the map itself (`then`: whether the
// boxes an action touches are in the person's area, whether a chat or an Action is theirs) the handler checks,
// once it has found those boxes; `then` says what each one checks, so the whole rule for an action reads here.
// permissions.test.js asks a real map each of these as every kind of person.
import { managesAccess } from './access.js';

/** @typedef {'link' | 'member' | 'whole' | 'admin'} Standing */
/** @type {Record<string, { standing: Standing, then: string }>} */
export const WHO = {
  // drawing by hand
  move: { standing: 'link', then: 'a drag of several boxes: each is in their area. One box moved by its id is not checked.' },
  reparent: { standing: 'link', then: 'the branch, its old parents and its new parent are in their area' },
  tidy: { standing: 'link', then: 'nothing: it lays out the whole map, also for a one-area member' },
  add: { standing: 'link', then: 'the new box takes their area; the line from the box it was drawn out of only when that box is in their area' },
  connect: { standing: 'link', then: 'both boxes are in their area' },
  relabel: { standing: 'link', then: 'both boxes are in their area' },
  unlink: { standing: 'link', then: 'both boxes are in their area' },
  remove: { standing: 'link', then: 'every box taken off (the whole branch with cascade) is in their area; a box holding an Action only by its author or an Admin, before it has run and while it is not preparing or running (action-leave.js)' },
  resize: { standing: 'link', then: 'the box is in their area' },
  renamebox: { standing: 'link', then: 'the box is in their area; a box Claude proposed is in a proposal of theirs' },
  describebox: { standing: 'link', then: 'the box is in their area; a box Claude proposed is in a proposal of theirs' },
  pointbox: { standing: 'member', then: 'the box is in their area, and the map builds on a system map' },
  rename: { standing: 'link', then: 'nothing: the map\'s title, also for a one-area member' },
  undo: { standing: 'link', then: 'only their own steps, and only on boxes in their area' },
  redo: { standing: 'link', then: 'only their own steps, and only on boxes in their area' },
  cursor: { standing: 'link', then: 'nothing: where their pointer is, never saved' },
  // comments
  comment: { standing: 'link', then: 'the box it is on, or inside, is in their area' },
  reply: { standing: 'link', then: 'the box its thread is on, or inside, is in their area' },
  resolve: { standing: 'link', then: 'the box its thread is on, or inside, is in their area; then anyone may resolve or reopen it' },
  // the map as a whole
  savenow: { standing: 'member', then: 'nothing' },
  autosave: { standing: 'member', then: 'nothing: one switch for the whole map' },
  reset: { standing: 'member', then: 'nothing: starts the whole map over, also for a one-area member (History keeps the map before)' },
  restore: { standing: 'member', then: 'nothing: goes back to any version, also for a one-area member' },
  open: { standing: 'member', then: 'nothing' },
  describemap: { standing: 'whole', then: 'nothing' },
  contextmap: { standing: 'whole', then: 'a map added as background is one they may open' },
  execute: { standing: 'admin', then: 'every question on the map is answered, and it was not executed yet' },
  actionhandover: { standing: 'admin', then: 'the Action is not preparing or running, and the new author is a member of the map who can use its box' },
  planmd: { standing: 'admin', then: 'every question on the map is answered, and it was not executed yet' },
  // memory, questions and Claude's chats
  editmemory: { standing: 'member', then: 'a box\'s memory only when the box is in their area' },
  forget: { standing: 'member', then: 'a box\'s memory only when the box is in their area' },
  call: { standing: 'member', then: 'the question\'s box is in their area; then any open question, also one asked of someone else' },
  ask: { standing: 'member', then: 'the box asked about is in their area; the question goes into their own chat' },
  apply: { standing: 'member', then: 'the change came from their own chat' },
  drop: { standing: 'member', then: 'the change came from their own chat' },
  newchat: { standing: 'member', then: 'their own chat' },
  openchat: { standing: 'member', then: 'their own chat' },
  link: { standing: 'member', then: 'the file is a chat of this Mac\'s agent; the chat links as theirs' },
  say: { standing: 'member', then: 'they own the chat linked to the map' },
  // what a chat sends through the map's tools
  propose: { standing: 'member', then: 'it names a chat linked to the map' },
  myaction: { standing: 'member', then: 'it names a chat linked to the map, not one the map runs itself, sent by that chat\'s tools or its owner; the drafts are always that owner\'s, from their own messages in that chat (action-items.js)' },
  plan: { standing: 'member', then: 'draw-guard.js: only boxes, lines, removals and questions in their area, never a box\'s Action, maker or area (a whole-map member may set an area), and never a question\'s answer' },
  edit: { standing: 'member', then: 'draw-guard.js: only boxes, lines, removals and questions in their area, never a box\'s Action, maker or area (a whole-map member may set an area), and never a question\'s answer; from a chat answering a request in the map\'s pane, a proposal for that chat\'s owner instead' },
  pr: { standing: 'member', then: 'nothing' },
  // Action boxes
  ...Object.fromEntries(['actionbox', 'actionstart', 'actionretry', 'actionanswer', 'actionrevise', 'actioncancel', 'actionreopen', 'actionconfirm', 'actionalone', 'actionexecute', 'actioncontinue', 'actionstop']
    .map((type) => [type, { standing: /** @type {Standing} */ ('member'), then: 'they are signed in (not Guest, not removed), the box is in their area, and they started its Action' }])),
  actionarchive: { standing: 'member', then: 'the box is in their area, its Action has run, and they started it or are an Admin' },
  actionunarchive: { standing: 'member', then: 'the box is in their area, they started its Action or are an Admin, and its id is free on the map' },
  // action items (action-items.js)
  actionnotaction: { standing: 'member', then: 'the box is in their area, its Action was made from their own words and they are its author, and it has not run' },
  actionnotmine: { standing: 'member', then: 'the box is in their area, its Action was made from their own words and they are its author, it has not run, and it goes to another of the map\'s people or the team' },
  actiontakeon: { standing: 'member', then: 'the box is in their area, holds a task and no Action, and names them, the team or no one' },
};

/** The actions a guest with an edit link may take, here and on the cloud copy. */
export const LINK_EDITS = new Set(Object.keys(WHO).filter((type) => WHO[type].standing === 'link'));

/**
 * Whether this person has the standing the action needs. A guest is a link's guest; `a.by` is who acts.
 * @param {MapState} state @param {{ type: string, by?: string }} a @param {boolean} guest
 */
export function mayAct(state, a, guest) {
  const rule = WHO[a.type];
  if (!rule) return false;
  if (guest) return rule.standing === 'link';
  if (rule.standing === 'admin') return managesAccess(state, a.by);
  if (rule.standing === 'whole') return !!a.by && a.by !== 'Guest' && (state.people?.find((p) => p.id === a.by)?.sees || 'all') === 'all';
  return true;
}
