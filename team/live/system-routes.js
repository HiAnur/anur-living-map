// A system map from code folders on this Mac, at the server's own /api/systemmap...: the repos in a folder to
// choose from, a new map drawn from the chosen ones, and Cancel and Retry while it draws. Only a person signed in
// on a page this Mac serves may use them, since they read folders on this Mac. Each route answers with the
// response, and true when it answered.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { jsonBody } from './request.js';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** A page this Mac serves asked, not another site or the online copy. @param {any} req */
const onThisMac = (req) => LOCAL.test(req.headers.host || '') && (req.method === 'GET'
  ? req.headers['sec-fetch-site'] === 'same-origin'
  : req.headers.origin === `http://${req.headers.host}` && String(req.headers['content-type'] || '').startsWith('application/json'));
/** The repos directly in a folder: each folder in it holding `.git`. @param {string} under */
export function reposIn(under) {
  let names = /** @type {string[]} */ ([]);
  try { names = fs.readdirSync(under).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b)); }
  catch { return null; } // not a folder this Mac can read: the answer says so
  return names.filter((n) => fs.existsSync(path.join(under, n, '.git'))).map((name) => ({ name, folder: path.join(under, name) }));
}
/** @param {{ maps: ReturnType<typeof import('./map-list.js').mapList>, PROJECT: string, home?: string }} deps */
export function systemRoutes({ maps, PROJECT, home = os.homedir() }) {
  /** Whether a folder may be drawn: a repo inside your home folder. @param {unknown} f */
  const drawable = (f) => typeof f === 'string' && path.isAbsolute(f) && path.resolve(f) === f && f.startsWith(home + path.sep) && fs.existsSync(path.join(f, '.git'));
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any) => any} json */
  const answer = async (req, res, url, who, json) => {
    if (!url.pathname.startsWith('/api/systemmap')) return false;
    if (!who) return json(401, { error: 'Sign in first.' });
    if (!onThisMac(req)) return json(403, { error: 'Open Living Map on this Mac to draw a system map from its folders.' });
    // the repos to choose from, in the folder asked for, or else the folder this server's own repo sits in
    if (url.pathname === '/api/systemmap/repos' && req.method === 'GET') {
      const fallback = PROJECT ? path.dirname(PROJECT) : fs.existsSync(path.join(home, 'workspace')) ? path.join(home, 'workspace') : home;
      const asked = String(url.searchParams.get('under') || '').replace(/^~(?=$|\/)/, home);
      const under = path.resolve(asked || fallback);
      if (under !== home && !under.startsWith(home + path.sep)) return json(400, { error: 'Choose a folder inside your home folder.' });
      const repos = reposIn(under);
      return repos ? json(200, { under, repos }) : json(404, { error: 'That folder could not be read.' });
    }
    if (url.pathname === '/api/systemmap' && req.method === 'POST') {
      const /** @type {any} */ a = await jsonBody(req, {});
      const folders = Array.isArray(a.folders) ? [...new Set(a.folders)] : [];
      if (!folders.length || folders.length > 40) return json(400, { error: 'Choose between 1 and 40 repos.' });
      const wrong = folders.find((f) => !drawable(f));
      if (wrong) return json(400, { error: `Not a repo inside your home folder: ${String(wrong).slice(0, 200)}` });
      const title = String(a.title || '').trim().slice(0, 80) || `${path.basename(path.dirname(folders[0]))} system`;
      const name = maps.freeName(title);
      maps.mapCalled(name).drawSystem({ title, folders, by: who });
      return json(200, { name, href: `/${name}/` });
    }
    const m = /^\/api\/systemmap\/(cancel|retry)$/.exec(url.pathname);
    if (m && req.method === 'POST') {
      const /** @type {any} */ a = await jsonBody(req, {});
      const name = String(a.name || '');
      if (!/^[a-z0-9-]+$/.test(name) || !maps.named.has(name)) return json(404, { error: 'That map is not on this Mac.' });
      const map = maps.mapCalled(name), drawing = map.snapshot().drawing;
      if (!drawing) return json(404, { error: 'That map is not drawn from code.' });
      if (drawing.by !== who && !map.canDelete(who)) return json(403, { error: 'Only whoever started the drawing, or the map\'s owner, can stop or retry it.' });
      const done = m[1] === 'cancel' ? map.cancelDrawing() : map.retryDrawing(who);
      return done ? json(200, { ok: true }) : json(409, { error: m[1] === 'cancel' ? 'It is not drawing.' : 'It is still drawing.' });
    }
    return json(404, { error: 'Not a system map route.' });
  };
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any) => any} json @returns {Promise<boolean>} */
  return async (req, res, url, who, json) => (await answer(req, res, url, who, json)) !== false;
}
