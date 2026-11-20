// The routes a Node server in JavaScript or TypeScript serves, read from its source with nothing run, so the
// cross-repo linker can match another repo's calls to them: Express-style `app.get('/path', …)` (on `app`,
// `router`, `server`, `fastify` or `hono`), and a plain `http` handler's `url.pathname === '/path'` or
// `url.pathname.startsWith('/prefix')` checks, with the `req.method` the same line asks for (any method when none).
// A prefix serves every path under it: `POST /api/meetings/*`. One fact per file. Part of drawing a system map from
// code: see system-facts.js.
import fs from 'node:fs';
import path from 'node:path';

import { blankComments } from './system-facts-ts.js';

/** @typedef {import('./system-facts.js').Fact} Fact */

const MAX_FILE = 2 * 1024 * 1024, MAX_FILES = 3000, MAX_ROUTES = 200;
const SOURCE = /\.(m?js|cjs|ts|mts)$/;
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|cdk\.out|vendor|public)\/|\.d\.ts$|\.min\.js$/;
const EXPRESS = /\b(app|router|server|fastify|hono)\.(get|post|put|delete|patch|all)\(\s*(['"`])(\/[^'"`]*)\3/g;
const EXACT = /\bpathname\s*===?\s*(['"`])(\/[^'"`$]*)\1/g;
const PREFIX = /(!?)\s*\b\w+\.pathname\.startsWith\(\s*(['"`])(\/[^'"`$]+)\2\s*\)/g;
const METHOD = /\b(?:req|request)\.method\s*===?\s*['"]([A-Z]+)['"]/;
/** @param {string} root @param {string} f */
const text = (root, f) => { try { const p = path.join(root, f); return fs.statSync(p).size > MAX_FILE ? '' : fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const lineAt = (/** @type {string} */ s, /** @type {number} */ i) => s.slice(0, i).split('\n').length;
/** Express's `:id` is the `{id}` the linker compares. @param {string} p */
const params = (p) => p.replace(/:(\w+)\??/g, '{$1}');

/**
 * Every server route in a repo, from its files (tests already left out).
 * @param {string} root @param {string[]} files @returns {Fact[]}
 */
export function routeFacts(root, files) {
  /** @type {Fact[]} */
  const out = [];
  for (const f of files.filter((x) => SOURCE.test(x) && !SKIP.test(x)).slice(0, MAX_FILES)) {
    const raw = text(root, f);
    if (!/pathname|\.(get|post|put|delete|patch|all)\(/.test(raw)) continue;
    const s = blankComments(raw), lines = s.split('\n');
    /** @type {string[]} */
    const routes = [];
    let first = 0;
    /** @param {string} route @param {number} i */
    const add = (route, i) => { if (!routes.includes(route) && routes.length < MAX_ROUTES) { routes.push(route); first = first ? Math.min(first, lineAt(s, i)) : lineAt(s, i); } };
    for (const m of s.matchAll(EXPRESS)) add(`${m[2] === 'all' ? 'ANY' : m[2].toUpperCase()} ${params(m[4])}`, m.index || 0);
    // a plain handler: only in a file that looks at the request's method, so a page script's own location checks are not routes
    if (METHOD.test(s)) {
      const methodOn = (/** @type {number} */ i) => METHOD.exec(lines[lineAt(s, i) - 1] || '')?.[1];
      for (const m of s.matchAll(EXACT)) add(`${methodOn(m.index || 0) || 'ANY'} ${m[2]}`, m.index || 0);
      // a prefix serves a route only when it is asked for with a method, and is more than one folder deep (`/api/` alone guards, it does not serve)
      for (const m of s.matchAll(PREFIX)) {
        const method = methodOn(m.index || 0);
        if (m[1] || !method || m[3].split('/').filter(Boolean).length < 2) continue;
        add(`${method} ${m[3].replace(/\/+$/, '')}/*`, m.index || 0);
      }
    }
    if (routes.length) out.push({ id: '', kind: 'server_routes', at: `${f}:${first}`, name: f, module: f, routes });
  }
  return out;
}
