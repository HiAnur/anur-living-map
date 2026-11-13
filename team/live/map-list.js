// The maps this server keeps: each code folder's own (projects.json remembers the ones added), the maps named
// by address under maps/, the ones moved to Trash, which old addresses and restarts must not bring back, and the
// ones each person pinned to the top of their own list.
// `main` is the map at the server's own address: the first code folder's, the demo story with --demo, or none.
import fs from 'node:fs';
import path from 'node:path';

import { managesAccess, removedFrom } from './access.js';

/**
 * @param {{ openMap: (options: any) => any, DIR: string, PROJECT: string, PROJECTS: string,
 *   mapName: (folder: any) => string, adminsOf?: (state: any, project: string) => string[], DEMO?: boolean }} deps
 * `adminsOf`: who owns a map, by its state and its code folder ('' for a map with none); `DEMO`: the story is the map at /
 */
export function mapList({ openMap, DIR, PROJECT, PROJECTS, mapName, adminsOf = () => [], DEMO = false }) {
  const DELETED = path.join(DIR, 'maps', '.deleted', 'index.json');
  const deletedMaps = new Set((() => { try { return JSON.parse(fs.readFileSync(DELETED, 'utf8')); } catch { return []; } })());
  const saveDeleted = () => { fs.mkdirSync(path.dirname(DELETED), { recursive: true }); fs.writeFileSync(`${DELETED}.tmp`, JSON.stringify([...deletedMaps])); fs.renameSync(`${DELETED}.tmp`, DELETED); };
  // The maps each person pinned, by name: a pin is that person's own, so it reorders nobody else's list.
  const PINNED = path.join(DIR, 'maps', '.pinned.json');
  /** @type {Map<string, string[]>} */
  const pinned = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(PINNED, 'utf8'))).filter(([, names]) => Array.isArray(names)); } catch { return []; } })());
  /** @param {any} who @param {string} name */
  const isPinned = (who, name) => !!pinned.get(who)?.includes(name);
  /** @param {string} who @param {string} name @param {boolean} on */
  const setPinned = (who, name, on) => {
    const rest = (pinned.get(who) || []).filter((n) => n !== name);
    if (on) pinned.set(who, [...rest, name]); else if (rest.length) pinned.set(who, rest); else pinned.delete(who);
    fs.mkdirSync(path.dirname(PINNED), { recursive: true }); fs.writeFileSync(`${PINNED}.tmp`, JSON.stringify(Object.fromEntries(pinned))); fs.renameSync(`${PINNED}.tmp`, PINNED);
  };
  /** @param {any} options */
  function connectedMap(options) {
    let /** @type {any} */ map;
    const own = options.name || options.at || (options.project ? mapName(options.project) : '');
    const req = { url: '/', headers: { 'sec-fetch-site': 'same-origin' } };
    map = openMap({ ...options, contextMaps: (/** @type {any} */ who) => {
      if (!who || who === 'Guest' || !map.allowed(who, req)) return [];
      return everyMap().filter(([id]) => id !== own).map(([id, other]) => ({ id,
        allowed: () => map.allowed(who, req) && everyMap().some(([key, value]) => key === id && value === other) && other.allowed(who, req),
        snapshot: () => other.snapshotFor ? other.snapshotFor(who) : other.snapshot(),
      }));
    } });
    return map;
  }
  /** @type {{ main: any }} */ const maps = { main: DEMO ? connectedMap({ project: '', home: DIR }) : null };
  // every code folder this server draws, by its address: the one it started with, then each added since.
  // A map's address is its folder's name in lowercase letters, digits and dashes (AnurWebApp -> /anurwebapp/), or
  // its title's (addressOf); `aliases` holds the folder's own name for a map that took its title's.
  /** @type {Map<string, any>} */ const projects = new Map();
  /** @type {Map<string, string>} */ const folders = new Map();
  /** @type {Map<string, string>} */ const aliases = new Map();
  const named = new Map();
  const remembered = () => { try { return JSON.parse(fs.readFileSync(PROJECTS, 'utf8')); } catch { return []; } };
  /** Whether an address is another map's, a page file's, or the API's. @param {string} n */
  const taken = (n) => deletedMaps.has(n) || projects.has(n) || aliases.has(n) || named.has(n) || fs.existsSync(path.join(DIR, 'maps', n)) || fs.existsSync(path.join(DIR, n)) || n === 'api'
    || [...folders.values(), PROJECT].some((f) => f && mapName(f) === n);
  /**
   * A code folder's address. A folder whose name says less than its title (a repo cloned as "repo" whose package is
   * "shop-api") gets its title's, but only for a new map, so no address anyone has used ever moves, and only when no
   * other map, page or folder answers to it. The choice is kept in <folder>/.living-map/address; `keep` is set
   * when it is new, to write once the folder joins.
   * @param {string} folder
   */
  const addressOf = (folder) => {
    const own = mapName(folder), file = path.join(folder, '.living-map', 'address');
    let kept = ''; try { kept = fs.readFileSync(file, 'utf8').trim(); } catch { /* none kept yet */ }
    if (kept) return { name: /^[a-z0-9-]+$/.test(kept) && !taken(kept) ? kept : own, keep: false };
    if (fs.existsSync(path.join(folder, '.living-map', 'state.json'))) return { name: own, keep: false };
    let title = ''; try { title = String(JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).name || ''); } catch { /* no package: the folder's name */ }
    const t = mapName(title.replace(/^@[^/]+\//, ''));
    return t && t !== own && /^[a-z0-9-]+$/.test(t) && !taken(t) ? { name: t, keep: true } : { name: own, keep: false };
  };
  /** The address a folder's map answers at: the one it has on the list, else the one it would take. @param {string} folder */
  const nameOf = (folder) => [...folders].find(([, f]) => f === folder)?.[0] || addressOf(folder).name;
  /** A code folder's map opened at its address, reached by its folder's name too. @param {string} name @param {string} folder @param {string} [home] */
  const openFolder = (name, folder, home = path.join(folder, '.living-map')) => {
    const own = mapName(folder), map = connectedMap({ project: folder, home, ...(name !== own ? { at: name } : {}) });
    projects.set(name, map); folders.set(name, folder); if (name !== own) aliases.set(own, name);
    if (folder === PROJECT) maps.main = map;
    return map;
  };
  const addProject = (/** @type {any} */ folder, restore = false) => {
    const listed = [...folders].find(([, f]) => f === folder)?.[0];
    const { name, keep } = listed ? { name: listed, keep: false } : addressOf(folder);
    if (deletedMaps.has(name) && !restore) return false;
    if (folders.has(name)) return folders.get(name) === folder;
    if (!/^[a-z0-9-]+$/.test(name) || !fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return false;
    if (deletedMaps.delete(name)) saveDeleted();
    if (keep) { fs.mkdirSync(path.join(folder, '.living-map'), { recursive: true }); fs.writeFileSync(path.join(folder, '.living-map', 'address'), `${name}\n`); }
    openFolder(name, folder);
    return true;
  };
  if (PROJECT) addProject(PROJECT);
  // the code folders added before are listed again, unless this server only plays the story
  if (!DEMO) for (const f of remembered()) addProject(f);
  // a name no map here has yet, from the first words of what it is about (a prompt, a shared file's title)
  /** @param {any} text */
  function freeName(text) {
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 4).join('-').slice(0, 40) || 'map';
    let name = base; for (let i = 2; taken(name); i++) name = `${base}-${i}`;
    return name;
  }
  const mapCalled = (/** @type {any} */ name) => named.get(name) ?? named.set(name, connectedMap({ name, home: path.join(DIR, 'maps', name) })).get(name);
  // Existing archives are readable in Trash too, including maps removed before Restore was available.
  const trashRecords = (/** @type {any} */ who) => {
    const bin = path.dirname(DELETED);
    if (!who || !fs.existsSync(bin)) return [];
    return fs.readdirSync(bin, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
      try {
        const archive = path.join(bin, d.name), state = JSON.parse(fs.readFileSync(path.join(archive, 'state.json'), 'utf8'));
        let meta; try { meta = JSON.parse(fs.readFileSync(path.join(archive, 'trash.json'), 'utf8')); } catch { /* an older archive has no trash.json */ }
        const name = meta?.name || d.name.replace(/-(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[a-z0-9]{8,12})$/, '');
        if (!/^[a-z0-9-]+$/.test(name)) return [];
        const project = meta ? meta.project : [PROJECT, ...remembered()].find((f) => f && mapName(f) === name) || '';
        if (meta?.restored || removedFrom(state, who) || !(managesAccess(state, who) || adminsOf(state, project).includes(who))) return [];
        return [{ id: d.name, name, title: state.title || name, at: meta?.at || fs.statSync(archive).mtimeMs, project, archive }];
      } catch { return []; }
    }).sort((a, b) => b.at - a.at);
  };
  // every map to choose from: the code folders' own, then each named one
  const everyMap = () => {
    const MAPS = path.join(DIR, 'maps');
    const names = fs.existsSync(MAPS) ? fs.readdirSync(MAPS).filter((d) => /^[a-z0-9-]+$/.test(d) && !projects.has(d) && !deletedMaps.has(d)).sort() : [];
    return [...projects, ...names.map((d) => [d, mapCalled(d)])];
  };
  return Object.assign(maps, { deletedMaps, saveDeleted, isPinned, setPinned, connectedMap, projects, folders, aliases, nameOf, openFolder, remembered, addProject, named, freeName, mapCalled, trashRecords, everyMap });
}
