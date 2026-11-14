// Where the maps this server names are kept: each named map, Trash (.deleted) and everyone's pins (.pinned.json)
// under maps/, and the code folders it was opened from in projects.json. They live in the team map's data folder
// (data-dir.js), apart from the code, so clearing npx's cache loses none and two servers run from one clone do not
// share them; a repo's own map stays in <repo>/.living-map/. ANUR_LIVING_MAP_MAPS names another folder to keep
// them in, for a test copy; --demo keeps them in the code folder, beside the story, as before.
//
// They were kept in the code folder (team/live/maps/, team/live/projects.json). A server started from one copies
// them across once, before it serves (moveMaps), and leaves the old folder as it was, as a backup.
import fs from 'node:fs';
import path from 'node:path';

import { DATA } from './data-dir.js';

/**
 * The folder that holds maps/ and projects.json for a server run from `code`, and whether it is the data folder
 * that the code folder's maps move into.
 * @param {{ code: string, demo?: boolean, env?: Record<string, string | undefined>, data?: string }} o
 */
export function mapStore({ code, demo = false, env = process.env, data = DATA }) {
  const root = env.ANUR_LIVING_MAP_MAPS ? path.resolve(env.ANUR_LIVING_MAP_MAPS) : demo ? code : data;
  return { root, MAPS: path.join(root, 'maps'), PROJECTS: path.join(root, 'projects.json'), movesIn: root === data && path.resolve(code) !== path.resolve(data) };
}

/** The note in the new maps/ folder saying where its maps came from, one block per code folder moved. */
export const NOTE = 'moved-from.txt';
const NAME = /^[a-z0-9-]+$/;

/**
 * Copies the maps a code folder kept (`from`/maps and `from`/projects.json) into `to`, once per code folder: each
 * map whole under a temporary name and then renamed, so a server stopped halfway leaves no half map; a name `to`
 * already holds is skipped and kept as it is. Trash, pins and the list of code folders join what `to` holds. Nothing
 * is deleted: `from` stays as the backup. A lock in `to` keeps two servers starting at once from moving together;
 * the second waits, then finds the move done. What moved, or null when there was nothing to move.
 * @param {{ from: string, to: string, log?: (line: string) => void, patience?: number }} o
 * `patience`: how long to wait for another server's move before giving up, in milliseconds
 */
