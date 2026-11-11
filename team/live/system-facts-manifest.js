// Facts from a repo's manifests, read as text with nothing run: each package.json (its name, workspaces and main
// dependencies), pyproject.toml and requirements files, Dockerfiles (base image, ports, command), compose files (each
// service, its image or build, ports and what it depends on) and OpenAPI or Swagger specs (the routes they serve, which
// the cross-repo linker matches to calls from other repos). YAML is read only as far as those files are written
// in practice: keys by indentation, scalars, inline and dashed lists.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('./system-facts.js').Fact} Fact */

const MAX_DEPS = 30, MAX_ROUTES = 200, MAX_FILE = 2 * 1024 * 1024;
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
const skip = (/** @type {string} */ f) => /(^|\/)(node_modules|vendor|dist|build|cdk\.out|\.venv|venv|__pycache__)\//.test(f);
/** @param {string} root @param {string} f */
const text = (root, f) => { try { const p = path.join(root, f); return fs.statSync(p).size > MAX_FILE ? '' : fs.readFileSync(p, 'utf8'); } catch { return ''; } };

/**
 * Lines of a YAML file as indent and text, with comments, blank lines and document markers dropped.
 * @param {string} src @returns {{ indent: number, line: string }[]}
 */
function yamlLines(src) {
  return src.split('\n').map((l) => l.replace(/\s+#.*$/, '').replace(/\s+$/, '')).filter((l) => l.trim() && !l.trim().startsWith('#') && l.trim() !== '---')
    .map((l) => ({ indent: l.length - l.trimStart().length, line: l.trim() }));
}
const unquote = (/** @type {string} */ s) => s.replace(/^['"]|['"]$/g, '');
/** A YAML value written inline: `[a, b]`, a quoted or bare scalar. @param {string} v */
const inline = (v) => v.startsWith('[') ? v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean) : unquote(v);

/**
 * The keys directly under `parent` (a line index), with their inline values or the dashed list below them.
 * @param {{ indent: number, line: string }[]} ls @param {number} parent @returns {Map<string, { value: string | string[], at: number }>}
 */
function children(ls, parent) {
  /** @type {Map<string, { value: string | string[], at: number }>} */
  const out = new Map();
  const base = parent < 0 ? -1 : ls[parent].indent;
  let own = -1;
  for (let i = parent + 1; i < ls.length && ls[i].indent > base; i++) {
    if (own < 0) own = ls[i].indent;
    if (ls[i].indent !== own || ls[i].line.startsWith('- ')) continue;
    const m = /^("[^"]+"|'[^']+'|[^:]+):\s*(.*)$/.exec(ls[i].line); if (!m) continue;
    /** @type {string | string[]} */
    let value = m[2] ? inline(m[2]) : '';
    if (!m[2]) {
      const list = [];
      for (let j = i + 1; j < ls.length && ls[j].indent > own; j++) if (ls[j].line.startsWith('- ')) list.push(unquote(ls[j].line.slice(2).trim()));
      if (list.length) value = list;
    }
    out.set(unquote(m[1].trim()), { value, at: i });
  }
  return out;
}
/** The line index of a top-level key, or -1. @param {{ indent: number, line: string }[]} ls @param {string} key */
const topKey = (ls, key) => ls.findIndex((l) => l.indent === 0 && (l.line === `${key}:` || l.line.startsWith(`${key}: `)));
const list = (/** @type {unknown} */ v) => Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];

/** @param {string} root @param {string} f @returns {Fact | null} */
function packageJson(root, f) {
  let p; try { p = JSON.parse(text(root, f)); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  const deps = Object.keys({ ...(p.dependencies || {}) }).slice(0, MAX_DEPS);
  const ws = Array.isArray(p.workspaces) ? p.workspaces : Array.isArray(p.workspaces?.packages) ? p.workspaces.packages : [];
  return { id: '', kind: 'package', at: f, language: 'javascript', name: String(p.name || path.dirname(f)), dependencies: deps,
    ...(ws.length ? { workspaces: ws.map(String).slice(0, 40) } : {}), ...(p.description ? { description: String(p.description).slice(0, 200) } : {}) };
}

/** @param {string} root @param {string} f @returns {Fact | null} */
function pyproject(root, f) {
  const src = text(root, f);
  const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(src)?.[1];
  const block = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(src)?.[1] || '';
  const deps = [...block.matchAll(/["']([A-Za-z0-9_.-]+)/g)].map((m) => m[1]).slice(0, MAX_DEPS);
  return name || deps.length ? { id: '', kind: 'package', at: f, language: 'python', name: name || path.dirname(f), dependencies: deps } : null;
}

/** @param {string} root @param {string} f @returns {Fact | null} */
function requirements(root, f) {
  const deps = text(root, f).split('\n').map((l) => /^\s*([A-Za-z0-9_.-]+)/.exec(l.replace(/#.*/, ''))?.[1]).filter((d) => d && !d.startsWith('-')).slice(0, MAX_DEPS);
  return deps.length ? { id: '', kind: 'package', at: f, language: 'python', name: path.dirname(f) === '.' ? path.basename(root) : path.dirname(f), dependencies: /** @type {string[]} */ (deps) } : null;
}

/** @param {string} root @param {string} f @returns {Fact | null} */
function dockerfile(root, f) {
  const lines = text(root, f).split('\n').map((l) => l.trim());
  const from = lines.filter((l) => /^FROM\s/i.test(l)).map((l) => l.split(/\s+/)[1]).filter(Boolean);
  if (!from.length) return null;
  const expose = lines.filter((l) => /^EXPOSE\s/i.test(l)).flatMap((l) => l.split(/\s+/).slice(1));
  const run = lines.filter((l) => /^(CMD|ENTRYPOINT)\s/i.test(l)).at(-1)?.replace(/^\w+\s+/, '').slice(0, 200);
  return { id: '', kind: 'container', at: f, name: path.dirname(f) === '.' ? path.basename(root) : path.basename(path.dirname(f)), from: from.at(-1), ...(expose.length ? { expose } : {}), ...(run ? { runs: run } : {}) };
}

/** @param {string} root @param {string} f @returns {Fact[]} */
function compose(root, f) {
  const ls = yamlLines(text(root, f)), at = topKey(ls, 'services');
  if (at < 0) return [];
  return [...children(ls, at)].map(([name, { at: i }]) => {
    const keys = children(ls, i), get = (/** @type {string} */ k) => keys.get(k)?.value;
    const build = get('build');
    // depends_on is a list, or a map of names to conditions
    const dependsOn = Array.isArray(get('depends_on')) ? list(get('depends_on')) : keys.has('depends_on') ? [...children(ls, /** @type {any} */ (keys.get('depends_on')).at).keys()] : [];
    return { id: '', kind: 'compose_service', at: `${f}:${i + 1}`, name, ...(get('image') ? { image: String(get('image')) } : {}),
      ...(build ? { build: typeof build === 'string' ? build : 'yes' } : keys.has('build') ? { build: String(children(ls, /** @type {any} */ (keys.get('build')).at).get('context')?.value || '.') } : {}),
      ...(list(get('ports')).length ? { ports: list(get('ports')) } : {}), ...(dependsOn.length ? { depends_on: dependsOn } : {}) };
  });
}

/** Routes an OpenAPI or Swagger spec serves, as "METHOD /path" the linker compares. @param {string} root @param {string} f @returns {Fact | null} */
function apiSpec(root, f) {
  const src = text(root, f);
  if (!/["']?(openapi|swagger)["']?\s*:/.test(src)) return null;
  /** @type {string[]} */
  const routes = [];
  let title = '';
  if (f.endsWith('.json')) {
    let spec; try { spec = JSON.parse(src); } catch { return null; }
    title = String(spec?.info?.title || '');
    for (const [p, ops] of Object.entries(spec?.paths || {})) for (const m of Object.keys(ops || {})) if (METHODS.includes(m)) routes.push(`${m.toUpperCase()} ${p}`);
  } else {
    const ls = yamlLines(src), at = topKey(ls, 'paths');
    title = String(children(ls, topKey(ls, 'info')).get('title')?.value || '');
    if (at >= 0) for (const [p, { at: i }] of children(ls, at)) for (const m of children(ls, i).keys()) if (METHODS.includes(m)) routes.push(`${m.toUpperCase()} ${p}`);
  }
  return routes.length ? { id: '', kind: 'api_spec', at: f, name: title || path.basename(f), routes: routes.slice(0, MAX_ROUTES) } : null;
}

/**
 * Every manifest fact in a repo, from its tracked files.
 * @param {string} root @param {string[]} files @returns {Fact[]}
 */
export function manifestFacts(root, files) {
  /** @type {(Fact | null)[]} */
  const out = [];
  for (const f of files) {
    if (skip(f)) continue;
    const base = path.basename(f);
    if (base === 'package.json') out.push(packageJson(root, f));
    else if (base === 'pyproject.toml') out.push(pyproject(root, f));
    else if (/^requirements[\w.-]*\.txt$/.test(base)) out.push(requirements(root, f));
    else if (/^Dockerfile([.-][\w.-]+)?$/.test(base)) out.push(dockerfile(root, f));
    else if (/^(docker-)?compose[\w.-]*\.ya?ml$/.test(base)) out.push(...compose(root, f));
    else if (/^(openapi|swagger)[\w.-]*\.(json|ya?ml)$/i.test(base)) out.push(apiSpec(root, f));
  }
  return /** @type {Fact[]} */ (out.filter(Boolean));
}
