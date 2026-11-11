// A system map, built by code from checked drawings: the platform on top, each repo's own map inside its box, and
// inside each of those boxes its components, built from the box's facts with no model (functions, tables, queues
// and the rest, with lines from permissions, triggers and schedules). Every box records where it came from
// (`source: { kind: 'code', repo, commit, … }`), keeps its evidence in its notes, and is `origin: 'code'`; what rests
// only on descriptions carries a warning saying so.

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

const COL = 340, ROW = 130, TALL = 8;
/**
 * Columns by how far a box is from where calls start; within a column, each box near the boxes that lead to it, so
 * lines cross less. A column taller than TALL wraps into more columns, and boxes with no lines sit in a grid after
 * the rest, so a repo with many loose parts still reads on one screen.
 * @param {{ id: string }[]} boxes @param {{ from: string, to: string }[]} lines
 */
export function layout(boxes, lines) {
  const ids = new Set(boxes.map((b) => b.id));
  const joined = lines.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
  const linked = new Set(joined.flatMap((l) => [l.from, l.to]));
  /** @type {Map<string, number>} */
  const depth = new Map(boxes.map((b) => [b.id, 0]));
  for (let i = 0; i < Math.min(boxes.length, 6); i++) for (const l of joined) depth.set(l.to, Math.min(5, Math.max(depth.get(l.to) || 0, (depth.get(l.from) || 0) + 1)));
  /** @type {string[][]} */
  const cols = [];
  for (const b of boxes) if (linked.has(b.id)) (cols[depth.get(b.id) || 0] ||= []).push(b.id);
  /** @type {Map<string, number>} */
  const row = new Map();
  const place = () => cols.forEach((c) => c?.forEach((id, r) => row.set(id, r)));
  place();
  for (let pass = 0; pass < 2; pass++) {
    for (const c of cols) {
      if (!c) continue;
      const near = (/** @type {string} */ id) => { const up = joined.filter((l) => l.to === id || l.from === id).map((l) => row.get(l.to === id ? l.from : l.to) ?? 0); return up.length ? up.reduce((a, b) => a + b, 0) / up.length : row.get(id) || 0; };
      c.sort((a, b) => near(a) - near(b));
    }
    place();
  }
  /** @type {Map<string, { x: number, y: number }>} */
  const pos = new Map();
  let x = 0;
  for (const c of cols) {
    if (!c) continue;
    c.forEach((id, i) => pos.set(id, { x: 90 + (x + Math.floor(i / TALL)) * COL, y: 120 + (i % TALL) * ROW }));
    x += Math.ceil(c.length / TALL);
  }
  const loose = boxes.filter((b) => !linked.has(b.id));
  const across = Math.max(2, Math.ceil(Math.sqrt(loose.length)));
  loose.forEach((b, i) => pos.set(b.id, { x: 90 + (x + (i % across)) * COL, y: 120 + Math.floor(i / across) * ROW }));
  return pos;
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
  const pos = layout(nodes, edges);
  return {
    nodes: nodes.map(({ f, id }) => ({
      id, label: String(evidence(f).replace(/^- [^:]+: /, '').replace(/ \(.*\)$/, '')).slice(0, 60),
      sub: (f.routes?.length ? f.routes.slice(0, 3).join(', ') : f.kind.replace(/_/g, ' ')).slice(0, 80),
      ...pos.get(id), desc: evidence(f, reading), origin: 'code',
      source: { kind: 'code', repo: reading.repo, ...(reading.head || {}), path: f.at },
      ...(f.kind === 'table' ? { icon: 'db' } : {}), ...(f.kind === 'outside_function' ? { kind: 'ext' } : {}),
    })),
    edges: edges.filter((e) => e.from !== e.to && nodes.some((n) => n.id === e.from)),
  };
}

/**
 * The map of one repo, from its checked drawing: its boxes, each holding its components.
 * @param {{ boxes: CheckedBox[], lines: CheckedLine[] }} drawn @param {Reading} reading
 */
export function repoMap(drawn, reading) {
  const facts = new Map(reading.facts.map((f) => [f.id, f]));
  const prefix = slug(reading.repo);
  const pos = layout(drawn.boxes, drawn.lines);
  const nodes = drawn.boxes.map((b) => {
    const cited = b.facts.map((i) => facts.get(i)).filter(/** @returns {f is Fact} */ (f) => !!f);
    const inside = components(cited, reading, `${prefix}-${slug(b.id)}`);
    return {
      id: `${prefix}-${slug(b.id)}`, label: b.name, sub: b.description.slice(0, 80), ...pos.get(b.id), origin: 'code',
      desc: `${b.description}\n\nShown by:\n${cited.slice(0, 20).map((f) => evidence(f, reading)).join('\n')}`.slice(0, 3000),
      source: { kind: 'code', repo: reading.repo, ...(reading.head || {}) },
      ...(b.kind === 'person' ? { kind: 'actor' } : b.kind === 'external' ? { kind: 'ext' } : {}), ...(b.kind === 'store' ? { icon: 'db' } : {}),
      ...(b.unconfirmed ? { warn: UNCONFIRMED } : {}), ...(inside ? { inside } : {}),
    };
  });
  const edges = drawn.lines.map((l) => ({ from: `${prefix}-${slug(l.from)}`, to: `${prefix}-${slug(l.to)}`, label: `${l.unconfirmed ? 'unconfirmed: ' : ''}${l.label}`.slice(0, 80), origin: 'code' }));
  return { nodes, edges };
}

/**
 * The whole system map: the platform's boxes on top, each repo's box holding that repo's map.
 * @param {{ boxes: CheckedBox[], lines: CheckedLine[] }} platform @param {Map<string, Fact>} links
 * @param {{ reading: Reading, drawn: { boxes: CheckedBox[], lines: CheckedLine[] } }[]} repos
 */
export function systemState(platform, links, repos) {
  const pos = layout(platform.boxes, platform.lines);
  const byRepo = new Map(repos.map((r) => [r.reading.repo, r]));
  const nodes = platform.boxes.map((b) => {
    const r = b.repo ? byRepo.get(b.repo) : null;
    const cited = b.facts.map((i) => links.get(i)).filter(/** @returns {f is Fact} */ (f) => !!f);
    return {
      id: `system-${slug(b.id)}`, label: b.name, sub: b.description.slice(0, 80), ...pos.get(b.id), origin: 'code',
      desc: `${b.description}${cited.length ? `\n\nShown by:\n${cited.slice(0, 12).map((f) => evidence(f)).join('\n')}` : ''}`.slice(0, 1500),
      ...(r ? { source: { kind: 'code', repo: r.reading.repo, ...(r.reading.head || {}), drawnAt: Date.now() }, inside: repoMap(r.drawn, r.reading) } : {}),
      ...(b.kind === 'person' ? { kind: 'actor' } : b.kind === 'external' ? { kind: 'ext' } : {}),
      ...(b.unconfirmed ? { warn: UNCONFIRMED } : {}),
    };
  });
  const edges = platform.lines.map((l) => ({ from: `system-${slug(l.from)}`, to: `system-${slug(l.to)}`, label: `${l.unconfirmed ? 'unconfirmed: ' : ''}${l.label}`.slice(0, 80), origin: 'code' }));
  return { nodes, edges, start: nodes.find((n) => n.inside)?.id || nodes[0]?.id };
}
