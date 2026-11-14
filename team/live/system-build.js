// A system map, built by code from checked drawings: the platform on top, each repo's own map inside its box, and
// inside each of those boxes its components, built from the box's facts with no model (functions, tables, queues
// and the rest, with lines from permissions, triggers and schedules). Every box records where it came from
// (`source: { kind: 'code', repo, commit, … }`), keeps its evidence in its notes, and is `origin: 'code'`; what rests
// only on descriptions carries a warning saying so.

import { placeLevel, tidyLevel } from './project.js';
import { CENTRE, withCentre } from './system-centre.js';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */
/** @typedef {{ id: string, name: string, kind: string, description: string, facts: string[], repo?: string, unconfirmed?: boolean }} CheckedBox */
/** @typedef {{ from: string, to: string, label: string, facts: string[], unconfirmed?: boolean }} CheckedLine */
/** @typedef {{ repo: string, root: string, head: { commit: string, branch: string } | null, kinds: string[], facts: Fact[], github?: { owner: string, name: string } | null }} Reading */

const COMPONENT = new Set(['function', 'outside_function', 'table', 'queue', 'topic', 'bucket', 'api', 'http_route', 'state_machine', 'schedule',
  'user_pool', 'stream', 'secret', 'parameter', 'construct', 'screens', 'state_slice', 'amplify_resource', 'container', 'compose_service', 'api_spec']);
