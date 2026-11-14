import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

// The first time someone opens a map they join it, and an Admin who joins becomes its owner. The window they
// opened it in must start as owner rather than be told its access changed, which reloads it.
it('an Admin opening a map for the first time is not told to reload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-first-open-'));
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(root, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(root, 'agents'), { recursive: true });
  const env = { ...process.env, ANUR_LIVING_MAP_MAPS: root, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '' };
  const cookie = execFileSync(process.execPath, ['--input-type=module', '-e', "import {users} from './users.js'; console.log(users.start('Duy'))"], { cwd: root, env, encoding: 'utf8' }).trim();
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js', String(port)], { cwd: root, env, stdio: 'ignore' });
  /** @type {any} */ let reader;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/version')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }
    const headers = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', cookie: `lm_session=${cookie}` };
    const made = await fetch(origin + '/api/newmap', { method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json' }, body: JSON.stringify({ blank: true }) });
    expect(made.status).toBe(200);
    const { href } = await made.json();
    const stream = await fetch(origin + href + 'api/events', { headers });
    reader = /** @type {any} */ (stream.body).getReader();
    let text = '';
    const until = Date.now() + 800;
    while (Date.now() < until) {
      const r = await Promise.race([reader.read(), new Promise((ok) => setTimeout(() => ok({ wait: true }), until - Date.now()))]);
      if (r.done) break;
      if (r.value) text += new TextDecoder().decode(r.value);
    }
    expect(text).toContain('event: state');
    expect(text).not.toContain('access-changed');
    // the window got the owner's view of the map: its sharing settings, link and all
    const first = JSON.parse(text.split('event: state\ndata: ')[1].split('\n')[0]);
    expect(first.people.map((/** @type {any} */ p) => p.id)).toContain('Duy');
  } finally {
    await reader?.cancel().catch(() => {});
    if (child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
