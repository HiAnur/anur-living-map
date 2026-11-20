// Folders organize map addresses, rather than moving map data or changing anybody's links. Each person keeps
// their own tree. Notes and maps are the same stored document, with a preferred opening view.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { jsonBody } from './request.js';

/** @typedef {{revision: number, folders: {id: string, title: string, parent: string, created?: number, at?: number}[], files: Record<string, {parent: string, view: string}>}} Library */
/** @param {{maps: ReturnType<typeof import('./map-list.js').mapList>}} deps */
export function libraryRoutes({ maps }) {
  const file = path.join(maps.MAPS, '.library.json');
  /** @returns {Record<string, Library>} */
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (/** @type {any} */ e) { if (e.code === 'ENOENT') return {}; throw e; }
  }
  /** @param {any} req @param {any} _res @param {URL} url @param {string | null} who @param {(code: number, data: any) => any} json */
  return async (req, _res, url, who, json) => {
    if (url.pathname !== '/api/library') return false;
    const done = (/** @type {number} */ code, /** @type {any} */ data) => { json(code, data); return true; };
    if (!who || url.searchParams.has('share')) return done(403, { error: 'Open your files on this Mac.' });
    try {
      const a = req.method === 'POST' ? await jsonBody(req, {}) : {};
      const all = read(), key = `person:${who}`;
      const library = all[key] || { revision: 0, folders: [], files: {} };
      const when = fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs || Date.now();
      for (const f of library.folders) { f.created ??= when; f.at ??= f.created; }
      const files = maps.everyMap().filter(([, m]) => m.allowed(who, req)).map(([name, m]) => {
        const project = maps.folders.get(name);
        return { ...m.summary(), name, href: `/${name}/`, bookmarked: maps.isPinned(who, name), deletable: m.canDelete(who),
          folder: path.resolve(project || maps.MAPS, project ? '.living-map' : name),
          parent: library.folders.some((f) => f.id === library.files[name]?.parent) ? library.files[name].parent : '', view: library.files[name]?.view || 'map' };
      });
      if (req.method === 'GET') return done(200, { revision: library.revision, folders: library.folders, files });
      if (req.method !== 'POST') return done(405, { error: 'Use GET or POST.' });
      if (req.headers.origin !== `http://${req.headers.host}` || !String(req.headers['content-type'] || '').startsWith('application/json')) return done(403, { error: 'Open your files on this Mac.' });
      if (a.revision !== library.revision) return done(409, { error: 'Your folders changed in another window. Try again.' });
      const parent = typeof a.parent === 'string' ? a.parent : '';
      if (parent && !library.folders.some((f) => f.id === parent)) return done(400, { error: 'That folder no longer exists.' });
      const title = typeof a.title === 'string' ? a.title.trim() : '';
      const folder = library.folders.find((f) => f.id === a.id);
      /** @type {any} */ let result = {};
      if (a.op === 'createfolder' || a.op === 'renamefolder') {
        if (!title || title.length > 80 || /[/\\\x00-\x1f]/.test(title)) return done(400, { error: 'Use a folder name of up to 80 letters without slashes.' });
        if (a.op === 'renamefolder' && !folder) return done(404, { error: 'That folder no longer exists.' });
        const place = folder?.parent ?? parent;
        if (library.folders.some((f) => f.id !== folder?.id && f.parent === place && f.title.toLowerCase() === title.toLowerCase())) return done(400, { error: 'A folder here already has that name.' });
        if (folder) { folder.title = title.toLowerCase(); folder.at = Date.now(); }
        else { const id = crypto.randomUUID(); library.folders.push({ id, title: title.toLowerCase(), parent, created: Date.now(), at: Date.now() }); result.id = id; }
      } else if (a.op === 'movefolder') {
        if (!folder) return done(404, { error: 'That folder no longer exists.' });
        for (let p = parent; p; p = library.folders.find((f) => f.id === p)?.parent || '') if (p === folder.id) return done(400, { error: 'A folder cannot be moved into itself.' });
        if (library.folders.some((f) => f.id !== folder.id && f.parent === parent && f.title === folder.title)) return done(400, { error: 'A folder here already has that name.' });
        folder.parent = parent; folder.at = Date.now();
      } else if (a.op === 'removefolder') {
        if (!folder) return done(404, { error: 'That folder no longer exists.' });
        if (library.folders.some((f) => f.parent === folder.id) || files.some((f) => f.parent === folder.id)) return done(400, { error: 'Move the files and folders out before deleting this folder.' });
        library.folders = library.folders.filter((f) => f.id !== folder.id);
      } else if (a.op === 'movefile') {
        if (!files.some((f) => f.name === a.name)) return done(404, { error: 'That file is no longer available.' });
        library.files[a.name] = { parent, view: ['map', 'note'].includes(a.view) ? a.view : library.files[a.name]?.view || 'map' };
      } else if (a.op === 'createfile') {
        if (!title || title.length > 60 || !['map', 'note'].includes(a.view)) return done(400, { error: 'Name your file using up to 60 letters.' });
        const name = maps.freeName(title);
        maps.mapCalled(name).blank({ by: who, title });
        library.files[name] = { parent, view: a.view };
        result = { name, href: `/${name}/?document=${a.view}` };
      } else return done(400, { error: 'Choose a folder or file action.' });
      library.revision++;
      all[key] = library;
      fs.mkdirSync(maps.MAPS, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(all)); fs.renameSync(`${file}.tmp`, file);
      return done(200, result);
    } catch (e) {
      console.error('[map] folders', e);
      return done(500, { error: 'Your folders could not be saved. Try again.' });
    }
  };
}