const UNCONFIRMED = 'Unconfirmed: only descriptions show this. Confirm it or take it off.';
const slug = (/** @type {string} */ s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'box';

/**
 * One line saying what a fact is and where it came from, for a box's notes; where it came from links to that file and
 * line on GitHub, at the commit the map was drawn from, when the repo is there and the file is in git.
 * @param {Fact} f @param {Reading | null} [reading]
 */
export function evidence(f, reading = null) {
  const what = f.kind === 'api_call' ? `${f.method} ${f.path}` : f.name || f.logical_id || f.route || f.function || f.resource || f.folder || f.module || (typeof f.path === 'string' ? f.path.split('/').pop() : '') || f.text?.slice(0, 60) || f.kind;
  const where = f.at && f.at !== 'links' ? String(f.at) : '';
  const file = /^([^#:]+\.[\w]+):(\d+)/.exec(where), gh = reading?.github, commit = reading?.head?.commit;
  const linked = file && gh && commit && !file[1].startsWith('cdk.out/') ? `[${where}](https://github.com/${gh.owner}/${gh.name}/blob/${commit}/${file[1].split('/').map(encodeURIComponent).join('/')}#L${file[2]})` : where;
  return `- ${f.kind.replace(/_/g, ' ')}: ${what}${where ? ` (${linked})` : ''}`;
}

/**
 * A level code built, laid out the way every level of every map is (tidyLevel in project.js): round its circle, as
 * a mind map, with what nothing calls hanging off the circle and the rest under what calls it first. A box no line
 * joins to the tree gets a free place beside it.
 * @template {{ nodes: any[], edges: any[] }} L @param {L} level @param {import('./project.js').LevelOf} where @returns {L}
 */
function laidOut(level, where) {
  tidyLevel(level, where);
  placeLevel(level, where);
  return level;
}

/**
 * A box's components, built from its facts alone: one box per thing its facts name, lines from what a function may
 * touch, what triggers it and what schedules it.
 * @param {Fact[]} facts the facts the box cites @param {Reading} reading @param {string} prefix
 */
function components(facts, reading, prefix) {
  const parts = facts.filter((f) => COMPONENT.has(f.kind));
  if (parts.length < 2) return null;
  const idOf = (/** @type {Fact} */ f) => `${prefix}-${f.id}`;
  const lid = (/** @type {Fact} */ f) => String(f.at).split('#')[1] || '';
  /** @type {Map<string, Fact>} */
  const byLid = new Map(parts.filter((f) => lid(f)).map((f) => [lid(f), f]));
  /** @type {{ from: string, to: string, label: string, origin: string }[]} */
  const edges = [];
  /** @param {Fact} a @param {Fact | undefined} b @param {string} label */
  const link = (a, b, label) => { if (b && a !== b && !edges.some((e) => e.from === idOf(a) && e.to === idOf(b))) edges.push({ from: idOf(a), to: idOf(b), label, origin: 'code' }); };
  for (const f of parts) {
    if (f.kind === 'function') for (const m of f.may || []) for (const on of m.on || []) link(f, byLid.get(on), (m.services || []).join(', ').slice(0, 40));
    if (f.kind === 'schedule' || f.kind === 'user_pool') for (const t of f.targets || []) link(f, byLid.get(t), 'triggers');
  }
  // a compose service that waits on another
  for (const f of parts) if (f.kind === 'compose_service') for (const d of f.depends_on || []) link(f, parts.find((p) => p.kind === 'compose_service' && p.name === d && p.at.split(':')[0] === f.at.split(':')[0]), 'depends on');
  for (const f of facts) if (f.kind === 'event_source') for (const fn of f.functions || []) for (const src of f.from || []) link(/** @type {Fact} */ (byLid.get(src)), byLid.get(fn), 'triggers');
  const nodes = parts.map((f) => ({ f, id: idOf(f) }));
  return laidOut({
    nodes: nodes.map(({ f, id }) => ({
      id, label: String(evidence(f).replace(/^- [^:]+: /, '').replace(/ \(.*\)$/, '')).slice(0, 60),
      sub: (f.routes?.length ? f.routes.slice(0, 3).join(', ') : f.kind.replace(/_/g, ' ')).slice(0, 80),
      desc: evidence(f, reading), origin: 'code',
      source: { kind: 'code', repo: reading.repo, ...(reading.head || {}), path: f.at, facts: [f.id] },
      ...(f.kind === 'table' ? { icon: 'db' } : {}), ...(f.kind === 'outside_function' ? { kind: 'ext' } : {}),
    })),
    edges: edges.filter((e) => e.from !== e.to && nodes.some((n) => n.id === e.from)),
  }, { top: false });
}

/**
 * The map of one repo, from its checked drawing: its boxes, each holding its components.
 * @param {{ boxes: CheckedBox[], lines: CheckedLine[] }} drawn @param {Reading} reading
 */
export function repoMap(drawn, reading) {
  const facts = new Map(reading.facts.map((f) => [f.id, f]));
  const prefix = slug(reading.repo);
  const nodes = drawn.boxes.map((b) => {
    const cited = b.facts.map((i) => facts.get(i)).filter(/** @returns {f is Fact} */ (f) => !!f);
    const inside = components(cited, reading, `${prefix}-${slug(b.id)}`);
    return {
      id: `${prefix}-${slug(b.id)}`, label: b.name, sub: b.description.slice(0, 80), origin: 'code',
      desc: `${b.description}\n\nShown by:\n${cited.slice(0, 20).map((f) => evidence(f, reading)).join('\n')}`.slice(0, 3000),
      // the facts it stands for, by id in its repo's reading, so a trace starts from them (system-trace.js)
      source: { kind: 'code', repo: reading.repo, ...(reading.head || {}), facts: cited.map((f) => f.id) },
      ...(b.kind === 'person' ? { kind: 'actor' } : b.kind === 'external' ? { kind: 'ext' } : {}), ...(b.kind === 'store' ? { icon: 'db' } : {}),
      ...(b.unconfirmed ? { warn: UNCONFIRMED } : {}), ...(inside ? { inside } : {}),
    };
  });
  const edges = drawn.lines.map((l) => ({ from: `${prefix}-${slug(l.from)}`, to: `${prefix}-${slug(l.to)}`, label: `${l.unconfirmed ? 'unconfirmed: ' : ''}${l.label}`.slice(0, 80), origin: 'code' }));
  return laidOut({ nodes, edges }, { top: false });
}

/**
 * The whole system map: the platform's boxes on top, hanging off the system's centre (system-centre.js), and each
 * repo's box holding that repo's map, every level laid out round its circle.
 * @param {{ boxes: CheckedBox[], lines: CheckedLine[] }} platform @param {Map<string, Fact>} links
 * @param {{ reading: Reading, drawn: { boxes: CheckedBox[], lines: CheckedLine[] } }[]} repos @param {string} [title] the map's title, the centre's name
 */
export function systemState(platform, links, repos, title = '') {
  const byRepo = new Map(repos.map((r) => [r.reading.repo, r]));
  const nodes = platform.boxes.map((b) => {
    const r = b.repo ? byRepo.get(b.repo) : null;
    const cited = b.facts.map((i) => links.get(i)).filter(/** @returns {f is Fact} */ (f) => !!f);
    return {
      id: `system-${slug(b.id)}`, label: b.name, sub: b.description.slice(0, 80), origin: 'code',
      desc: `${b.description}${cited.length ? `\n\nShown by:\n${cited.slice(0, 12).map((f) => evidence(f)).join('\n')}` : ''}`.slice(0, 1500),
      ...(r ? { source: { kind: 'code', repo: r.reading.repo, ...(r.reading.head || {}), drawnAt: Date.now() }, inside: repoMap(r.drawn, r.reading) } : {}),
      ...(b.kind === 'person' ? { kind: 'actor' } : b.kind === 'external' ? { kind: 'ext' } : {}),
      ...(b.unconfirmed ? { warn: UNCONFIRMED } : {}),
    };
  });
  const edges = platform.lines.map((l) => ({ from: `system-${slug(l.from)}`, to: `system-${slug(l.to)}`, label: `${l.unconfirmed ? 'unconfirmed: ' : ''}${l.label}`.slice(0, 80), origin: 'code' }));
  /** @type {{ nodes: any[], edges: any[], start?: string }} */
  const state = { nodes, edges, start: nodes[0]?.id };
  if (!nodes.length) return state;
  withCentre(state, title);
  return laidOut(state, { top: true, start: CENTRE, label: title });
}
