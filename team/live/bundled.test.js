import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

// The server as the Mac app starts it: from a copy of the package, with --bundled, its own data folder and its port.
// It never runs git, keeps everything in the folder it was given, stops cleanly on SIGTERM, and a second server on
// the same port says the port is taken.

// each test starts the server as a real node process: far longer than the default limit on a busy machine
const SPAWNS = 60_000;

/** @type {(() => Promise<void> | void)[]} */
const cleanup = [];
afterEach(async () => { while (cleanup.length) await /** @type {() => any} */ (cleanup.pop())(); });

/** A copy of the package with a stand-in git that writes down every call, and a data folder of its own. */
function install() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-bundled-'));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), data = path.join(root, 'data'), bin = path.join(root, 'bin'), repo = path.join(root, 'shop'), gitLog = path.join(root, 'git-calls');
  for (const d of [app, bin, repo]) fs.mkdirSync(d);
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !name.includes('.test.') && name !== 'projects.json' && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(app, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(app, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${gitLog}'\nexit 1\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: path.join(root, 'home'), ANUR_LIVING_MAP_DATA: data,
    LIVING_MAP_LOGIN_URL: '', LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json') };
  for (const k of ['ANUR_LIVING_MAP_MAPS', 'ANUR_LIVING_MAP_NO_UPDATE', 'ANUR_LIVING_MAP_BUNDLED', 'LIVING_MAP_USERS']) delete env[k];
  return { root, app, data, repo, env, gitCalls: () => (fs.existsSync(gitLog) ? fs.readFileSync(gitLog, 'utf8').trim().split('\n') : []) };
}

const freePort = async () => {
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  return port;
};

/** Starts server.js in the copy; how it ended, once it has. @param {ReturnType<typeof install>} at @param {number} port @param {string[]} args */
function start(at, port, args) {
  const child = spawn(process.execPath, ['server.js', String(port), ...args], { cwd: at.app, env: at.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (d) => { said += d; }); child.stderr.on('data', (d) => { said += d; });
  const ended = /** @type {Promise<{ code: number | null, said: string }>} */ (new Promise((r) => child.once('exit', (code) => r({ code, said }))));
  cleanup.push(async () => { if (child.exitCode === null) { child.kill('SIGKILL'); await ended; } });
  return { child, ended, said: () => said };
}

/** @param {number} port */
async function answering(port) {
  for (let i = 0; ; i++) { try { if ((await fetch(`http://localhost:${port}/api/version`)).ok) return; } catch { /* not listening yet: ask again */ } if (i > 100) throw new Error('Server did not start'); await new Promise((r) => setTimeout(r, 50)); }
}

it('never runs git, offers no update, keeps everything in its own data folder, and stops cleanly on SIGTERM', async () => {
  const at = install(), port = await freePort(), origin = `http://localhost:${port}`;
  const s = start(at, port, ['--bundled']);
  await answering(port);
  const pkg = JSON.parse(fs.readFileSync(path.join(at.app, 'package.json'), 'utf8'));
  expect(await (await fetch(`${origin}/api/version?check=1`)).json()).toMatchObject({ version: pkg.version, bundled: true, latest: null, build: 0 });
  expect(await (await fetch(`${origin}/api/update`, { method: 'POST' })).json()).toEqual({ ok: false, why: 'updates come with the app' });
  // a chat opening a repo's map, and a box drawn on it
  const post = (/** @type {string} */ route, /** @type {any} */ data) => fetch(origin + route, { method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(data) });
  expect(await (await post('/api/projects', { folder: at.repo })).json()).toEqual({ name: 'shop', href: '/shop/' });
  expect((await post('/shop/api/act', { type: 'add', label: 'Checkout', x: 0, y: 0 })).status).toBe(200);
  expect(s.said()).toContain('bundled: updates come with the app');
  s.child.kill('SIGTERM');
  expect((await s.ended).code).toBe(0);
  expect(at.gitCalls()).toEqual([]);
  // the list of maps and the people are in the folder it was given, and nothing in the home folder's default
  expect(fs.existsSync(path.join(at.data, 'projects.json'))).toBe(true);
  expect(fs.existsSync(path.join(at.env.HOME || '', '.anur-living-map'))).toBe(false);
  expect(fs.existsSync(path.join(at.data, 'server.rev'))).toBe(false);
  // the map is on disk whole, with no temporary file left beside it
  const kept = path.join(at.repo, '.living-map');
  expect(JSON.parse(fs.readFileSync(path.join(kept, 'state.json'), 'utf8')).nodes.map((/** @type {any} */ n) => n.label)).toContain('Checkout');
  expect(fs.readdirSync(kept, { recursive: true }).filter((f) => String(f).endsWith('.tmp'))).toEqual([]);
}, SPAWNS);

it('a clone that is not bundled still asks git, so the stand-in above would have heard it', async () => {
  const at = install(), port = await freePort();
  start(at, port, []);
  await answering(port);
  await fetch(`http://localhost:${port}/api/version?check=1`);
  expect(at.gitCalls().length).toBeGreaterThan(0);
}, SPAWNS);

it('a second server on a taken port says so and stops, leaving the first one running', async () => {
  const at = install(), port = await freePort();
  start(at, port, ['--bundled']);
  await answering(port);
  const second = await start(at, port, ['--bundled']).ended;
  expect(second.code).toBe(1);
  expect(second.said).toContain(`Port ${port} is taken`);
  expect((await fetch(`http://localhost:${port}/api/version`)).ok).toBe(true);
}, SPAWNS);
