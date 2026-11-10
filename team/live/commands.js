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

// `name?` may be left out (or null).
/** @type {Record<string, Record<string, string>>} */
export const COMMANDS = {
  actionbox: { id: 'id' },
  actionstart: { id: 'id', intent: 'text?' },
  actionretry: { id: 'id' },
  actionanswer: { id: 'id', answer: 'text?' },
  actionrevise: { id: 'id' },
  actioncancel: { id: 'id' },
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
};

// What is wrong with an action, in words, or null when it fits its schema (or has none yet).
/** @param {any} a */
export function checkCommand(a) {
  const schema = COMMANDS[a?.type];
  if (!schema) return null;
  for (const [field, spec] of Object.entries(schema)) {
    const optional = spec.endsWith('?'), kind = /** @type {Kind} */ (optional ? spec.slice(0, -1) : spec), v = a[field];
    if (v === undefined || v === null) { if (optional) continue; return `${a.type} needs ${field}.`; }
    if (!KINDS[kind](v)) return `${a.type}: ${field} must be ${SAID[kind]}.`;
  }
  return null;
}
