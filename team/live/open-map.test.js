import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// /anur-living-map's open step (team/skill/anur-living-map/scripts/open-map.sh), run for real against a stand-in
// server: it adds this repo's map, finds the system map drawn from this repo, and says what it would open. It never
// updates the clone, opens Chrome, or links a chat here.

const REPO = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO, 'team', 'skill', 'anur-living-map', 'scripts', 'open-map.sh');
const dirs = /** @type {string[]} */ ([]);
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-open-')); dirs.push(d); return d; };

/** what the stand-in server was asked, and what it says about system maps @type {{ asked: string[], systemOf: object }} */
const stub = { asked: [], systemOf: {} };
let port = 0;
/** @type {http.Server} */
let server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    stub.asked.push(`${req.method} ${decodeURIComponent(req.url || '')}`);
    const url = new URL(req.url || '/', 'http://x');
    const json = (/** @type {any} */ v) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
    if (url.pathname === '/api/maps') return json([]);
    if (url.pathname === '/api/projects') return json({ name: 'shop-api', href: '/shop-api/' });
    if (url.pathname === '/api/maps/system-of') return json(stub.systemOf);
    if (url.pathname.endsWith('/api/history')) return json([{ id: 'v1' }, { id: 'v2' }]);
    if (url.pathname.endsWith('/api/rules')) return res.writeHead(200).end('rules here');
    json({ ok: true });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});
afterAll(() => { server.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** Runs the script in a repo of its own, as a chat in that repo would. @returns {Promise<string>} what it printed */
function open() {
  const home = tmp(), repo = path.join(tmp(), 'shop-api');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  // the server already runs this clone's commit, so the script neither starts nor restarts one
  fs.mkdirSync(path.join(home, '.anur-living-map'), { recursive: true });
  fs.writeFileSync(path.join(home, '.anur-living-map', 'server.rev'), `${execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\n`);
  const env = { ...process.env, HOME: home, ANUR_LIVING_MAP_HOME: REPO, ANUR_LIVING_MAP_PORT: String(port), ANUR_LIVING_MAP_NO_UPDATE: '1',
    ANUR_LIVING_MAP_NO_BROWSER: '1', CLAUDE_CODE_SESSION_ID: '' };
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT], { cwd: repo, env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => resolve(out.replace(fs.realpathSync(repo), '<repo>').replace(repo, '<repo>')));
  });
}

describe('opening the map from a repo', () => {
  it('opens the repo\'s own map when no system map was drawn from it, and leaves the clone and Chrome alone', async () => {
    stub.asked.length = 0; stub.systemOf = {};
    const out = await open();
    expect(out).toContain('update: skipped, ANUR_LIVING_MAP_NO_UPDATE is set');
    expect(out).toContain('server: already running');
    expect(out).toContain('map: http://localhost:' + port + '/shop-api/, as it was left, 2 versions in History');
    expect(out).toContain(`chrome: skipped, would open http://localhost:${port}/shop-api/`);
    expect(out).toContain('chat: not linked');
    expect(out).toContain('rules here');
    expect(out).not.toContain('system map:');
    expect(stub.asked.some((a) => a.startsWith('POST /api/projects'))).toBe(true);
    expect(stub.asked.find((a) => a.startsWith('GET /api/maps/system-of'))).toMatch(/folder=.*shop-api$/);
  });
  it('opens the system map drawn from this repo, at the repo\'s own box', async () => {
    stub.asked.length = 0; stub.systemOf = { name: 'shop-system', box: 'system-api', href: '/shop-system/?brain-box=system-api' };
    const out = await open();
    expect(out).toContain('system map: shop-system, drawn from this repo');
    expect(out).toContain(`chrome: skipped, would open http://localhost:${port}/shop-system/?brain-box=system-api`);
    // what the chat hears and the map it opens are the system map's
    expect(stub.asked).toContain('POST /shop-system/api/act');
    expect(stub.asked.some((a) => a.startsWith('GET /shop-system/api/rules'))).toBe(true);
  });
});
