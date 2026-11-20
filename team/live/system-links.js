// Links between the repos of a system, found by code from their facts (system-facts.js): no model. A link cites the
// facts on each side as `<repo>:<fact id>`, so a platform map's lines can cite it and code can check that each cited
// fact involves both ends.
//
//   calls_route        an app's backend call, and the function whose route serves it
//   reaches_function   a route or an invoke by name, and the repo that deploys a function by that name
//   uses_resource      code naming a table, queue, topic, bucket or state machine another repo deploys
//   calls_outside      an app's call to a full address: a service outside the system
//   uses_package       a package fetched or depended on by name, and the repo whose manifest names that package
//   points_to_repo     an address naming a repo of the system on GitHub (a link, a file read from it), or its npm package

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */
/** @typedef {{ repo: string, facts: Fact[], github?: { owner: string, name: string } | null }} Reading */

const norm = (/** @type {string} */ route) => route.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
/** The repo on GitHub an address names, as `owner/name`. @param {string} url */
const githubRepoOf = (url) => {
  const m = /^https?:\/\/(?:github\.com|raw\.githubusercontent\.com|api\.github\.com\/repos)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
};
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
  // routes served under a prefix (`POST /api/meetings/*`), or for any method (`ANY /api/version`)
  /** @type {{ method: string, path: string, under: boolean, r: Reading, f: Fact }[]} */
  const loose = [];
  // npm packages by the name a repo's package.json gives them
  /** @type {Map<string, { r: Reading, f: Fact }[]>} */
  const packages = new Map();
  for (const r of readings) for (const f of r.facts) {
    // routes a function serves, an OpenAPI spec says the repo serves, or a Node server's code serves
    if (f.kind === 'function' || f.kind === 'outside_function' || f.kind === 'api_spec' || f.kind === 'server_routes') for (const route of f.routes || []) {
      const [method, p = ''] = String(route).split(' ');
      const under = p.endsWith('/*');
      if (method === 'ANY' || under) { loose.push({ method, path: norm(under ? p.slice(0, -2) : p), under, r, f }); continue; }
      const k = norm(route); if (!served.has(k)) served.set(k, []); served.get(k)?.push({ r, f });
    }
    if (f.kind === 'package' && f.language === 'javascript' && typeof f.name === 'string' && f.name.length >= 3) { if (!packages.has(f.name)) packages.set(f.name, []); packages.get(f.name)?.push({ r, f }); }
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
      const p = norm(f.path), wide = loose.filter((l) => l.r !== r && (l.method === 'ANY' || l.method === f.method) && (p === l.path || (l.under && p.startsWith(`${l.path}/`))));
      const hits = [...(served.get(key) || []).filter((h) => h.r !== r), ...wide.filter((w) => !(served.get(key) || []).some((h) => h.f === w.f))];
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
    // an npm package another repo's package.json names, fetched by a script here or depended on by this repo's own
    const wanted = f.kind === 'pulls_package' && f.registry === 'npm' ? [f.name] : f.kind === 'package' && f.language === 'javascript' ? f.dependencies || [] : [];
    for (const n of wanted) for (const h of (packages.get(n) || []).filter((h) => h.r !== r)) {
      add('uses_package', { package: n, from: ref(r, f), to: ref(h.r, h.f), fromRepo: r.repo, toRepo: h.r.repo });
    }
    // an address naming another repo of the system on GitHub, or its package on npm
    for (const url of f.kind === 'links_to' || f.kind === 'url' ? [...(f.urls || []), f.url].filter((u) => typeof u === 'string') : []) {
      const gh = githubRepoOf(url);
      const npm = /^https?:\/\/(?:www\.)?npmjs\.(?:com|org)\/package\/((?:@[\w.-]+\/)?[\w.-]+)/.exec(url)?.[1];
      for (const o of readings) {
        if (o === r || links.some((l) => l.kind === 'points_to_repo' && l.from === ref(r, f) && l.toRepo === o.repo)) continue;
        // GitHub names are not case-sensitive; a reading with no GitHub repo is matched by its folder's name
        const own = o.github ? `${o.github.owner}/${o.github.name}`.toLowerCase() : null;
        const byGithub = gh && (own ? own === gh.toLowerCase() : gh.split('/')[1].toLowerCase() === o.repo.toLowerCase());
        const pkg = npm ? (packages.get(npm) || []).find((h) => h.r === o) : null;
        if (byGithub || pkg) add('points_to_repo', { via: byGithub ? `GitHub ${gh}` : `npm ${npm}`, how: f.how || 'names', from: ref(r, f), ...(pkg ? { to: ref(o, pkg.f) } : {}), fromRepo: r.repo, toRepo: o.repo });
      }
    }
    // a resource another repo deploys, named as a literal in this repo's calls, constructs, settings or deploy scripts
    if (['aws_call', 'construct', 'function', 'env_read', 'deploy_target'].includes(f.kind)) {
      const said = JSON.stringify(f);
      for (const [name, owners] of resources) {
        if (!said.includes(`'${name}'`) && !said.includes(`\\"${name}\\"`) && !said.includes(`"${name}"`)) continue;
        for (const h of owners.filter((h) => h.r !== r)) add('uses_resource', { resource: name, resourceKind: h.f.kind, from: ref(r, f), to: ref(h.r, h.f), fromRepo: r.repo, toRepo: h.r.repo });
      }
    }
  }
  return { links, unmatched };
}
