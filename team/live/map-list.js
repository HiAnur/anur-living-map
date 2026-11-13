// The maps this server keeps: each code folder's own (projects.json remembers the ones added), the maps named
// by address under maps/, the ones moved to Trash, which old addresses and restarts must not bring back, and the
// ones each person pinned to the top of their own list.
// `main` is the map at the server's own address: the first code folder's, or the demo without one.
import fs from 'node:fs';
import path from 'node:path';

import { managesAccess, removedFrom } from './access.js';

/**
 * @param {{ openMap: (options: any) => any, DIR: string, PROJECT: string, PROJECTS: string,
 *   mapName: (folder: any) => string, adminsOf?: (state: any, project: string) => string[] }} deps
 * `adminsOf`: who owns a map, by its state and its code folder ('' for a map with none)
 */
export function mapList({ openMap, DIR, PROJECT, PROJECTS, mapName, adminsOf = () => [] }) {
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
    const own = options.name || (options.project ? mapName(options.project) : '');
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
  /** @type {{ main: any }} */ const maps = { main: PROJECT && deletedMaps.has(mapName(PROJECT)) ? null : connectedMap({ project: PROJECT, home: PROJECT ? path.join(PROJECT, '.living-map') : DIR }) };
  // every code folder this server draws, by folder name: the one it started with, then each added since
  // a map's address is its folder's name in lowercase letters, digits and dashes (AnurWebApp -> /anurwebapp/)
  const projects = new Map(PROJECT && maps.main ? [[mapName(PROJECT), maps.main]] : []);
  const folders = new Map(PROJECT && maps.main ? [[mapName(PROJECT), PROJECT]] : []);
  const remembered = () => { try { return JSON.parse(fs.readFileSync(PROJECTS, 'utf8')); } catch { return []; } };
  const addProject = (/** @type {any} */ folder, restore = false) => {
    const name = mapName(folder);
    if (deletedMaps.has(name) && !restore) return false;
    if (folders.has(name)) return folders.get(name) === folder;
    if (!/^[a-z0-9-]+$/.test(name) || !fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return false;
    if (deletedMaps.delete(name)) saveDeleted();
    projects.set(name, connectedMap({ project: folder, home: path.join(folder, '.living-map') }));
    if (folder === PROJECT) maps.main = projects.get(name);
    folders.set(name, folder);
    return true;
  };
  if (PROJECT) for (const f of remembered()) addProject(f);
  const named = new Map();
  // a name no map here has yet, from the first words of what it is about (a prompt, a shared file's title)
  /** @param {any} text */
  function freeName(text) {
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 4).join('-').slice(0, 40) || 'map';
    const taken = (/** @type {any} */ n) => deletedMaps.has(n) || projects.has(n) || named.has(n) || fs.existsSync(path.join(DIR, 'maps', n)) || fs.existsSync(path.join(DIR, n)) || n === 'api' || (PROJECT && n === mapName(PROJECT));
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
  return Object.assign(maps, { deletedMaps, saveDeleted, isPinned, setPinned, connectedMap, projects, folders, remembered, addProject, named, freeName, mapCalled, trashRecords, everyMap });
}
