// Signing in at the server's own addresses: the sign-in page, Google through Living Map login, a password kept
// on this Mac or at Living Map login, the owner's account on a new install, an invite the owner made and the
// account made from it, signing out, and Settings, which shows the signed-in person who they are here. Each route
// answers with the response, and true when it answered.
import { validEmail } from './recovery.js';
import { jsonBody } from './request.js';

const LOCAL = /^(localhost|127\.0\.0\.1):\d+$/;
/**
 * @param {{ users: any, MIN: number, googleFinish: Function, googleOn: () => any, googleStart: Function,
 *   passwordCheck: Function, page: Function, cookieOf: Function, PORT: number, recovery: any,
 *   roleOf: (who: string) => string, mailReady: () => boolean, resetCommand: string }} deps
 * `resetCommand`: what to run on this Mac for a link to choose a new password, the name after it
 */
export function signInRoutes({ users, MIN, googleFinish, googleOn, googleStart, passwordCheck, page, cookieOf, PORT, recovery, roleOf, mailReady, resetCommand }) {
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any, cookie?: any) => any} json */
  const answer = async (req, res, url, who, json) => {
    const signIn = (/** @type {any} */ name) => json(200, { name }, `lm_session=${users.start(name)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${users.maxAge}`);
    // What makes or opens an account comes only from this map's own pages: another site the browser has open
    // could otherwise post here and take the owner's account on a new install.
    const fromHere = () => LOCAL.test(req.headers.host || '') && req.headers.origin === `http://${req.headers.host}` && String(req.headers['content-type'] || '').startsWith('application/json');
    const refuse = () => json(403, { error: 'Open Living Map on this Mac to sign in.' });
    if (url.pathname === '/login') { res.setHeader('cache-control', 'no-store'); return page(res, 'login.html', who); }
    // what the sign-in page offers: creating the owner's account on a new install, email recovery where mail is set
    // up, else the command that prints a reset link
    if (url.pathname === '/api/signin' && req.method === 'GET') {
      if (!LOCAL.test(req.headers.host || '')) return refuse();
      return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ firstRun: users.firstRun(), mail: mailReady(), reset: resetCommand, min: MIN }));
    }
    // Sign in with Google, through Living Map login (google.js); it comes back to this map's own address
    const signInError = (/** @type {any} */ e) => res.writeHead(302, { location: `/login?error=${encodeURIComponent(e)}` }).end();
    if (url.pathname === '/auth/google' && req.method === 'GET') {
      if (!googleOn()) return signInError('Google sign-in is not set up on this map.');
      const host = LOCAL.test(req.headers.host || '') ? req.headers.host : `localhost:${PORT}`;
      const next = url.searchParams.get('next') || '/';
      return res.writeHead(302, { location: googleStart(`http://${host}`, next.startsWith('/') && !next.startsWith('//') ? next : '/') }).end();
    }
    if (url.pathname === '/auth/done' && req.method === 'GET') {
      let got; try { got = await googleFinish(url.searchParams); } catch (/** @type {any} */ e) { return signInError(e.message); }
      // one of this map's people only when the login's list says so, or, for an owner who signed in through Google,
      // by the address they did it with (an address, not a name, proves who someone is); anyone else is a guest under
      // their Google name, never seated as a person who happens to share it
      const email = validEmail(got.email) ? got.email : null;
      const name = users.ownerBy(email) || (got.listed ? users.person(got.name) || got.name : users.taken(got.name) ? `${got.name} (guest)` : got.name);
      // on a new install, the first person through Google owns it, as a first account would
      users.claim(name, email);
      users.setPicture(name, got.picture);
      return res.writeHead(302, { location: got.next, 'set-cookie': `lm_session=${users.start(name, email)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${users.maxAge}` }).end();
    }
    // Settings: your name, your role on the team, the email the map has for you and how you sign in. The email is
    // the one Google gave for this browser's sign-in, else the recovery email verified for a password kept here.
    if (url.pathname === '/settings' && req.method === 'GET') return who ? page(res, 'settings.html', who) : res.writeHead(302, { location: '/login?next=%2Fsettings' }).end();
    if (url.pathname === '/api/me' && req.method === 'GET') {
      if (!who) return json(401, { error: 'Sign in first.' });
      const google = users.emailOf(cookieOf(req, 'lm_session')), password = users.has(who), saved = (password && recovery.email(who)) || '';
      return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ name: who, role: roleOf(who), email: google || saved, emailFrom: google ? 'google' : saved ? 'recovery' : '', signIn: google ? 'google' : password ? 'password' : '',
          mail: mailReady(), owner: who === users.owner() }));
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!fromHere()) return refuse();
      const /** @type {any} */ a = await jsonBody(req, {});
      const one = users.person(a.name), typed = String(a.name || '').trim().slice(0, 40);
      // a password this Mac keeps, else one kept at Living Map login (someone with no Google account)
      const name = one ? users.check(one, a.password) : await passwordCheck(a.name, a.password);
      if (!name) {
        await new Promise((ok) => setTimeout(ok, 400));
        return json(401, { error: one ? 'That password is not right.' : users.firstRun() ? 'No one has an account here yet. Create yours.' : `No one called ${typed || 'that'} here. Ask whoever runs this map to add you.` });
      }
      return signIn(name);
    }
    // the first account on a new install, which owns it; refused once anyone has one
    if (url.pathname === '/api/first' && req.method === 'POST') {
      if (!fromHere()) return refuse();
      const /** @type {any} */ a = await jsonBody(req, {});
      const made = users.create(a.name, a.password);
      return 'name' in made ? signIn(made.name) : json(400, { error: made.error });
    }
    // The owner invites someone by name: a one-use link to /login, where they choose their password.
    if (url.pathname === '/api/invite' && req.method === 'POST') {
      if (!fromHere()) return refuse();
      if (!who) return json(401, { error: 'Sign in first.' });
      const /** @type {any} */ a = await jsonBody(req, {});
      const made = users.invite(who, a.name);
      if (!('token' in made)) return json(400, { error: made.error });
      return json(200, { name: made.name, link: `http://${req.headers.host}/login#invite=${made.token}` });
    }
    if (url.pathname === '/api/invite/check' && req.method === 'POST') {
      if (!fromHere()) return refuse();
      const /** @type {any} */ a = await jsonBody(req, {});
      const got = users.invited(a.token);
      return got ? json(200, got) : json(404, { error: 'This invite has expired or was already used. Ask for a new one.' });
    }
    if (url.pathname === '/api/join' && req.method === 'POST') {
      if (!fromHere()) return refuse();
      const /** @type {any} */ a = await jsonBody(req, {});
      const made = users.join(a.token, a.password);
      return 'name' in made ? signIn(made.name) : json(400, { error: made.error });
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
