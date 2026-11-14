// A map's sharing and access, at <map address>/api/...: the cloud copy, the share link, and who is a member.
// Each answers only after the map's own checks in openMap; true when the path was one of them. The online copy
// belongs to a Google account: what changes it carries that account's ID token (googleOf), never sent to a page.
import { changeAccess, setEngineer } from './access.js';
import { jsonBody } from './request.js';
import { changeSharing } from './sharing.js';

/**
 * @param {{ getState: () => any, cloud: any, save: () => void, push: () => void, cursors: Record<string, any>,
 *   clients: Set<any>, viewers: Map<any, any>, send: (res: any, ev: any, data: any) => void, here: () => void,
 *   holdsPrivate?: () => boolean, googleOf?: (req: any) => { email: string, name: string, idToken: string, needs: string } }} deps
 * `holdsPrivate`: a system map holds a repo that is private on GitHub; `googleOf`: the Google account the asker
 * publishes as (googleIdentity in google.js)
 */
export function shareRoutes({ getState, cloud, save, push, cursors, clients, viewers, send, here, holdsPrivate = () => false,
  googleOf = () => ({ email: '', name: '', idToken: '', needs: 'signin' }) }) {
  /** @param {any} res @param {any} e a cloud error, with `needs` when Google must be asked again */
  const failed = (res, e) => { res.writeHead(e.needs ? 401 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message, ...(e.needs ? { needs: e.needs } : {}) })); return true; };
  // what Share shows of the Google account: its address and name, and whether it must sign in (again)
  /** @param {any} req */
  const googleFor = (req) => { const g = googleOf(req); return { email: g.email, name: g.name, ready: !!g.idToken, needs: g.needs }; };
  /** @param {any} req @param {any} res @param {string} p @param {{ who: any, role: any, deny: () => boolean }} asker */
  return async (req, res, p, { who, role, deny }) => {
  if (p === '/api/cloud' && req.method === 'GET') {
    if (role !== 'owner') return deny();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ...(cloud?.status() || { configured: false }), google: googleFor(req) })); return true;
  }
  if (p === '/api/cloud/delete' && req.method === 'POST') {
    if (role !== 'owner' || !who || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return deny();
    let a = await jsonBody(req, undefined);
    if (a?.confirm !== true) return deny();
    try { await cloud?.remove(googleOf(req)); }
    catch (/** @type {any} */ e) { return failed(res, e); }
    changeSharing(getState(), who, 'restricted'); save(); push();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...getState().linkSharing, cloud: { ...(cloud?.status() || { configured: false }), google: googleFor(req) } })); return true;
  }
  if (p === '/api/sharing' && req.method === 'POST') {
    if (!who || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return deny();
    let a = await jsonBody(req, undefined);
    if (role !== 'owner' || !['view','edit','restricted'].includes(a?.mode)) return deny();
    if (cloud?.status().configured && (a.publish === true || cloud.status().published)) {
      // the online copy is the whole map, for anyone with its link: a private repo's contents never go there
      if (holdsPrivate()) { res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This system map holds private repos, so it can\'t go online: its link would show their contents to anyone.' })); return true; }
      try { await cloud.publish(a.mode, googleOf(req)); }
      catch (/** @type {any} */ e) { return failed(res, e); }
    }
    if (!changeSharing(getState(), who, a?.mode)) return deny();
    save(); push();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...getState().linkSharing, cloud: cloud ? { ...cloud.status(), google: googleFor(req) } : undefined })); return true;
  }
  // who may open the online copy: a person by email with Can view or Can edit (role null removes them), whether
  // anyone with the link can view it, or {} to claim a copy published before Google sign-in. Only an owner, on this Mac.
  if (p === '/api/cloud/access' && req.method === 'POST') {
    if (role !== 'owner' || !who || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return deny();
    /** @type {any} */ const a = await jsonBody(req, undefined);
    if (!a || typeof a !== 'object' || Array.isArray(a)) return deny();
    /** @type {{ person?: { email: string, role: string | null }, linkView?: boolean }} */ const change = {};
    if (a.person !== undefined) change.person = { email: String(a.person?.email ?? '').slice(0, 254), role: a.person?.role ?? null };
    if (a.linkView !== undefined) change.linkView = a.linkView;
    let status;
    try { status = await cloud?.share(change, googleOf(req)); }
    catch (/** @type {any} */ e) { return failed(res, e); }
    if (!status) { res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Cloud sharing is not set up on this Mac.' })); return true; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ cloud: { ...status, google: googleFor(req) } })); return true;
  }
  if (p === '/api/access' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (!who || origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return true; }
    /** @type {any} */ let a = await jsonBody(req, {});
    if (!a || typeof a !== 'object' || Array.isArray(a)) { res.writeHead(400).end('Invalid access change'); return true; }
    // an Admin marks someone Engineer, or not: who, with whoever drew it, may redraw a system map
    if (typeof a.engineer === 'boolean') {
      if (!setEngineer(getState(), who, a.person, a.engineer)) { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Only an owner can make someone an Engineer.' })); return true; }
      save(); push();
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}'); return true;
    }
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
