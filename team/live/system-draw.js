// Drawing a system map from code (issue #363): code reads every repo's facts (system-facts.js) and links them
// (system-links.js); the agent proposes each repo's map, and then the platform's, from those facts alone; code checks
// every proposal (system-check.js) and builds the map (system-build.js). The agent decides grouping, names,
// descriptions and how much detail; it never decides what exists. Each repo reports its stage as it goes.

import { checkDrawing } from './system-check.js';
import { systemState } from './system-build.js';
import { readRepo } from './system-facts.js';
import { linkRepos } from './system-links.js';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */
/** @typedef {Awaited<ReturnType<typeof readRepo>>} Reading */
/** @typedef {ReturnType<typeof checkDrawing>} Checked */
/** @typedef {{ repo: string, stage: 'waiting' | 'reading' | 'drawing' | 'checking' | 'done' | 'failed' | 'cancelled', reused?: boolean, facts?: number, boxes?: number, cost?: { value: number, unit: string }, error?: string, ms?: number, unread?: string[] }} Progress */

const KIND = ['function', 'store', 'queue', 'secret', 'setting', 'alarm', 'library', 'api', 'screen', 'state', 'external', 'person'];
const str = { type: 'string' }, ids = { type: 'array', items: str };
/** What the agent answers: boxes and lines, each citing the facts that show it. @param {boolean} platform */
export const drawingSchema = (platform) => ({
  type: 'object', additionalProperties: false, required: ['boxes', 'lines'], properties: {
    boxes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'kind', 'description', 'facts', ...(platform ? ['repo'] : [])],
      properties: { id: str, name: str, kind: { type: 'string', enum: KIND }, description: str, facts: ids, ...(platform ? { repo: str } : {}) } } },
    lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'label', 'facts'], properties: { from: str, to: str, label: str, facts: ids } } },
  },
});

export const RULES = `Draw a system map for an engineer, from the facts below and nothing else. You have no other access to the code.
- A box is one thing an engineer would name when explaining the system: a function or a group of functions an engineer explains together (by API and area), a table, a queue, a secret or setting, a shared library, an alarm worth knowing, an app area, its state, or an outside system or person the facts mention. Group facts that are parts of one thing into one box. Draw at most 20 boxes, so the map reads on one screen: group functions by API or area, and tables by what they hold. Each box opens into its parts, which code draws from the facts the box cites, so a group cites the facts of every part in it. Leave out pure plumbing (roles, log groups, deployment helpers). Name a box the way the code and its descriptions name it; its description is one short line.
- A line says what one box does to another in a few words ("reads and writes", "invokes", "triggers"), pointing the way the action goes.
- Every box and every line lists in facts the ids of the facts that show it. Cite only ids that appear below. A line's facts must show both of its ends: cite a fact of each box, or one fact (a permission, a call, a trigger) naming the other. Do not draw anything the facts do not show; if something is only said in a description, cite that description.`;

/** The facts as the agent reads them: what matters most first, within a size the agent reads well. @param {Fact[]} facts */
export function compact(facts, budget = 90_000) {
  const order = ['outside_function', 'function', 'construct', 'table', 'queue', 'topic', 'bucket', 'api', 'http_route', 'state_machine', 'schedule', 'event_source',
    'user_pool', 'secret', 'parameter', 'stream', 'grant', 'link', 'policy', 'invokes_by_name', 'screens', 'api_call', 'state_slice', 'imports_sdks', 'amplify_resource',
    'compose_service', 'container', 'api_spec', 'package', 'aws_client', 'aws_call', 'url', 'doc', 'module', 'env_read', 'amplify_envs', 'import'];
  /** @type {(v: unknown) => unknown} */
  const trim = (v) => typeof v === 'string' ? v.slice(0, 200) : Array.isArray(v) ? v.slice(0, 20).map(trim) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, trim(x)])) : v;
  const out = [];
  let size = 0;
  for (const kind of order) for (const f of facts.filter((x) => x.kind === kind)) {
    const { at: _at, also_at: _also, ...said } = f;
    const line = JSON.stringify(trim(said));
    if (size + line.length > budget) return { facts: out, cut: true };
    out.push(line); size += line.length;
  }
  return { facts: out, cut: false };
}

