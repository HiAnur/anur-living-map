// Links between the repos of a system, found by code from their facts (system-facts.js): no model. A link cites the
// facts on each side as `<repo>:<fact id>`, so a platform map's lines can cite it and code can check that each cited
// fact involves both ends.
//
//   calls_route        an app's backend call, and the function whose route serves it
//   reaches_function   a route or an invoke by name, and the repo that deploys a function by that name
//   uses_resource      code naming a table, queue, topic, bucket or state machine another repo deploys
//   calls_outside      an app's call to a full address: a service outside the system

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */
/** @typedef {{ repo: string, facts: Fact[] }} Reading */

const norm = (/** @type {string} */ route) => route.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
const RESOURCE = new Set(['table', 'queue', 'topic', 'bucket', 'state_machine', 'stream']);

/**
 * @param {Reading[]} readings one per repo
 * @returns {{ links: Fact[], unmatched: { repo: string, fact: string, call: string }[] }}
 */
export function linkRepos(readings) {
  /** @type {Fact[]} */
  const links = [];
  /** @param {string} kind @param {Record<string, any>} said */
  const add = (kind, said) => links.push({ id: `x${links.length + 1}`, kind, at: 'links', ...said });
  const ref = (/** @type {Reading} */ r, /** @type {Fact} */ f) => `${r.repo}:${f.id}`;

  // routes served, by method and normalised path, in every repo
  /** @type {Map<string, { r: Reading, f: Fact }[]>} */
  const served = new Map();
  // functions by deployed name: a CloudFormation function's name, or a Python construct's literal function_name
  /** @type {Map<string, { r: Reading, f: Fact }[]>} */
  const deployed = new Map();
  /** @type {Map<string, { r: Reading, f: Fact }[]>} */
  const resources = new Map();
  for (const r of readings) for (const f of r.facts) {
    if (f.kind === 'function' || f.kind === 'outside_function') for (const route of f.routes || []) {
      const k = norm(route); if (!served.has(k)) served.set(k, []); served.get(k)?.push({ r, f });
    }
    const name = f.kind === 'function' ? f.name : f.kind === 'construct' && /^['"][A-Za-z0-9_-]+['"]$/.test(f.function_name || '') ? String(f.function_name).slice(1, -1) : null;
    if (name) { if (!deployed.has(name)) deployed.set(name, []); deployed.get(name)?.push({ r, f }); }
    if (RESOURCE.has(f.kind) && typeof f.name === 'string' && f.name.length >= 6) { if (!resources.has(f.name)) resources.set(f.name, []); resources.get(f.name)?.push({ r, f }); }
  }

  /** @type {{ repo: string, fact: string, call: string }[]} */
  const unmatched = [];
  for (const r of readings) for (const f of r.facts) {
    if (f.kind === 'api_call') {
      const key = `${f.method} ${norm(f.path)}`;
      // a call to a full address goes to a service outside the system, not to one of its routes
      if (/^https?:\/\//.test(f.path)) { add('calls_outside', { url: f.path.replace(/\{\}/g, '*'), from: ref(r, f), fromRepo: r.repo }); continue; }
      const hits = (served.get(key) || []).filter((h) => h.r !== r);
      if (!hits.length) { unmatched.push({ repo: r.repo, fact: f.id, call: key }); continue; }
      for (const h of hits) add('calls_route', { route: key, from: ref(r, f), to: ref(h.r, h.f), fromRepo: r.repo, toRepo: h.r.repo });
    }
    // a route to a function another repo deploys, by the name in its ARN
    if (f.kind === 'outside_function') for (const h of (deployed.get(f.name) || []).filter((h) => h.r !== r)) {
      add('reaches_function', { function: f.name, via: 'route', from: ref(r, f), to: ref(h.r, h.f), fromRepo: r.repo, toRepo: h.r.repo });
    }
    // a function invoked by name from code
    if (f.kind === 'invokes_by_name') for (const n of f.names) for (const h of (deployed.get(n) || []).filter((h) => h.r !== r)) {
      add('reaches_function', { function: n, via: 'invoke', from: ref(r, f), to: ref(h.r, h.f), fromRepo: r.repo, toRepo: h.r.repo });
    }
    // a resource another repo deploys, named as a literal in this repo's calls, constructs or settings
    if (['aws_call', 'construct', 'function', 'env_read'].includes(f.kind)) {
      const said = JSON.stringify(f);
      for (const [name, owners] of resources) {
        if (!said.includes(`'${name}'`) && !said.includes(`\\"${name}\\"`) && !said.includes(`"${name}"`)) continue;
        for (const h of owners.filter((h) => h.r !== r)) add('uses_resource', { resource: name, resourceKind: h.f.kind, from: ref(r, f), to: ref(h.r, h.f), fromRepo: r.repo, toRepo: h.r.repo });
      }
    }
  }
  return { links, unmatched };
}
