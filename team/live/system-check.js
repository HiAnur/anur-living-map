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

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */
/** @typedef {{ id: string, name: string, kind: string, description: string, facts: string[], repo?: string }} DrawnBox */
/** @typedef {{ from: string, to: string, label: string, facts: string[] }} DrawnLine */

const WORDS_ONLY = new Set(['doc', 'module']);
export const STRUCTURAL = new Set(['function', 'outside_function', 'table', 'queue', 'topic', 'bucket', 'api', 'http_route', 'state_machine', 'schedule',
  'event_source', 'user_pool', 'stream', 'construct', 'grant', 'link', 'aws_call', 'api_call', 'screens', 'state_slice', 'invokes_by_name', 'amplify_resource']);

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
    boxes.set(b.id, { ...b, name: String(b.name || b.id).slice(0, 80), description: String(b.description || '').slice(0, 200), facts: ids,
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
    lines.push({ from: l.from, to: l.to, label: String(l.label || '').slice(0, 60), facts: ids, ...(wordsOnly(ids) ? { unconfirmed: true } : {}) });
  }
  const covered = new Set([...boxes.values()].flatMap((b) => b.facts));
  const leftOut = [...facts.values()].filter((f) => STRUCTURAL.has(f.kind) && !covered.has(f.id)).map((f) => f.id);
  return { boxes: [...boxes.values()], lines, rejected, leftOut };
}
