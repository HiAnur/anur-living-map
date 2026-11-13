// A system map from code, at the server's own /api/systemmap...: your GitHub link and the repos it can read, a
// new map drawn from the chosen ones, and Cancel and Retry while it draws. A map may also be drawn from repos in
// folders on this Mac, by their paths. Only a person signed in on a page this Mac serves may use them, since they
// act with that person's GitHub link and read this Mac's folders. Each route answers with the response, and true
// when it answered.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isEngineer } from './access.js';
import { sharedGithub } from './github.js';
import { jsonBody } from './request.js';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** A page this Mac serves asked, not another site or the online copy. @param {any} req */
const onThisMac = (req) => LOCAL.test(req.headers.host || '') && (req.method === 'GET'
  ? req.headers['sec-fetch-site'] === 'same-origin'
  : req.headers.origin === `http://${req.headers.host}` && String(req.headers['content-type'] || '').startsWith('application/json'));
const GITHUB_NAME = /^[\w.-]+$/;
/** @param {{ maps: ReturnType<typeof import('./map-list.js').mapList>, home?: string, github?: () => ReturnType<typeof import('./github.js').github>,
 *   team?: () => any[] }} deps `team`: who may draw before any map makes them an Admin (the install's owner) */
export function systemRoutes({ maps, home = os.homedir(), github = sharedGithub, team = () => /** @type {any[]} */ ([]) }) {
  /**
   * Who may draw a system map, before any map of it exists: an Admin or Engineer of the team (`team`), or of any
   * map on this Mac, as `isEngineer` reads roles. Everyone else asks one of them.
   */
  const engineer = (/** @type {any} */ p) => p.role === 'Admin' || p.engineer === true || /\bengineer\b/i.test(String(p.role || ''));
  const engineers = () => [...new Set([...team(), ...maps.everyMap().flatMap(([, m]) => /** @type {any[]} */ (m.snapshot().people || []))].filter(engineer).map((p) => String(p.id)))];
  const mayDraw = (/** @type {string} */ who) => team().some((p) => p.id === who && engineer(p)) || maps.everyMap().some(([, m]) => isEngineer(m.snapshot(), who));
  /** Whether a folder may be drawn: a repo inside your home folder. @param {unknown} f */
  const drawable = (f) => typeof f === 'string' && path.isAbsolute(f) && path.resolve(f) === f && f.startsWith(home + path.sep) && fs.existsSync(path.join(f, '.git'));
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any) => any} json */
  const answer = async (req, res, url, who, json) => {
    if (!url.pathname.startsWith('/api/systemmap')) return false;
    if (!who) return json(401, { error: 'Sign in first.' });
    if (!onThisMac(req)) return json(403, { error: 'Open Living Map on this Mac to draw a system map.' });
    // your GitHub link: who you are there, or the code to type at github.com while linking; never the token
    if (url.pathname === '/api/systemmap/github' && req.method === 'GET') return json(200, github().status(who));
    if (url.pathname === '/api/systemmap/github/link' && req.method === 'POST') {
      try { return json(200, await github().link(who)); }
      catch (/** @type {any} */ e) { return json(e.status || 502, { error: e.status ? e.message : 'GitHub could not be reached.' }); }
    }
    if (url.pathname === '/api/systemmap/github/unlink' && req.method === 'POST') { github().unlink(who); return json(200, { ok: true }); }
    if (url.pathname === '/api/systemmap/github/repos' && req.method === 'GET') {
      try { return json(200, await github().repos(who)); }
      catch (/** @type {any} */ e) { return json(e.status || 502, { error: e.status ? e.message : 'GitHub could not be reached.' }); }
    }
    // whether you may draw a system map, and whom to ask when you may not
    if (url.pathname === '/api/systemmap/can' && req.method === 'GET') return json(200, { may: mayDraw(who), engineers: engineers().filter((e) => e !== who) });
    if (url.pathname === '/api/systemmap' && req.method === 'POST') {
      if (!mayDraw(who)) return json(403, { error: `Only an Engineer or Admin can draw a system map. Ask ${engineers().join(', ') || 'an Admin'}.` });
      const /** @type {any} */ a = await jsonBody(req, {});
      const folders = Array.isArray(a.folders) ? [...new Set(a.folders)] : [];
      const repos = (Array.isArray(a.repos) ? a.repos : []).map((/** @type {any} */ r) => ({ owner: String(r?.owner || ''), name: String(r?.name || '') }));
      if (!folders.length && !repos.length || folders.length + repos.length > 40) return json(400, { error: 'Choose between 1 and 40 repos.' });
      const wrong = folders.find((f) => !drawable(f));
      if (wrong) return json(400, { error: `Not a repo inside your home folder: ${String(wrong).slice(0, 200)}` });
      if (repos.some((/** @type {{ owner: string, name: string }} */ r) => !GITHUB_NAME.test(r.owner) || !GITHUB_NAME.test(r.name))) return json(400, { error: 'Not a GitHub repo name.' });
      if (repos.length && !github().status(who).linked) return json(401, { error: 'Link your GitHub account first.' });
      const title = String(a.title || '').trim().slice(0, 80) || `${folders.length ? path.basename(path.dirname(folders[0])) : repos[0].owner} system`;
      const name = maps.freeName(title);
      maps.mapCalled(name).drawSystem({ title, folders, repos, by: who });
      return json(200, { name, href: `/${name}/` });
    }
    const m = /^\/api\/systemmap\/(cancel|retry|apply|dismiss)$/.exec(url.pathname);
    if (m && req.method === 'POST') {
      const /** @type {any} */ a = await jsonBody(req, {});
      const name = String(a.name || '');
      if (!/^[a-z0-9-]+$/.test(name) || !maps.named.has(name)) return json(404, { error: 'That map is not on this Mac.' });
      const map = maps.mapCalled(name), drawing = map.snapshot().drawing;
      if (!drawing) return json(404, { error: 'That map is not drawn from code.' });
      if (!map.mayRedraw(who)) return json(403, { error: 'Only an Engineer of this map, or whoever drew it, can redraw it or stop its drawing.' });
      // a redraw's changes, reviewed: applied, or the map kept as it is
      if (m[1] === 'apply' || m[1] === 'dismiss') return (m[1] === 'apply' ? map.applyRedraw() : map.dropRedraw()) ? json(200, { ok: true }) : json(409, { error: 'No redraw is waiting for review.' });
      const done = m[1] === 'cancel' ? map.cancelDrawing() : map.retryDrawing(who);
      return done ? json(200, { ok: true }) : json(409, { error: m[1] === 'cancel' ? 'It is not drawing.' : 'It is still drawing.' });
    }
    return json(404, { error: 'Not a system map route.' });
  };
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any) => any} json @returns {Promise<boolean>} */
  return async (req, res, url, who, json) => (await answer(req, res, url, who, json)) !== false;
}
