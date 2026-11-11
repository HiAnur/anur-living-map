// A map's sharing and access, at <map address>/api/...: the cloud copy, the share link, and who is a member.
// Each answers only after the map's own checks in openMap; true when the path was one of them.
import { changeAccess } from './access.js';
import { jsonBody } from './request.js';
import { changeSharing } from './sharing.js';

/**
 * @param {{ getState: () => any, cloud: any, save: () => void, push: () => void, cursors: Record<string, any>,
 *   clients: Set<any>, viewers: Map<any, any>, send: (res: any, ev: any, data: any) => void, here: () => void,
 *   holdsPrivate?: () => boolean }} deps `holdsPrivate`: a system map holds a repo that is private on GitHub
 */
export function shareRoutes({ getState, cloud, save, push, cursors, clients, viewers, send, here, holdsPrivate = () => false }) {
  /** @param {any} req @param {any} res @param {string} p @param {{ who: any, role: any, deny: () => boolean }} asker */
  return async (req, res, p, { who, role, deny }) => {
  if (p === '/api/cloud' && req.method === 'GET') {
    if (role !== 'owner') return deny();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(cloud?.status() || { configured: false })); return true;
  }
  if (p === '/api/cloud/delete' && req.method === 'POST') {
    if (role !== 'owner' || !who || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return deny();
    let a = await jsonBody(req, undefined);
    if (a?.confirm !== true) return deny();
    try { await cloud?.remove(); }
    catch (/** @type {any} */ e) { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message })); return true; }
    changeSharing(getState(), who, 'restricted'); save(); push();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...getState().linkSharing, cloud: cloud?.status() || { configured: false } })); return true;
  }
  if (p === '/api/sharing' && req.method === 'POST') {
    if (!who || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return deny();
    let a = await jsonBody(req, undefined);
    if (role !== 'owner' || !['view','edit','restricted'].includes(a?.mode)) return deny();
    if (cloud?.status().configured && (a.publish === true || cloud.status().published)) {
      // the online copy is the whole map, for anyone with its link: a private repo's contents never go there
      if (holdsPrivate()) { res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This system map holds private repos, so it can\'t go online: its link would show their contents to anyone.' })); return true; }
      try { await cloud.publish(a.mode); }
      catch (/** @type {any} */ e) { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message })); return true; }
    }
    if (!changeSharing(getState(), who, a?.mode)) return deny();
    save(); push();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...getState().linkSharing, cloud: cloud?.status() })); return true;
  }
  if (p === '/api/access' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (!who || origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return true; }
    /** @type {any} */ let a = await jsonBody(req, {});
    if (!a || typeof a !== 'object' || Array.isArray(a)) { res.writeHead(400).end('Invalid access change'); return true; }
    if (!changeAccess(getState(), who, a.person, a.restore === true)) { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Only an owner can remove or restore a member. Owners keep their access.' })); return true; }
    save();
    if (!a.restore) {
      delete cursors[a.person];
      for (const r of clients) if (viewers.get(r) === a.person) { send(r, 'access-removed', {}); clients.delete(r); viewers.delete(r); r.end(); }
    }
    push(); here();
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}'); return true;
  }
    return false;
  };
}
