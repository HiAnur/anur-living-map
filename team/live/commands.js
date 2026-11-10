// One schema per map action: the fields its handler reads, and what each may be. A request whose fields do not
// fit is refused with 400, naming the field, before any handler runs. Fields a schema does not name are left as
// they are (the page adds `by` and, on a cloud map, `revision` to every action). The kinds follow what each
// handler copes with today: an id may come as text or a number, since the page reads many from the page's own
// attributes; a number must be a real one where the handler does sums with it.

/** @typedef {'id' | 'text' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any'} Kind */
/** @type {Record<Kind, (v: unknown) => boolean>} */
const KINDS = {
  id: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v)),
  text: (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: Array.isArray,
  object: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  any: () => true,
};
/** @type {Record<Kind, string>} */
const SAID = { id: 'an id', text: 'text', string: 'text', number: 'a number', boolean: 'true or false', array: 'a list', object: 'an object', any: 'anything' };

// `name?` may be left out (or null). Kept as written, so types.d.ts can read each action's type from it (Act).
export const COMMANDS = /** @type {const} */ ({
  actionbox: { id: 'id' },
  actionstart: { id: 'id', intent: 'text?' },
  actionretry: { id: 'id' },
  actionanswer: { id: 'id', answer: 'text?' },
  actionrevise: { id: 'id' },
  actioncancel: { id: 'id' },
  actionreopen: { id: 'id' },
  actionconfirm: { id: 'id', revision: 'any?' },
  actionhandover: { id: 'id', to: 'string' },
  actionexecute: { id: 'id', revision: 'any?' },
  actioncontinue: { id: 'id', revision: 'any?', answer: 'text?' },
  actionstop: { id: 'id', revision: 'any?' },
  savenow: {},
  autosave: { on: 'boolean?' },
  reset: {},
  open: {},
  undo: {},
  redo: {},
  contextmap: { id: 'string', include: 'boolean' },
  describemap: { description: 'string' },
  rename: { title: 'text?' },
  restore: { id: 'id' },
  comment: { text: 'text?', x: 'number', y: 'number', view: 'string?', node: 'id?' },
  reply: { id: 'id', text: 'text?' },
  resolve: { id: 'id' },
  newchat: {},
  openchat: { chat: 'text?' },
  execute: {},
  planmd: {},
  editmemory: { id: 'id', text: 'text?' },
  forget: { id: 'id' },
  // drawing on the map
  add: { label: 'text?', x: 'number', y: 'number', view: 'string?', w: 'text?', h: 'text?', from: 'id?', out: 'any?', in: 'any?', reflow: 'array?' },
  move: { id: 'id?', moves: 'array?', x: 'number?', y: 'number?', view: 'string?' },
  reparent: { id: 'id?', ids: 'array?', parent: 'id', view: 'string?', parents: 'array?', parentsById: 'object?', moves: 'array?' },
  resize: { id: 'id', x: 'number', y: 'number', w: 'text?', h: 'text?' },
  connect: { from: 'id', to: 'id', label: 'text?', out: 'any?', in: 'any?', view: 'string?' },
  relabel: { from: 'id', to: 'id', label: 'text?', view: 'string?' },
  unlink: { from: 'id', to: 'id' },
  remove: { id: 'id?', ids: 'array?', cascade: 'boolean?', only: 'any?' },
  tidy: { only: 'array?', sizes: 'array?', view: 'string?' },
  renamebox: { id: 'id', label: 'text?', proposed: 'any?' },
  describebox: { id: 'id', sub: 'string', proposed: 'any?' },
  // questions on the map, and Claude's chats and changes
  call: { id: 'id', option: 'any?', other: 'text?', answer: 'text?' },
  ask: { about: 'id?', node: 'id?', text: 'text?', side: 'any?', autoPlan: 'any?' },
  apply: { proposal: 'id?', thread: 'text?', index: 'text?' },
  drop: { proposal: 'id?', thread: 'text?', index: 'text?' },
  link: { session: 'text?', file: 'text?' },
  say: { text: 'text?', images: 'array?' },
  propose: { session: 'text?', note: 'text?', nodes: 'array?', edges: 'array?', remove: 'array?', unlink: 'array?', memory: 'array?', start: 'any?', tidy: 'any?' },
  plan: { session: 'text?', note: 'text?', nodes: 'array?', edges: 'array?', calls: 'array?', remove: 'array?', unlink: 'array?', answers: 'object?', title: 'text?', ticket: 'text?', prompt: 'text?' },
  edit: { note: 'text?', nodes: 'array?', edges: 'array?', calls: 'array?', memory: 'array?', unlink: 'array?', start: 'any?', tidy: 'any?' },
  pr: { id: 'id', title: 'text?', url: 'text?', status: 'any?', agent: 'text?', checks: 'array?', files: 'array?' },
});

// Actions that take one field or another: a rule beyond each field's kind.
/** @type {Record<string, (a: any) => string | null>} */
const ALSO = {
  move: (a) => Array.isArray(a.moves) || (a.id != null && KINDS.number(a.x) && KINDS.number(a.y)) ? null : 'move needs moves, or id with x and y.',
  remove: (a) => Array.isArray(a.ids) || a.id != null ? null : 'remove needs id or ids.',
  reparent: (a) => Array.isArray(a.ids) || a.id != null ? null : 'reparent needs id or ids.',
};

// What is wrong with an action, in words, or null when it fits its schema.
/** @param {any} a */
export function checkCommand(a) {
  const schema = /** @type {Record<string, Record<string, string>>} */ (COMMANDS)[a?.type];
  if (!schema) return null;
  for (const [field, spec] of Object.entries(schema)) {
    const optional = spec.endsWith('?'), kind = /** @type {Kind} */ (optional ? spec.slice(0, -1) : spec), v = a[field];
    if (v === undefined || v === null) { if (optional) continue; return `${a.type} needs ${field}.`; }
    if (!KINDS[kind](v)) return `${a.type}: ${field} must be ${SAID[kind]}.`;
  }
  return ALSO[a.type]?.(a) ?? null;
}
