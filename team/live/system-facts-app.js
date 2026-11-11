// Facts about a TypeScript or JavaScript app (Expo, React Native, React), read from its source by code with no model
// and nothing run: its screens from the route folders, every backend call (method, path, the function it is in),
// its state slices, the outside SDKs each part imports, and the settings it reads. Also the backend an Amplify
// project declares (`amplify/backend/backend-config.json`). Part of drawing a system map from code: see
// system-facts.js.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */

const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;
const SKIP = /(^|\/)(node_modules|dist|build|\.expo|coverage|__tests__|__mocks__)(\/|$)|\.(test|spec|d)\.(ts|tsx|js)$/;
const CALL = /\b(get|post|put|del|patch)\(\{\s*apiName:\s*([A-Za-z_.'"]+)[\s\S]{0,200}?path:\s*([`'"])(.+?)\3/g;
const FETCH = /\b(fetch|axios\.(get|post|put|delete|patch))\(\s*([`'"])(.+?)\3/g;

/**
 * The app facts in a repo, or [] when it is not an app.
 * @param {string} root @param {string[]} files the repo's files, relative to it
 * @returns {Fact[]}
 */
export function appFacts(root, files) {
  const pkg = readJson(path.join(root, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const isApp = ['expo', 'react-native', 'react', 'next'].some((d) => d in deps);
  if (!isApp) return [];
  /** @type {Fact[]} */
  const facts = [];
  /** @param {string} kind @param {string} at @param {Record<string, any>} said */
  const add = (kind, at, said) => facts.push({ id: '', kind, at, ...said });
  const src = files.filter((f) => SOURCE.test(f) && !SKIP.test(f));
  // screens: expo-router and Next files under app/ (or pages/), grouped by folder
  /** @type {Map<string, string[]>} */
  const screens = new Map();
  for (const f of src) {
    const m = f.match(/^(app|pages|src\/app)\/(.+)\.(tsx|jsx|ts|js)$/);
    if (!m || path.basename(f).startsWith('_')) continue;
    const route = ('/' + m[2].replace(/\(.*?\)\/?/g, '')).replace(/\/index$/, '') || '/';
    const folder = path.dirname(f);
    if (!screens.has(folder)) screens.set(folder, []);
    screens.get(folder)?.push(route);
  }
  for (const [folder, routes] of [...screens].sort()) add('screens', `${folder}/`, { folder, routes: routes.sort().slice(0, 30) });
  /** @type {Map<string, Set<string>>} */
  const sdks = new Map();
  /** @type {Map<string, Fact>} */
  const calls = new Map();
  const envSeen = new Set();
  for (const f of src) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const line = (/** @type {number} */ i) => text.slice(0, i).split('\n').length;
    /** @param {number} i */
    const fnBefore = (i) => [...text.slice(Math.max(0, i - 3000), i).matchAll(/(?:export\s+)?(?:const|function|async function)\s+([A-Za-z0-9_]+)/g)].pop()?.[1] || '';
    const record = (/** @type {string} */ method, /** @type {string} */ raw, /** @type {string} */ api, /** @type {number} */ i) => {
      const p = raw.replace(/\$\{[^}]+\}/g, '{}').split('?')[0];
      const key = `${method} ${p}`;
      const at = `${f}:${line(i)}`;
      const had = calls.get(key);
      if (had) { (had.also_at ||= []).length < 10 && had.also_at.push(at); return; }
      calls.set(key, { id: '', kind: 'api_call', at, module: f, method, path: p, api, in_function: fnBefore(i) });
    };
    for (const m of text.matchAll(CALL)) record(m[1] === 'del' ? 'DELETE' : m[1].toUpperCase(), m[4], m[2], m.index || 0);
    for (const m of text.matchAll(FETCH)) if (/^(https?:\/\/|\/)/.test(m[4])) record(m[2] ? m[2].toUpperCase() : 'GET', m[4], 'fetch', m.index || 0);
    for (const m of text.matchAll(/createSlice\(\{\s*name:\s*['"]([^'"]+)/g)) add('state_slice', `${f}:${line(m.index || 0)}`, { name: m[1], module: f });
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!envSeen.has(m[1])) { envSeen.add(m[1]); add('env_read', `${f}:${line(m.index || 0)}`, { name: m[1], module: f }); }
    const folder = f.split('/').slice(0, 2).join('/');
    for (const m of text.matchAll(/from\s+['"]((@[a-z0-9-]+\/)?[a-z0-9][a-z0-9.-]*)/g)) {
      const pkgName = m[1];
      if (!(pkgName in deps) || /^(react|react-native|expo-router)$/.test(pkgName)) continue;
      if (!sdks.has(folder)) sdks.set(folder, new Set());
      sdks.get(folder)?.add(pkgName);
    }
  }
  facts.push(...calls.values());
  for (const [folder, pkgs] of [...sdks].sort()) add('imports_sdks', `${folder}/`, { folder, packages: [...pkgs].sort().slice(0, 40) });
  return facts;
}

/**
 * What an Amplify project declares: its backend's categories and resources (auth, api, function, storage …).
 * @param {string} root @returns {Fact[]}
 */
export function amplifyFacts(root) {
  const config = readJson(path.join(root, 'amplify', 'backend', 'backend-config.json'));
  /** @type {Fact[]} */
  const facts = [];
  for (const [category, resources] of Object.entries(config || {})) {
    for (const [name, r] of Object.entries(/** @type {Record<string, any>} */ (resources || {}))) {
      facts.push({ id: '', kind: 'amplify_resource', at: 'amplify/backend/backend-config.json', category, name, service: r?.service,
        dependsOn: (r?.dependsOn || []).map((/** @type {any} */ d) => `${d.category}/${d.resourceName}`).slice(0, 12) });
    }
  }
  const envs = readJson(path.join(root, 'amplify', 'team-provider-info.json'));
  if (envs) facts.push({ id: '', kind: 'amplify_envs', at: 'amplify/team-provider-info.json', envs: Object.keys(envs) });
  return facts;
}

/** @param {string} file @returns {any} */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
