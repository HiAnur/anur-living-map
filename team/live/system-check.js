// What code checks in a drawing the agent proposes from facts, before anything is stored: the rules of issue #363.
// The agent's answer is untrusted, like every answer the map gets (draw-guard.js, checkProposal).
//
//   1. a citation of a fact that does not exist rejects the box or line
//   2. a box or line that cites nothing is rejected
//   3. a line must be shown by its facts at both ends: some cited fact involves its first box, and some its second
//      (a fact a box cites; a link between the repos two boxes stand for; or a fact naming something the other end
//      cites). Citation alone is not enough. When its citations miss but one end's own facts name the other end,
//      the line stands on those facts instead.
//   4. a box or line resting only on descriptions (module and class docs) is kept, marked unconfirmed, for an
//      engineer to confirm or drop
//   5. the structural facts no box cites are listed, so leaving something out is never silent
//   6. a box's name shares a word with what its facts say, else code names it from them; and its description names
//      no function, route or table (a code name) that none of its facts contain, else code describes it from them

import { shared, wordsOf } from './name-words.js';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */
/** @typedef {{ id: string, name: string, kind: string, description: string, facts: string[], repo?: string }} DrawnBox */
/** @typedef {{ from: string, to: string, label: string, facts: string[] }} DrawnLine */

const WORDS_ONLY = new Set(['doc', 'module']);
export const STRUCTURAL = new Set(['function', 'outside_function', 'table', 'queue', 'topic', 'bucket', 'api', 'http_route', 'state_machine', 'schedule',
  'event_source', 'user_pool', 'stream', 'construct', 'grant', 'link', 'aws_call', 'api_call', 'screens', 'state_slice', 'invokes_by_name', 'amplify_resource',
  'container', 'compose_service', 'api_spec']);

// Words that say what kind of thing a name is rather than which one, so `self.allow_list_table` and
// `BotAllowListDynamoDB` both come down to the thing's own name.
const KIND_WORDS = /(dynamodb|table|lambda|function|handler|stack|construct|queue|bucket|topic|secret|arn|name|fn)$/;
/** A name as rule 3 compares it: lower case, letters and digits only, its file extension and kind words dropped. @param {string} s */
export function norm(s) {
  let n = String(s).replace(/^self\./, '').split('/').pop()?.replace(/\.(py|tsx?|jsx?|json)$/, '').toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  for (let m = n.replace(KIND_WORDS, ''); m !== n && m.length >= 5; m = n.replace(KIND_WORDS, '')) n = m;
  return n;
}
/** The names a fact gives what it is about, normalized, for rule 3's "naming something the other end cites". @param {Fact} f */
const namesOf = (f) => [f.logical_id, f.name, f.function, f.resource, f.constant, f.construct, f.folder, f.to, f.on, f.module,
  typeof f.path === 'string' ? f.path : null].filter((x) => typeof x === 'string').map(norm).filter((x) => x.length >= 5 && !GENERIC.has(x));
/**
 * Whether an import fact brings in a module: `utils.dynamo` and `from . import dynamo` both reach `utils/dynamo.py`,
 * and `utils` reaches every module in that package.
 * @param {Fact} imp @param {string} module a module's path in the repo
 */
export function importsModule(imp, module) {
  const dots = /^\.*/.exec(imp.imports)?.[0].length || 0;
  const here = String(imp.module).split('/').slice(0, -1);
  const base = dots ? here.slice(0, here.length - (dots - 1)) : [];
  const want = [...base, ...String(imp.imports).slice(dots).split('.').filter(Boolean)].join('/');
  const have = module.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/');
  // code under a source folder (`src/utils/aws.py`) is imported without it (`utils.aws`)
  return !!want && have.some((_, k) => {
    const s = have.slice(k).join('/');
    return s === want || s.startsWith(`${want}/`) || want.startsWith(`${s}/`);
  });
}
// names so common that sharing one shows nothing
const GENERIC = new Set(['lambda', 'function', 'handler', 'index', 'utils', 'common', 'models', 'config', 'client', 'service', 'helpers', 'constants', 'types', 'stacks', 'routes']);

