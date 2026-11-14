import http from 'node:http';

import { afterAll, beforeAll, expect, it } from 'vitest';

// Signing in with Google through a stand-in for Living Map login, on this machine: what googleFinish hands back,
// and the ID token it keeps for publishing online. Never calls Google or the real login service.
/** @type {http.Server} */ let login;
/** @type {Record<string, unknown>} */ let answer = {};
/** @type {typeof import('./google.js')} */ let google;
const jwt = (/** @type {object} */ claims) => ['{"alg":"RS256","kid":"k"}', JSON.stringify(claims)].map((p) => Buffer.from(p).toString('base64url')).join('.') + '.' + 'c'.repeat(40);

beforeAll(async () => {
  login = http.createServer((req, res) => {
    if (req.url === '/exchange' && req.method === 'POST') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
    else res.writeHead(404).end();
  });
  await new Promise((r) => login.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  process.env.LIVING_MAP_LOGIN_URL = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (login.address()).port}`;
  google = await import('./google.js');
});
afterAll(async () => { await new Promise((r) => login.close(r)); });

/** A round trip: where googleStart sends the browser, and what came back on /auth/done. */
const signIn = async () => {
  const to = new URL(google.googleStart('http://localhost:4400', '/sample/#share'));
  return google.googleFinish(new URLSearchParams({ state: /** @type {string} */ (to.searchParams.get('state')), code: 'one-time' }));
};

it('passes Google\'s ID token on, and keeps it for publishing while it is fresh', async () => {
  const idToken = jwt({ email: 'ana@example.com', exp: Math.floor(Date.now() / 1000) + 3600 });
  answer = { email: 'Ana@Example.com', name: 'Ana', listed: false, picture: '', id_token: idToken };
  const got = await signIn();
  expect(got).toMatchObject({ name: 'Ana', idToken, next: '/sample/#share' });
  expect(google.googleIdentity('ana@example.com')).toEqual({ email: 'ana@example.com', name: 'Ana', idToken, needs: '' });
  // with no address to go by, the latest Google sign-in on this Mac
  expect(google.googleIdentity().idToken).toBe(idToken);
});

it('says the login service needs an update when it sends no ID token, and asks again once the token is stale', async () => {
  answer = { email: 'old@example.com', name: 'Old', listed: false, picture: '' };
  expect((await signIn()).idToken).toBe('');
  expect(google.googleIdentity('old@example.com')).toMatchObject({ idToken: '', needs: 'update' });
  answer = { email: 'stale@example.com', name: 'Stale', listed: false, picture: '', id_token: jwt({ exp: Math.floor(Date.now() / 1000) + 60 }) };
  await signIn();
  expect(google.googleIdentity('stale@example.com')).toMatchObject({ idToken: '', needs: 'signin' });
  expect(google.googleIdentity('never@example.com')).toMatchObject({ idToken: '', needs: 'signin' });
  // something that is not a token is never kept
  answer = { email: 'odd@example.com', name: 'Odd', listed: false, picture: '', id_token: '<script>' };
  expect((await signIn()).idToken).toBe('');
});
