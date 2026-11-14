// You on this Mac: Settings, where you see and change the name you go by, and the optional sign-in with Google,
// through Living Map login, which adds your Google email and picture. Nothing here stands between you and your
// maps: a page on this Mac is you already (fromThisMac in access.js). Each route answers with the response, and
// true when it answered.
import { fromThisMac, LOCAL_HOST } from './access.js';
import { jsonBody } from './request.js';

/**
 * @param {{ users: any, googleFinish: Function, googleOn: () => any, googleStart: Function, page: Function,
 *   PORT: number, roleOf: (who: string) => string }} deps
 */
export function signInRoutes({ users, googleFinish, googleOn, googleStart, page, PORT, roleOf }) {
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any) => any} json */
  const answer = async (req, res, url, who, json) => {
    // A change to who you are comes only from this map's own pages, posted as JSON: another site the browser has
    // open can neither send JSON here without asking first nor name this page as its origin.
    const fromHere = () => fromThisMac(req) && req.headers.origin === `http://${req.headers.host}` && String(req.headers['content-type'] || '').startsWith('application/json');
    const refuse = () => json(403, { error: 'Open Living Map on this Mac to change this.' });
    const back = (/** @type {string} */ error) => res.writeHead(302, { location: `/settings?error=${encodeURIComponent(error)}` }).end();
    // the sign-in page of earlier versions: Google sign-in lives in Settings now, and nothing asks you to sign in
    if (url.pathname === '/login' || url.pathname === '/login.html') {
      const error = url.searchParams.get('error');
      return res.writeHead(302, { location: error ? `/settings?error=${encodeURIComponent(error)}` : '/settings' }).end();
    }
    // Sign in with Google, through Living Map login (google.js); it comes back to this map's own address
    if (url.pathname === '/auth/google' && req.method === 'GET') {
      if (!who) return refuse();
      if (!googleOn()) return back('Google sign-in is not set up on this map.');
      const host = LOCAL_HOST.test(req.headers.host || '') ? req.headers.host : `localhost:${PORT}`;
      const next = url.searchParams.get('next') || '/settings';
      return res.writeHead(302, { location: googleStart(`http://${host}`, next.startsWith('/') && !next.startsWith('//') ? next : '/settings') }).end();
    }
    // Only this server can trade the code Google's sign-in comes back with, for a sign-in it started (google.js).
    // A Google address on the login's list comes back under the name the list keeps for it.
    if (url.pathname === '/auth/done' && req.method === 'GET') {
      if (!LOCAL_HOST.test(req.headers.host || '')) return refuse();
      let got; try { got = await googleFinish(url.searchParams); } catch (/** @type {any} */ e) { return back(e.message); }
      users.signInGoogle(got);
      return res.writeHead(302, { location: got.next }).end();
    }
    if (url.pathname === '/settings' && req.method === 'GET') return who ? page(res, 'settings.html', who) : refuse();
    // you, as Settings and the Share dialog read it: your name, your role, and the Google email you signed in with
    // ('' when none), which publishing a map online needs
    if (url.pathname === '/api/me' && req.method === 'GET') {
      if (!who) return refuse();
      return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ name: who, role: roleOf(who), googleEmail: users.googleEmail(), google: !!googleOn(), picture: users.pictureOf(who) }));
    }
    if (url.pathname === '/api/me' && req.method === 'POST') {
      if (!fromHere()) return refuse();
      const /** @type {any} */ a = await jsonBody(req, {});
      const got = users.rename(a.name);
      return 'name' in got ? json(200, { name: got.name }) : json(400, { error: got.error });
    }
    // signing out of Google forgets its email and picture; you stay on your maps
    if (url.pathname === '/api/google/signout' && req.method === 'POST') {
      if (!fromHere()) return refuse();
      users.signOutGoogle();
      return json(200, {});
    }
    return false;
  };
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any) => any} json @returns {Promise<boolean>} */
  return async (req, res, url, who, json) => (await answer(req, res, url, who, json)) !== false;
}
