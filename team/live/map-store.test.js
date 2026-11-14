import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { NOTE, mapStore, moveMaps } from './map-store.js';

const roots = /** @type {string[]} */ ([]);
afterAll(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const tmp = () => { const r = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-store-')); roots.push(r); return r; };
/** @param {string} file @param {any} data */
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
/** @param {string} file */
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const quiet = () => {};

/** A code folder as a clone kept its maps before they moved: two maps, one in Trash, pins and two code folders. */
function codeFolder() {
  const code = tmp();
  write(path.join(code, 'maps', 'launch', 'state.json'), { title: 'Launch' });
  write(path.join(code, 'maps', 'launch', 'saves', 'one.json'), { title: 'Launch, saved' });
  write(path.join(code, 'maps', 'pitrade-official-system', 'state.json'), { title: 'PiTrade' });
  write(path.join(code, 'maps', '.deleted', 'old-1234abcd', 'state.json'), { title: 'Old' });
  write(path.join(code, 'maps', '.deleted', 'index.json'), ['old']);
  write(path.join(code, 'maps', '.pinned.json'), { Duy: ['launch'] });
  write(path.join(code, 'projects.json'), ['/work/shop', '/work/bot']);
  const when = new Date('2025-01-02T03:04:05Z');
  fs.utimesSync(path.join(code, 'maps', 'launch', 'state.json'), when, when);
  return { code, when };
}
/** Every file under a folder, by its path inside it. @param {string} dir */
const files = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();

describe('where maps are kept', () => {
  it('is the data folder, ANUR_LIVING_MAP_MAPS for a test copy, or the code folder with --demo', () => {
    const data = '/home/me/.anur-living-map', code = '/clone/team/live';
    expect(mapStore({ code, data, env: {} })).toEqual({ root: data, MAPS: `${data}/maps`, PROJECTS: `${data}/projects.json`, movesIn: true });
    expect(mapStore({ code, data, env: { ANUR_LIVING_MAP_MAPS: '/tmp/copy' } })).toEqual({ root: '/tmp/copy', MAPS: '/tmp/copy/maps', PROJECTS: '/tmp/copy/projects.json', movesIn: false });
    expect(mapStore({ code, data, demo: true, env: {} })).toMatchObject({ root: code, MAPS: `${code}/maps`, movesIn: false });
    expect(mapStore({ code, data, demo: true, env: { ANUR_LIVING_MAP_MAPS: '/tmp/copy' } }).root).toBe('/tmp/copy');
  });

  it('keeps every test server that starts the team map away from the real data folder', () => {
    const live = import.meta.dirname, e2e = path.join(live, '..', '..', 'e2e');
    const starters = [...fs.readdirSync(live).map((f) => path.join(live, f)), ...fs.readdirSync(e2e).map((f) => path.join(e2e, f))]
      .filter((f) => /\.(test|harness|spec)\.[jt]s$/.test(f)).filter((f) => { const s = fs.readFileSync(f, 'utf8'); return /spawn\(/.test(s) && /['"]server\.js['"]/.test(s); });
    expect(starters.length).toBeGreaterThan(5);
    for (const f of starters) expect(fs.readFileSync(f, 'utf8'), path.basename(f)).toMatch(/ANUR_LIVING_MAP_MAPS|HOME: /);
  });
});

describe('the one-time move', () => {
  it('copies maps, Trash, pins and code folders, keeps the old ones, and notes where they came from', () => {
    const { code, when } = codeFolder(), data = tmp(), before = files(code), lines = /** @type {string[]} */ ([]);
    expect(moveMaps({ from: code, to: data, log: (l) => lines.push(l) })).toEqual({ copied: ['launch', 'pitrade-official-system'], skipped: [], trashed: 1 });
    expect(read(path.join(data, 'maps', 'launch', 'state.json'))).toEqual({ title: 'Launch' });
    expect(read(path.join(data, 'maps', 'launch', 'saves', 'one.json'))).toEqual({ title: 'Launch, saved' });
    expect(read(path.join(data, 'maps', 'pitrade-official-system', 'state.json'))).toEqual({ title: 'PiTrade' });
    expect(read(path.join(data, 'maps', '.deleted', 'old-1234abcd', 'state.json'))).toEqual({ title: 'Old' });
    expect(read(path.join(data, 'maps', '.deleted', 'index.json'))).toEqual(['old']);
    expect(read(path.join(data, 'maps', '.pinned.json'))).toEqual({ Duy: ['launch'] });
    expect(read(path.join(data, 'projects.json'))).toEqual(['/work/shop', '/work/bot']);
    // the list of maps sorts by when a map last changed, so the copy keeps that time
    expect(fs.statSync(path.join(data, 'maps', 'launch', 'state.json')).mtimeMs).toBe(when.getTime());
    const note = fs.readFileSync(path.join(data, 'maps', NOTE), 'utf8');
    expect(note).toContain(`Copied from: ${code}`);
    expect(note).toContain('Copied: launch, pitrade-official-system, and 1 in Trash');
    expect(note).toMatch(/left as it was, as a backup/);
    expect(lines.join('\n')).toMatch(/copied 2 maps and 1 in Trash from .* The old folder is left as it was/);
    // nothing in the old folder changed, and no half-copied folder is left
    expect(files(code)).toEqual(before);
    expect(fs.readdirSync(path.join(data, 'maps')).filter((f) => f.startsWith('.moving-'))).toEqual([]);
    // once is enough: a restart copies nothing again, even maps since removed here
    fs.rmSync(path.join(data, 'maps', 'launch'), { recursive: true });
    expect(moveMaps({ from: code, to: data, log: quiet })).toBeNull();
    expect(fs.existsSync(path.join(data, 'maps', 'launch'))).toBe(false);
  });

  it('skips a map whose name is already kept here, and joins Trash, pins and code folders with what is here', () => {
    const { code } = codeFolder(), data = tmp();
    write(path.join(data, 'maps', 'launch', 'state.json'), { title: 'Launch, kept here' });
    write(path.join(data, 'maps', 'old', 'state.json'), { title: 'Old, alive here' });
    write(path.join(data, 'maps', '.pinned.json'), { Duy: ['old'], Sam: ['launch'] });
    write(path.join(data, 'projects.json'), ['/work/bot', '/work/app']);
    expect(moveMaps({ from: code, to: data, log: quiet })).toEqual({ copied: ['pitrade-official-system'], skipped: ['launch'], trashed: 1 });
    expect(read(path.join(data, 'maps', 'launch', 'state.json'))).toEqual({ title: 'Launch, kept here' });
    // a name in the old Trash does not hide a map that is alive here
    expect(read(path.join(data, 'maps', '.deleted', 'index.json'))).toEqual([]);
    expect(read(path.join(data, 'maps', '.pinned.json'))).toEqual({ Duy: ['old', 'launch'], Sam: ['launch'] });
    expect(read(path.join(data, 'projects.json'))).toEqual(['/work/bot', '/work/app', '/work/shop']);
    expect(fs.readFileSync(path.join(data, 'maps', NOTE), 'utf8')).toContain('Not copied, since a map here already has the name: launch');
  });

  it('does nothing on a fresh install, with nothing in the code folder to move', () => {
    const code = tmp(), data = path.join(tmp(), 'data');
    expect(moveMaps({ from: code, to: data, log: quiet })).toBeNull();
    expect(fs.existsSync(data)).toBe(false);
  });

  it('waits while another server holds the lock, and takes over a lock its server left behind', () => {
    const { code } = codeFolder(), data = tmp(), lock = path.join(data, 'maps-move.lock');
    // a server that is still running (this one) holds it: nothing moves, and the next start tries again
    write(lock, `${process.pid}\n`);
    expect(() => moveMaps({ from: code, to: data, log: quiet, patience: 200 })).toThrow(/still moving maps/);
    expect(fs.existsSync(path.join(data, 'maps', 'launch'))).toBe(false);
    expect(fs.existsSync(path.join(data, 'maps', NOTE))).toBe(false);
    // its server has gone: the lock is taken over, and released after
    write(lock, `${spawnSync(process.execPath, ['-e', '0']).pid}\n`);
    expect(moveMaps({ from: code, to: data, log: quiet })?.copied).toEqual(['launch', 'pitrade-official-system']);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('moves once when two servers start at the same moment', async () => {
    const { code } = codeFolder(), data = tmp(), store = path.join(import.meta.dirname, 'map-store.js');
    const script = `import { moveMaps } from ${JSON.stringify(store)}; console.log(JSON.stringify(moveMaps({ from: ${JSON.stringify(code)}, to: ${JSON.stringify(data)}, log: () => {} })));`;
    const run = () => new Promise((resolve) => { let out = ''; const p = spawn(process.execPath, ['--input-type=module', '-e', script]); p.stdout.on('data', (d) => { out += d; }); p.on('close', () => resolve(out.trim())); });
    const results = await Promise.all([run(), run(), run()]);
    expect(results.filter((r) => r !== 'null')).toHaveLength(1);
    expect(fs.readFileSync(path.join(data, 'maps', NOTE), 'utf8').match(/Copied from:/g)).toHaveLength(1);
    expect(fs.readdirSync(path.join(data, 'maps')).sort()).toEqual(['.deleted', '.pinned.json', 'launch', NOTE, 'pitrade-official-system']);
  });
});

describe('a server started from a code folder that kept maps', () => {
  it('copies them to the data folder before it serves, lists them, and keeps new maps there', async () => {
    const root = tmp(), app = path.join(root, 'app'), home = path.join(root, 'home'), shop = path.join(root, 'shop');
    fs.mkdirSync(app); fs.mkdirSync(shop);
    for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && name !== 'projects.json' && !name.includes('.test.') && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(app, name));
    fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(app, 'agents'), { recursive: true });
    const state = { title: 'Kept map', nodes: [], edges: [], people: [], calls: [], prs: [], log: [], threads: {} };
    write(path.join(app, 'maps', 'kept-map', 'state.json'), state);
    write(path.join(app, 'maps', '.pinned.json'), { Duy: ['kept-map'] });
    write(path.join(app, 'projects.json'), [shop]);
    /** @type {Record<string, string | undefined>} */
    const env = { ...process.env, HOME: home, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '', LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json'), ANUR_LIVING_MAP_NO_UPDATE: '1' };
    delete env.ANUR_LIVING_MAP_MAPS;
    const cookie = execFileSync(process.execPath, ['--input-type=module', '-e', "import {users} from './users.js'; console.log(users.start('Duy'))"], { cwd: app, env, encoding: 'utf8' }).trim();
    const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
    const origin = `http://localhost:${port}`, headers = { 'sec-fetch-site': 'same-origin', cookie: `lm_session=${cookie}` };
    const child = spawn(process.execPath, ['server.js', String(port)], { cwd: app, env, stdio: 'ignore' });
    try {
      for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/version')).ok) break; } catch { /* not listening yet */ } await new Promise((r) => setTimeout(r, 50)); }
      const data = path.join(home, '.anur-living-map');
      const list = await (await fetch(origin + '/api/maps', { headers })).json();
      expect(list.map((/** @type {any} */ m) => [m.name, m.pinned]).sort()).toEqual([['kept-map', true], ['shop', false]]);
      expect(read(path.join(data, 'maps', 'kept-map', 'state.json')).title).toBe('Kept map');
      expect(read(path.join(data, 'projects.json'))).toEqual([shop]);
      // a map made now is kept in the data folder, and the code folder's copy is left as it was
      const made = await (await fetch(origin + '/api/newmap', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ blank: true }) })).json();
      expect(fs.existsSync(path.join(data, 'maps', made.name, 'state.json'))).toBe(true);
      expect(fs.existsSync(path.join(app, 'maps', made.name))).toBe(false);
      expect(fs.readdirSync(path.join(app, 'maps')).sort()).toEqual(['.pinned.json', 'kept-map']);
    } finally {
      const done = new Promise((r) => child.once('exit', r)); child.kill(); await done;
    }
  });
});
