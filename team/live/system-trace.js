// "Trace a request" on a system map box: code follows the facts the map was drawn from, hop by hop, and the hops become
// a sequence on the box. No model is asked and no hop is drawn without a fact: a call to a route another repo serves
// (the linker's calls_route), a function invoked or reached by name (reaches_function), a resource another repo
// deploys (uses_resource), what a function's role may touch (its `may`), and what a queue, stream or schedule
// triggers. A hop into a repo the asker may not read is only "A private repo", and the trace stops there.

import { PRIVATE_REPO } from './sharing.js';

/** @typedef {import('./system-facts.js').Fact} Fact */
/** @typedef {{ readings: { repo: string, facts: Fact[] }[], links: Fact[] }} FactStore */
/** @typedef {{ from: string, to: string, label: string }} Step */

const MAX_STEPS = 40;
const lidOf = (/** @type {Fact} */ f) => String(f.at || '').split('#')[1] || '';

/**
 * The steps a request takes from a box's facts, with the repos at each end of every step.
 * @param {string} repo the box's repo @param {string[]} start the ids of the box's facts in that repo
 * @param {FactStore} store @param {Set<string>} [hidden] repos the asker may not read
 * @returns {{ steps: Step[], repos: [string, string][] }}
 */
export function traceFrom(repo, start, store, hidden = new Set()) {
  /** @type {Map<string, { repo: string, f: Fact }>} */
  const byRef = new Map();
  /** @type {Map<string, Map<string, Fact>>} */
  const byLid = new Map();
  for (const r of store.readings || []) {
    const lids = new Map();
    for (const f of r.facts || []) { byRef.set(`${r.repo}:${f.id}`, { repo: r.repo, f }); if (lidOf(f)) lids.set(lidOf(f), f); }
    byLid.set(r.repo, lids);
  }
  /** @type {Map<string, Fact[]>} */
  const out = new Map();
  for (const l of store.links || []) if (typeof l.from === 'string') { if (!out.has(l.from)) out.set(l.from, []); out.get(l.from)?.push(l); }
  /** what a fact is called in a step: a function or resource by its name, a call by the repo making it */
  const who = (/** @type {string} */ r, /** @type {Fact} */ f) => hidden.has(r) ? PRIVATE_REPO
    : String(f.kind === 'api_call' ? r : f.name || f.function_name || f.logical_id || lidOf(f) || f.kind).replace(/^['"]|['"]$/g, '').slice(0, 40);

  /** @type {Step[]} */
  const steps = [];
  /** @type {[string, string][]} */
  const repos = [];
  const seen = new Set(), queue = start.map((id) => `${repo}:${id}`);
  /** @param {string} fromRef @param {string} toRef @param {string} label */
  const step = (fromRef, toRef, label) => {
    const a = byRef.get(fromRef), b = byRef.get(toRef);
    if (!a || !b || steps.length >= MAX_STEPS) return;
    const dark = hidden.has(a.repo) || hidden.has(b.repo);
    steps.push({ from: who(a.repo, a.f), to: who(b.repo, b.f), label: dark ? 'A private step' : label.slice(0, 80) });
    repos.push([a.repo, b.repo]);
    // past a repo they may not read, the trace says no more
    if (!hidden.has(b.repo)) queue.push(toRef);
  };
  while (queue.length && steps.length < MAX_STEPS) {
    const ref = /** @type {string} */ (queue.shift());
    if (seen.has(ref)) continue;
    seen.add(ref);
    const here = byRef.get(ref); if (!here) continue;
    const { repo: r, f } = here, lids = byLid.get(r) || new Map();
    // across repos, as the linker found
    for (const l of out.get(ref) || []) {
      const label = l.kind === 'calls_route' ? String(l.route) : l.kind === 'reaches_function' ? (l.via === 'route' ? 'routes to' : 'invokes')
        : l.kind === 'uses_resource' ? `uses ${l.resourceKind || 'resource'}` : String(l.kind);
      step(ref, String(l.to), label);
    }
    // within the repo: what a function's role may touch
    if (f.kind === 'function') for (const m of f.may || []) for (const on of m.on || []) {
      const res = lids.get(on); if (res && res !== f) step(ref, `${r}:${res.id}`, (m.services || []).join(', ') || 'uses');
    }
    // what a queue, stream or table's events, or a schedule, set off
    const lid = lidOf(f);
    for (const e of (store.readings.find((x) => x.repo === r)?.facts || [])) {
      if (e.kind === 'event_source' && lid && (e.from || []).includes(lid)) for (const fn of e.functions || []) { const t = lids.get(fn); if (t) step(ref, `${r}:${t.id}`, 'triggers'); }
      if ((e.kind === 'schedule' || e.kind === 'user_pool') && e === f) for (const t of e.targets || []) { const g = lids.get(t); if (g) step(ref, `${r}:${g.id}`, 'triggers'); }
    }
  }
  return { steps, repos };
}

/**
 * A trace as the sequence diagram a box opens into.
 * @param {string} title @param {Step[]} steps
 */
export const traceDiagram = (title, steps) => ({ kind: 'sequence', title: `Trace: ${title}`.slice(0, 80), items: steps.map((s) => ({ from: s.from, to: s.to, label: s.label })) });