export function moveMaps({ from, to, log = (line) => console.log(line), patience = 60_000 }) {
  const source = path.resolve(from), oldMaps = path.join(source, 'maps'), oldProjects = path.join(source, 'projects.json');
  if (!fs.existsSync(oldMaps) && !fs.existsSync(oldProjects)) return null;
  const MAPS = path.join(to, 'maps'), note = path.join(MAPS, NOTE), mark = `Copied from: ${source}`;
  const moved = () => { try { return fs.readFileSync(note, 'utf8').split('\n').includes(mark); } catch { return false; } };
  if (moved()) return null;
  fs.mkdirSync(MAPS, { recursive: true });
  const unlock = lock(path.join(to, 'maps-move.lock'), patience);
  try {
    if (moved()) return null;
    const entries = (/** @type {string} */ dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
    /** @type {string[]} */ const copied = [];
    /** @type {string[]} */ const skipped = [];
    for (const name of entries(oldMaps).filter((n) => NAME.test(n))) (place(path.join(oldMaps, name), path.join(MAPS, name)) ? copied : skipped).push(name);
    const oldBin = path.join(oldMaps, '.deleted'), bin = path.join(MAPS, '.deleted');
    const trashed = entries(oldBin).filter((n) => place(path.join(oldBin, n), path.join(bin, n))).length;
    // a name in Trash stays kept from coming back, unless a map here already answers to it
    merge(path.join(oldBin, 'index.json'), path.join(bin, 'index.json'), [], (/** @type {any[]} */ here, /** @type {any[]} */ old) =>
      [...new Set([...here, ...old.filter((n) => typeof n === 'string' && !fs.existsSync(path.join(MAPS, n)))])]);
    merge(path.join(oldMaps, '.pinned.json'), path.join(MAPS, '.pinned.json'), {}, (/** @type {any} */ here, /** @type {any} */ old) => {
      const all = { ...here };
      for (const [who, names] of Object.entries(old)) if (Array.isArray(names)) all[who] = [...new Set([...(Array.isArray(all[who]) ? all[who] : []), ...names])];
      return all;
    });
    merge(oldProjects, path.join(to, 'projects.json'), [], (/** @type {any[]} */ here, /** @type {any[]} */ old) => [...new Set([...here, ...old])]);
    fs.appendFileSync(note, [mark, `At: ${new Date().toISOString()}`,
      'The maps, Trash, pins and list of code folders kept there were copied here when a server first started from that folder.',
      'That folder is left as it was, as a backup: its maps/ and projects.json can be deleted once you no longer need them.',
      `Copied: ${copied.join(', ') || 'no maps'}${trashed ? `, and ${trashed} in Trash` : ''}`,
      ...(skipped.length ? [`Not copied, since a map here already has the name: ${skipped.join(', ')}`] : []), '', ''].join('\n'));
    log(`[maps] copied ${copied.length} maps${trashed ? ` and ${trashed} in Trash` : ''} from ${source} to ${to}${skipped.length ? `; kept the ones here named ${skipped.join(', ')}` : ''}. The old folder is left as it was, as a backup.`);
    return { copied, skipped, trashed };
  } finally { unlock(); }
}

/**
 * Copies a folder to where it goes under a temporary name, then renames it there, keeping its files' times (the list
 * of maps sorts by them). False when something already has that name.
 * @param {string} src @param {string} dst
 */
function place(src, dst) {
  if (fs.existsSync(dst)) return false;
  const tmp = path.join(path.dirname(dst), `.moving-${path.basename(dst)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, tmp, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  fs.renameSync(tmp, dst);
  return true;
}

/**
 * Joins a JSON file from the old folder into the one here, written whole through a rename. An old file that is
 * missing or unreadable changes nothing.
 * @template T @param {string} src @param {string} dst @param {T} empty @param {(here: T, old: T) => T} join
 */
function merge(src, dst, empty, join) {
  /** @type {T} */ let old;
  try { old = JSON.parse(fs.readFileSync(src, 'utf8')); } catch { return; }
  if (Array.isArray(empty) !== Array.isArray(old) || !old || typeof old !== 'object') return;
  /** @type {T} */ let here = empty;
  try { const read = JSON.parse(fs.readFileSync(dst, 'utf8')); if (Array.isArray(empty) === Array.isArray(read) && read && typeof read === 'object') here = read; } catch { /* nothing here yet */ }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(`${dst}.tmp`, JSON.stringify(join(here, old), null, 1)); fs.renameSync(`${dst}.tmp`, dst);
}

/**
 * Takes the lock file, waiting while another server holds it; the release. A lock whose server is gone, or that is
 * older than ten minutes, was left by a move that stopped, and is taken over.
 * @param {string} file @param {number} patience
 */
function lock(file, patience) {
  const until = Date.now() + patience, nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (/** @type {any} */ e) {
      if (e?.code !== 'EEXIST') throw e;
      if (stale(file)) { fs.rmSync(file, { force: true }); continue; }
      if (Date.now() > until) throw new Error(`another server is still moving maps (${file})`);
      Atomics.wait(nap, 0, 0, 100);
    }
  }
}

/** @param {string} file */
function stale(file) {
  try {
    if (Date.now() - fs.statSync(file).mtimeMs > 10 * 60_000) return true;
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (!pid) return false;
    process.kill(pid, 0);
    return false;
  } catch (/** @type {any} */ e) { return e?.code === 'ESRCH'; }
}