/** Every value a fact holds as text, but its own id and kind. @param {Fact[]} told @returns {string[]} */
const saidBy = (told) => {
  /** @type {(v: unknown) => string[]} */
  const values = (v) => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(values) : v && typeof v === 'object' ? Object.values(v).flatMap(values) : [];
  return told.flatMap((f) => Object.entries(f).filter(([k]) => k !== 'id' && k !== 'kind').flatMap(([, v]) => values(v)));
};
/** Text as code names are compared: lower case letters and digits only. @param {string} t */
const flat = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
// the fields a fact names its thing in, most telling first
const NAMED_BY = ['name', 'construct', 'logical_id', 'function', 'resource', 'constant', 'route', 'module', 'folder', 'path', 'fromRepo'];
/** A box's name from its facts: what the first of them that names something calls it, in words. @param {Fact[]} told */
function nameFrom(told) {
  const raw = told.flatMap((f) => NAMED_BY.map((k) => f[k])).find((v) => typeof v === 'string' && v.trim()) ?? told[0]?.at ?? 'Unnamed';
  if (/^[A-Z]*\s*\//.test(raw)) return raw.slice(0, 80);
  const last = String(raw).replace(/^self\./, '').split('/').filter(Boolean).pop()?.replace(/\.(py|tsx?|jsx?|json)$/, '') || String(raw);
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/[_\-.:#]+/g, ' ').trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80) || 'Unnamed';
}
/** A box's description from its facts: how many of each kind of thing it stands on. @param {Fact[]} told */
function describe(told) {
  /** @type {Map<string, number>} */
  const kinds = new Map();
  for (const f of told) kinds.set(f.kind, (kinds.get(f.kind) || 0) + 1);
  return [...kinds].map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}${n === 1 ? '' : 's'}`).join(', ');
}
// What in a description reads as a name from the code rather than a word: `quoted`, a call(), a /route, a
// dotted.name, a snake_case or camelCase name. Brand names (DynamoDB, GitHub) are words, and pass.
const CODE_NAMES = [/`([^`]+)`/g, /\b([A-Za-z_][\w.]*)\(\)/g, /(?:^|[\s(])(\/[\w{}:.\-]*[A-Za-z][\w{}:.\-/]*)/g, /\b([a-z_][a-z0-9_]+(?:\.[a-z_][a-z0-9_]+)+)\b/gi,
  /\b([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\b/g, /\b([a-z]+[A-Z][A-Za-z0-9]*)\b/g];
/** @param {string} text @returns {{ said: string, key: string }[]} */
export function codeNames(text) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const re of CODE_NAMES) for (const m of text.matchAll(re)) {
    const said = m[1].replace(/[.,;:]+$/, ''), key = flat(said);
    if (key.length >= 3 && !found.has(key)) found.set(key, said);
  }
  return [...found].map(([key, said]) => ({ said, key }));
}

/**
 * @param {{ boxes: DrawnBox[], lines: DrawnLine[] }} drawing what the agent proposed
 * @param {Map<string, Fact>} facts the facts it was given, by id (for a platform map, the links between repos)
 * @returns {{ boxes: (DrawnBox & { unconfirmed?: boolean })[], lines: (DrawnLine & { unconfirmed?: boolean })[], rejected: { item: string, why: string }[], leftOut: string[] }}
 */
export function checkDrawing(drawing, facts) {
  /** @type {{ item: string, why: string }[]} */
  const rejected = [];
  const known = (/** @type {string} */ id) => facts.has(id);
  /** @param {{ facts?: unknown }} x @param {string} name */
  const cited = (x, name) => {
    const ids = Array.isArray(x.facts) ? x.facts.map(String) : [];
    if (!ids.length) { rejected.push({ item: name, why: 'cites no fact' }); return null; }
    const unknown = ids.filter((i) => !known(i));
    if (unknown.length) { rejected.push({ item: name, why: `cites facts that do not exist: ${unknown.slice(0, 5).join(', ')}` }); return null; }
    return ids;
  };
  const wordsOnly = (/** @type {string[]} */ ids) => ids.every((i) => WORDS_ONLY.has(facts.get(i)?.kind || ''));
  /** @type {Map<string, DrawnBox & { unconfirmed?: boolean }>} */
  const boxes = new Map();
  for (const b of drawing.boxes || []) {
    const name = `box "${b?.name || b?.id}"`;
    if (!b || typeof b.id !== 'string' || !b.id || boxes.has(b.id)) { rejected.push({ item: name, why: 'has no id, or the same id as another box' }); continue; }
    const ids = cited(b, name); if (!ids) continue;
    const told = ids.map((i) => /** @type {Fact} */ (facts.get(i)));
    let named = String(b.name || b.id), described = String(b.description || '');
    if (!shared(wordsOf(named), wordsOf(saidBy(told).join(' ')))) {
      const fromFacts = nameFrom(told);
      rejected.push({ item: name, why: `its name shares no word with its facts: named "${fromFacts}" from them` });
      named = fromFacts;
    }
    const unknown = codeNames(described).filter((c) => !told.some((f) => flat(saidBy([f]).join(' ')).includes(c.key)));
    if (unknown.length) {
      rejected.push({ item: `the description of box "${named}"`, why: `it names ${unknown.slice(0, 3).map((c) => c.said).join(', ')}, which none of its facts contain: described from its facts instead` });
      described = describe(told);
    }
    boxes.set(b.id, { ...b, name: named.slice(0, 80), description: described.slice(0, 200), facts: ids,
      ...(wordsOnly(ids) ? { unconfirmed: true } : {}) });
  }
  /** Whether a fact involves a box: the box cites it, it links the box's repo, or it names something the box cites. @param {string} id @param {DrawnBox} box */
  const involves = (id, box) => {
    if (box.facts.includes(id)) return true;
    const f = facts.get(id); if (!f) return false;
    if (box.repo && (f.fromRepo === box.repo || f.toRepo === box.repo)) return true;
    if (f.kind === 'import' && box.facts.some((other) => { const o = facts.get(other); return typeof o?.module === 'string' && o.module !== f.module && importsModule(f, o.module); })) return true;
    const said = JSON.stringify(f).toLowerCase().replace(/[^a-z0-9]/g, ''), own = namesOf(f);
    return box.facts.some((other) => {
      const o = facts.get(other);
      return o ? namesOf(o).some((n) => said.includes(n) || own.some((m) => n.includes(m))) : false;
    });
  };
  /** @type {(DrawnLine & { unconfirmed?: boolean })[]} */
  const lines = [];
  for (const l of drawing.lines || []) {
    const from = boxes.get(l?.from), to = boxes.get(l?.to);
    const name = `line ${from?.name || l?.from} → ${to?.name || l?.to}`;
    if (!from || !to || from === to) { rejected.push({ item: name, why: 'joins a box that is not on the map' }); continue; }
    let ids = cited(l, name); if (!ids) continue;
    if (!ids.some((i) => involves(i, from)) || !ids.some((i) => involves(i, to))) {
      // the line's own citations miss, but one end's facts name the other end: those facts show it, and become its evidence
      const shown = [...from.facts.filter((i) => involves(i, to)), ...to.facts.filter((i) => involves(i, from))];
      if (!shown.length) { rejected.push({ item: name, why: 'its facts do not show both of its ends' }); continue; }
      ids = [...new Set([...ids, ...shown])];
    }
    lines.push({ from: l.from, to: l.to, label: String(l.label || '').slice(0, 80), facts: ids, ...(wordsOnly(ids) ? { unconfirmed: true } : {}) });
  }
  const covered = new Set([...boxes.values()].flatMap((b) => b.facts));
  const leftOut = [...facts.values()].filter((f) => STRUCTURAL.has(f.kind) && !covered.has(f.id)).map((f) => f.id);
  return { boxes: [...boxes.values()], lines, rejected, leftOut };
}
