// Signing in at the server's own addresses: the sign-in page, Google through Living Map login, a password kept
// on this Mac or at Living Map login, the first password someone chooses, and signing out. Each route answers
// with the response, and true when it answered.
import { jsonBody } from './request.js';

/**
 * @param {{ users: any, MIN: number, googleFinish: Function, googleOn: () => any, googleStart: Function,
 *   passwordCheck: Function, page: Function, cookieOf: Function, PORT: number }} deps
 */
export function signInRoutes({ users, MIN, googleFinish, googleOn, googleStart, passwordCheck, page, cookieOf, PORT }) {
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any, cookie?: any) => any} json */
  const answer = async (req, res, url, who, json) => {
    const signIn = (/** @type {any} */ name) => json(200, { name }, `lm_session=${users.start(name)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${users.maxAge}`);
    if (url.pathname === '/login') { res.setHeader('cache-control', 'no-store'); return page(res, 'login.html', who); }
    // Sign in with Google, through Living Map login (google.js); it comes back to this map's own address
    const signInError = (/** @type {any} */ e) => res.writeHead(302, { location: `/login?error=${encodeURIComponent(e)}` }).end();
    if (url.pathname === '/auth/google' && req.method === 'GET') {
      if (!googleOn()) return signInError('Google sign-in is not set up on this map.');
      const host = /^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '') ? req.headers.host : `localhost:${PORT}`;
      const next = url.searchParams.get('next') || '/';
      return res.writeHead(302, { location: googleStart(`http://${host}`, next.startsWith('/') && !next.startsWith('//') ? next : '/') }).end();
    }
    if (url.pathname === '/auth/done' && req.method === 'GET') {
      let got; try { got = await googleFinish(url.searchParams); } catch (/** @type {any} */ e) { return signInError(e.message); }
      // one of this map's people only when the login's list says so (an address, not a name, proves who someone is);
      // anyone else is a guest under their Google name, never seated as a person who happens to share it
      const name = got.listed ? users.person(got.name) || got.name : users.person(got.name) ? `${got.name} (guest)` : got.name;
      return res.writeHead(302, { location: got.next, 'set-cookie': `lm_session=${users.start(name)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${users.maxAge}` }).end();
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      let /** @type {any} */ a = await jsonBody(req, {});
      const one = users.person(a.name);
      // a person with no password yet: the page asks them to choose one
      if (one && !users.has(one)) return json(409, { first: one, min: MIN });
      // a password this Mac keeps, else one kept at Living Map login (someone with no Google account)
      const name = one && users.has(one) ? users.check(a.name, a.password) : await passwordCheck(a.name, a.password);
      if (!name) { await new Promise((ok) => setTimeout(ok, 400)); return json(401, { error: one ? 'That password is not right.' : 'That name and password are not right.' }); }
      return signIn(name);
    }
    if (url.pathname === '/api/first' && req.method === 'POST') {
      let /** @type {any} */ a = await jsonBody(req, {});
      const one = users.person(a.name);
      if (!one) return json(400, { error: 'There is no one called that on this map.' });
      if (users.has(one)) return json(400, { error: `${one} already has a password. Sign in instead.` });
      const name = users.first(one, a.password);
      return name ? signIn(name) : json(400, { error: `Use at least ${MIN} characters.` });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      users.end(cookieOf(req, 'lm_session'));
      return res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'lm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }).end('{}');
    }
    return false;
  };
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any, cookie?: any) => any} json @returns {Promise<boolean>} */
  return async (req, res, url, who, json) => (await answer(req, res, url, who, json)) !== false;
}