/** Runs `work` over `items`, `limit` at a time. @template T @param {T[]} items @param {number} limit @param {(item: T) => Promise<void>} work */
async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await work(items[next++]); }));
}

/**
 * Draws a system map from repos on this Mac. `reuse` hands back a repo's earlier checked drawing when it still
 * holds (a retry draws only what failed), `onDrawn` keeps each one as it is checked, and `signal` stops the drawing.
 * @param {{ folders: string[], agent: Pick<AgentWorker, 'answer'>, onProgress?: (p: Progress) => void, model?: string, concurrency?: number,
 *   signal?: AbortSignal, reuse?: (r: Reading) => Checked | null, onDrawn?: (r: Reading, drawn: Checked) => void }} job
 */
export async function drawSystem({ folders, agent, onProgress = () => {}, model, concurrency = 3, signal, reuse = () => null, onDrawn = () => {} }) {
  const started = Date.now();
  /** @type {Map<string, Progress>} */
  const progress = new Map();
  /** @param {Progress} p */
  const tell = (p) => { progress.set(p.repo, { ...progress.get(p.repo), ...p }); onProgress(/** @type {Progress} */ (progress.get(p.repo))); };
  /** @type {Reading[]} */
  const readings = [];
  for (const folder of folders) {
    if (signal?.aborted) break;
    const name = folder.split('/').filter(Boolean).pop() || folder;
    tell({ repo: name, stage: 'reading' });
    const r = await readRepo(folder);
    readings.push(r);
    tell({ repo: r.repo, stage: 'waiting', facts: r.facts.length, ...(r.unread.length ? { unread: r.unread } : {}) });
  }
  const { links, unmatched } = linkRepos(readings);
  /** @type {{ value: number, unit: string }[]} */
  const costs = [];
  /** @type {{ reading: Reading, drawn: ReturnType<typeof checkDrawing> }[]} */
  const drawn = [];
  for (const r of readings) if (!r.facts.length) tell({ repo: r.repo, stage: 'failed', error: r.unread[0] || 'Code found nothing it can read in this repo.' });
  await pool(readings.filter((r) => r.facts.length), concurrency, async (r) => {
    if (signal?.aborted) return;
    const kept = reuse(r);
    if (kept) { drawn.push({ reading: r, drawn: kept }); tell({ repo: r.repo, stage: 'done', boxes: kept.boxes.length, reused: true }); return; }
    const t = Date.now();
    tell({ repo: r.repo, stage: 'drawing' });
    const { facts, cut } = compact(r.facts);
    const kinds = r.kinds.includes('app') ? '\nThis repo is an app: its boxes are its main areas (screen groups), its state, its client for each backend, and the outside services and SDKs that matter. Group backend calls by area, naming the paths in descriptions.\n' : '';
    const prompt = `${RULES}\n${kinds}\nThe repo is ${r.repo}.${cut ? ' Its facts were cut to the most structural ones to fit.' : ''}\n\nFacts (one JSON object per line):\n${facts.join('\n')}\n`;
    const a = await agent.answer({ prompt, schema: drawingSchema(false), model, signal });
    if (a.cost) costs.push(a.cost);
    if (a.stopped || signal?.aborted) return;
    if (!a.value) { tell({ repo: r.repo, stage: 'failed', error: a.error || 'No drawing came back.', ms: Date.now() - t, ...(a.cost ? { cost: a.cost } : {}) }); return; }
    tell({ repo: r.repo, stage: 'checking' });
    const checked = checkDrawing(/** @type {any} */ (a.value), new Map(r.facts.map((f) => [f.id, f])));
    drawn.push({ reading: r, drawn: checked });
    onDrawn(r, checked);
    tell({ repo: r.repo, stage: 'done', boxes: checked.boxes.length, ms: Date.now() - t, ...(a.cost ? { cost: a.cost } : {}) });
  });
  /** what the report says, however the drawing ended */
  const report = () => ({
    repos: readings.map((r) => ({ repo: r.repo, root: r.root, kinds: r.kinds, head: r.head, facts: r.facts.length, unread: r.unread })),
    links: links.length, unmatched, rejected: [...drawn.flatMap((d) => d.drawn.rejected.map((x) => ({ repo: d.reading.repo, ...x }))), ...platform.rejected.map((x) => ({ repo: 'platform', ...x }))],
    leftOut: drawn.reduce((n, d) => n + d.drawn.leftOut.length, 0), costs, ms: Date.now() - started, progress: [...progress.values()],
  });
  /** @type {Checked} */
  let platform = { boxes: [], lines: [], rejected: [], leftOut: [] };
  if (signal?.aborted) {
    for (const p of progress.values()) if (!['done', 'failed'].includes(p.stage)) tell({ repo: p.repo, stage: 'cancelled' });
    return { state: null, report: report(), cancelled: true };
  }
  // the platform: one box per repo that was drawn, outside systems and people, from the links code found
  const repoNames = drawn.map((d) => d.reading.repo);
  const summary = drawn.map((d) => ({ repo: d.reading.repo, kinds: d.reading.kinds, boxes: d.drawn.boxes.slice(0, 40).map((b) => `${b.name}: ${b.description}`.slice(0, 120)) }));
  const platformPrompt = `${RULES}\n\nThis is the platform map across repos: one box per repo (set repo to its exact name: ${repoNames.join(', ')}), and boxes for outside systems and people the links show (set repo to ""). A repo box cites "repo:<its name>". A line cites the link facts (x1, x2, …) that join its two repos; summarise many links of one kind into one line, naming the main areas.\n\nEach repo's own map (for naming only):\n${JSON.stringify(summary)}\n\nLinks between repos, found by code (one per line):\n${links.map((l) => JSON.stringify(l)).join('\n')}\n`;
  tell({ repo: 'platform', stage: 'drawing' });
  /** @type {AnswerResult} */
  const p = drawn.length ? await agent.answer({ prompt: platformPrompt, schema: drawingSchema(true), model, signal }) : { error: 'No repo was drawn.', ms: 0 };
  if (p.cost) costs.push(p.cost);
  if (p.stopped || signal?.aborted) { tell({ repo: 'platform', stage: 'cancelled' }); return { state: null, report: report(), cancelled: true }; }
  /** @type {any} */
  const value = p.value || { boxes: drawn.map((d) => ({ id: d.reading.repo, name: d.reading.repo, kind: 'library', description: d.reading.kinds.join(', '), facts: [`repo:${d.reading.repo}`], repo: d.reading.repo })), lines: [] };
  for (const b of value.boxes || []) if (!repoNames.includes(b.repo)) delete b.repo;
  // a repo box cites its repo: only the repos that were drawn are facts it may cite
  const linkMap = new Map([...links.map((l) => /** @type {[string, Fact]} */ ([l.id, l])), ...repoNames.map((n) => /** @type {[string, Fact]} */ ([`repo:${n}`, { id: `repo:${n}`, kind: 'repo', at: 'repo', fromRepo: n, toRepo: n }]))]);
  platform = checkDrawing(value, linkMap);
  tell({ repo: 'platform', stage: p.value ? 'done' : 'failed', ...(p.error ? { error: p.error } : {}), boxes: platform.boxes.length });
  // the facts and links behind the map, kept beside it for tracing a request (system-trace.js)
  const store = { readings: readings.map((r) => ({ repo: r.repo, facts: r.facts })), links };
  return { state: systemState(platform, linkMap, drawn), report: report(), cancelled: false, store };
}
