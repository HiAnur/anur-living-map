import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

// A person's Google picture: Living Map login hands its address over when they sign in through Google, this
// server keeps it for that person, writes it into their pages, and puts it on them among a map's people.

it('keeps the picture Google gave at sign-in for the pages and the map, and drops one that is not Google\'s', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-picture-'));
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !name.includes('.test.') && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(root, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(root, 'agents'), { recursive: true });
  const state = JSON.parse(fs.readFileSync(path.join(root, 'seed.json'), 'utf8'));
  state.people = [{ id: 'Duy', role: 'Admin', joined: 'test' }];
  fs.mkdirSync(path.join(root, 'maps', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(root, 'maps', 'shared', 'state.json'), JSON.stringify(state));
  // Living Map login, stood in for: each sign-in is answered with the next picture
  const good = 'https://lh3.googleusercontent.com/a/ACg8ocJ-x_Y=s96-c';
  const answers = [good, 'https://example.com/a.png"><script>'];
  const login = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ email: 'priyanka@example.com', name: 'Priyanka', listed: true, picture: answers.shift() })); });
  await new Promise((r) => login.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const env = { ...process.env, ANUR_LIVING_MAP_MAPS: root, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (login.address()).port}` };
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js', String(port)], { cwd: root, env, stdio: 'ignore' });
  const request = (/** @type {string} */ route, cookie = '') => fetch(origin + route, { redirect: 'manual', headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', ...(cookie ? { cookie } : {}) } });
  const signIn = async () => {
    const to = new URL(/** @type {string} */ ((await request('/auth/google')).headers.get('location')));
    return /** @type {string} */ ((await request(`/auth/done?code=one&state=${to.searchParams.get('state')}`)).headers.get('set-cookie')).split(';')[0];
  };
  // the people a window following the map is first sent
  const people = async (/** @type {string} */ cookie) => {
    const reader = /** @type {any} */ ((await request('/shared/api/events', cookie)).body).getReader();
    let text = ''; while (!/event: state\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    return JSON.parse(/** @type {any} */ (text.match(/event: state\ndata: (.*)\n/))[1]).people;
  };
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(origin + '/api/version')).ok) break; } catch { /* not listening yet: ask again */ } if (i > 60) throw new Error('Server did not start'); await new Promise((r) => setTimeout(r, 50)); }
    const first = await signIn();
    for (const page of ['/', '/settings', '/shared/']) expect(await (await request(page, first)).text()).toContain(`<meta name="lm-picture" content="${good}">`);
    expect(await people(first)).toEqual([{ id: 'Duy', role: 'Admin', sees: 'all', joined: 'test' }, expect.objectContaining({ id: 'Priyanka', picture: good })]);
    // signing in again with a picture that is not on Google's picture host takes the old one away, everywhere
    const second = await signIn();
    for (const page of ['/', '/settings', '/shared/']) expect(await (await request(page, second)).text()).not.toContain('<meta name="lm-picture"');
    expect((await people(second)).find((/** @type {any} */ p) => p.id === 'Priyanka')).not.toHaveProperty('picture');
  } finally {
    if (child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; }
    await new Promise((r) => login.close(r)); fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);
