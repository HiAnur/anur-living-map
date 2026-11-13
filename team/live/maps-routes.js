// The list of maps, at the server's own /api/...: a new map from a prompt, a meeting's map (meeting.js), a map file loaded, Trash (move, list,
// restore), a pin, background from other maps, the maps a person may open, and a code folder added from a chat. Each
// route answers with the response, and true when it answered.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { contextReader } from './map-context.js';
import { body, jsonBody } from './request.js';
import { localTool } from './sharing.js';

/**
 * @param {{ maps: ReturnType<typeof import('./map-list.js').mapList>, DIR: string, PROJECT: string, PROJECTS: string,
 *   mapName: (folder: any) => string, DEMO?: boolean }} deps `DEMO`: the server only plays the story, so adds no code folder
 */
export function mapsRoutes({ maps, DIR, PROJECT, PROJECTS, mapName, DEMO = false }) {
  const { deletedMaps, saveDeleted, isPinned, setPinned, projects, folders, aliases, nameOf, openFolder, remembered, addProject, named, freeName, mapCalled, trashRecords, everyMap } = maps;
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any, cookie?: any) => any} json */
  const answer = async (req, res, url, who, json) => {
    // a new map from a prompt on the list of maps: a blank canvas named after the prompt, and a new Claude Code
    // session in the Claude app drawing it, for the person who asked, signed in
    if (url.pathname === '/api/newmap' && req.method === 'POST') {
      if (!who) return json(401, { error: 'Sign in first.' });
      let /** @type {any} */ a = await jsonBody(req, {});
      if (a.blank === true) {
        // a map that builds on a system map: one the asker may open, drawn from code
        let buildsOn;
        if (a.buildsOn !== undefined) {
          const base = everyMap().find(([n]) => n === String(a.buildsOn))?.[1];
          if (!base || !base.allowed(who, req) || !base.summary().system) return json(400, { error: 'That system map is not one you can open.' });
          buildsOn = { name: String(a.buildsOn), title: String(base.summary().title || a.buildsOn) };
        }
        const name = freeName('Untitled map');
        mapCalled(name).blank({ buildsOn, by: who });
        return json(200, { name, href: `/${name}/` });
      }
      const prompt = String(a.prompt || '').trim().slice(0, 4000);
      if (!prompt) return json(400, { error: 'Say what the map is about.' });
      const name = freeName(prompt);
      mapCalled(name).build({ prompt, by: who });
      return json(200, { name, href: `/${name}/` });
    }
    // A meeting drawn live, from the Living Map Recorder on this Mac (or a signed-in person): a new map named after
    // it, drawn by its own chat as what was said arrives. `by` is who records it, whose pane follows that chat;
    // a signed-in person is always themself.
    //   POST /api/meetings {title?, app?, by}            → {name, title, href}
    //   POST /api/meetings/import {title?, text, me?, by} → {name, title, href}, a transcript pasted afterwards
    //   POST /api/meetings/<name>/segments {segments}    → {ok, count}
    //   POST /api/meetings/<name>/end                    → {ok}
    if (url.pathname.startsWith('/api/meetings') && req.method === 'POST') {
      if (!who && !localTool(req)) return json(401, { error: 'Sign in first.' });
      const /** @type {any} */ a = await jsonBody(req, {});
      const by = who || String(a.by || '').trim().slice(0, 60);
      const parts = url.pathname.split('/').slice(3);
      if (parts.length === 0 || (parts.length === 1 && parts[0] === 'import')) {
        if (!by) return json(400, { error: 'Say who is recording the meeting, as "by".' });
        const app = String(a.app || '').trim().slice(0, 40), imported = parts[0] === 'import';
        const when = new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const title = String(a.title || '').trim().slice(0, 120) || `${imported ? 'Imported meeting' : `Meeting${app ? ` on ${app}` : ''}`}, ${when}`;
        const name = freeName(title);
        const map = mapCalled(name);
        if (imported) {
          const r = map.importMeeting({ title, text: String(a.text || ''), me: String(a.me || ''), by });
          if (r.error) { map.close(); named.delete(name); return json(400, { error: r.error }); }
        } else map.startMeeting({ title, app, by });
        return json(200, { name, title, href: `/${name}/` });
      }
      const [name, step] = parts, map = parts.length === 2 && /^[a-z0-9-]+$/.test(name) ? everyMap().find(([n]) => n === name)?.[1] : null;
      if (!map || !map.meeting || (who && !map.allowed(who, req))) return json(404, { error: 'No meeting map with that name.' });
      if (step === 'segments') {
        const r = map.meeting.add(a.segments);
        return r.error ? json(400, { error: r.error }) : json(200, { ok: true, count: r.count });
      }
      if (step === 'end') {
        const r = map.meeting.end();
        return r.error ? json(400, { error: r.error }) : json(200, { ok: true });
      }
      return json(404, { error: 'No such meeting route.' });
    }
    // Load a map file: the data a shared file carries (Share as a file) becomes a map here, named after its title,
    // exactly as it was saved, and opens
    if (url.pathname === '/api/maps/load' && req.method === 'POST') {
      if (!who) return json(401, { error: 'Sign in first.' });
      let s = null; try { s = JSON.parse(JSON.parse(await body(req)).data); } catch { /* not a map file: s stays null and the answer says so */ }
      if (!s || typeof s !== 'object' || !Array.isArray(s.nodes) || !Array.isArray(s.edges)) return json(400, { error: 'Not a map file. Share as a file on a map makes one.' });
      // the map belongs to whoever loads it, whoever the file says made it
      delete s.linkSharing; s.admins = [who];
      const name = freeName(String(s.title || 'map'));
      const dir = path.join(DIR, 'maps', name);
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
      mapCalled(name);
      return json(200, { name, href: `/${name}/` });
    }
    // Archive only the map data, never its code folder. A tombstone also prevents old URLs and restarts recreating it.
    if (['/api/maps/trash', '/api/maps/delete'].includes(url.pathname) && req.method === 'POST') {
      if (!who) return json(401, { error: 'Sign in first.' });
      if (req.headers.origin !== `http://${req.headers.host}` || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(403, { error: 'Open Living Map on this Mac to move a map to Trash.' });
      let /** @type {any} */ a = await jsonBody(req, {});
      const name = String(a.name || '');
      if (!/^[a-z0-9-]+$/.test(name) || deletedMaps.has(name)) return json(404, { error: 'That map is no longer in your list. Check Trash.' });
      const project = folders.get(name), dir = project ? path.join(project, '.living-map') : path.join(DIR, 'maps', name);
      if (!projects.has(name) && !fs.existsSync(dir)) return json(404, { error: 'That map is no longer in your list. Check Trash.' });
      const map = projects.get(name) || mapCalled(name);
      if (!map.canDelete(who)) return json(403, { error: 'Only a map owner can move this map to Trash.' });
      const bin = path.join(DIR, 'maps', '.deleted'), archive = path.join(bin, `${name}-${crypto.randomUUID()}`);
      try {
        fs.mkdirSync(bin, { recursive: true });
        fs.renameSync(dir, archive);
        try {
          fs.writeFileSync(path.join(archive, 'trash.json'), JSON.stringify({ name, project: project || '', at: Date.now() }));
          deletedMaps.add(name); saveDeleted();
        }
        catch (error) { deletedMaps.delete(name); fs.renameSync(archive, dir); throw error; }
      } catch { return json(500, { error: 'Could not move the map to Trash. Try again.' }); }
      map.close(); named.delete(name); projects.delete(name); folders.delete(name);
      for (const [own, to] of aliases) if (to === name) aliases.delete(own);
      if (map === maps.main) maps.main = null;
      return json(200, { name, trashId: path.basename(archive) });
    }
    if (url.pathname === '/api/maps/trash' && req.method === 'GET') {
      if (!who) return json(401, { error: 'Sign in first.' });
      return json(200, trashRecords(who).map(({ id, name, title, at }) => ({ id, name, title, at })));
    }
    if (url.pathname === '/api/maps/restore' && req.method === 'POST') {
      if (!who) return json(401, { error: 'Sign in first.' });
      if (req.headers.origin !== `http://${req.headers.host}` || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(403, { error: 'Open Living Map on this Mac to restore a map.' });
      let /** @type {any} */ a = await jsonBody(req, {});
      const record = trashRecords(who).find((r) => r.id === a.id);
      if (!record) return json(404, { error: 'That map is not in your Trash.' });
      const { name, project, archive } = record, home = project ? path.join(project, '.living-map') : path.join(DIR, 'maps', name);
      if (projects.has(name) || (!deletedMaps.has(name) && named.has(name)) || fs.existsSync(path.join(home, 'state.json'))) return json(409, { error: 'A map already uses this address. Your trashed map is kept.' });
      if (project && !fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) return json(409, { error: 'The code folder is no longer available. Your trashed map is kept.' });
      const files = fs.readdirSync(archive).filter((f) => f !== 'trash.json' && !(f === 'server.log' && fs.existsSync(path.join(home, f))));
      if (files.some((f) => fs.existsSync(path.join(home, f)))) return json(409, { error: 'Existing files would be replaced. Your trashed map is kept.' });
      const moved = [], wasDeleted = deletedMaps.has(name);
      try {
        fs.mkdirSync(home, { recursive: true });
        for (const f of files) { fs.renameSync(path.join(archive, f), path.join(home, f)); moved.push(f); }
        deletedMaps.delete(name); saveDeleted();
        fs.writeFileSync(path.join(archive, 'trash.json'), JSON.stringify({ name, project, at: record.at, restored: true }));
      } catch {
        for (const f of moved.reverse()) fs.renameSync(path.join(home, f), path.join(archive, f));
        if (wasDeleted) { deletedMaps.add(name); saveDeleted(); }
        return json(500, { error: 'The map could not be restored. Try again.' });
      }
      if (project) openFolder(name, project, home);
      else mapCalled(name);
      return json(200, { name, title: record.title, href: `/${name}/` });
    }
    // Pin a map to the top of your own list, or take the pin off. Only a map you may open can be pinned.
    if (url.pathname === '/api/maps/pin' && req.method === 'POST') {
      if (!who) return json(401, { error: 'Sign in first.' });
      if (req.headers.origin !== `http://${req.headers.host}` || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(403, { error: 'Open Living Map on this Mac to pin a map.' });
      let /** @type {any} */ a = await jsonBody(req, {});
      const name = String(a.name || ''), on = a.pinned === true, map = everyMap().find(([n]) => n === name)?.[1];
      if (!map || !map.allowed(who, req)) return json(404, { error: 'That map is no longer in your list.' });
      try { setPinned(who, name, on); } catch { return json(500, { error: on ? 'Could not pin the map. Try again.' : 'Could not unpin the map. Try again.' }); }
      return json(200, { name, pinned: on });
    }
    if (url.pathname === '/api/map-context' && req.method === 'GET') {
      if ((!who && !localTool(req)) || url.searchParams.has('share')) return json(403, { error: 'Sign in to discover other maps.' });
      const read = contextReader({ who, maps: () => everyMap().map(([id, map]) => ({ id, allowed: () => map.allowed(who, req), snapshot: () => map.snapshotFor ? map.snapshotFor(who || null) : map.snapshot() })) });
      try {
        return json(200, read(url.searchParams.get('tool') || 'list_maps', { id: url.searchParams.get('id'), query: url.searchParams.get('query') || '', offset: Number(url.searchParams.get('offset') || 0),
          ...(url.searchParams.has('sections') ? {sections:/** @type {string} */ (url.searchParams.get('sections')).split(',')} : {}) }));
      } catch (/** @type {any} */ e) { return json(400, { error: e.message }); }
    }
    // a chat opening the map from a clone finds the system map drawn from that repo, and the repo's box on it
    if (url.pathname === '/api/maps/system-of' && req.method === 'GET') {
      if ((!who && !localTool(req)) || url.searchParams.has('share')) return json(403, { error: 'Sign in to discover other maps.' });
      const folder = path.resolve(String(url.searchParams.get('folder') || '/'));
      for (const [name, m] of everyMap()) {
        if (!m.allowed(who, req)) continue;
        const box = m.repoBox?.(folder);
        if (box) return json(200, { name, box, href: `/${name}/?brain-box=${encodeURIComponent(box)}` });
      }
      return json(200, {});
    }
    if (url.pathname === '/api/maps') {
      const list = everyMap().filter(([, m]) => m.allowed(who, req)).map(([name, m]) => ({ name, href: `/${name}/`, deletable: m.canDelete(who), pinned: isPinned(who, name), ...m.summary() }));
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
    }
    // a chat opening the map from another code folder adds that folder to the list, and it stays there
    if (!DEMO && url.pathname === '/api/projects' && req.method === 'POST') {
      let /** @type {any} */ a = await jsonBody(req, {});
      const folder = a.folder ? path.resolve(String(a.folder)) : '', name = folder ? nameOf(folder) : '';
      if (!folder || !addProject(folder, true)) return json(400, { error: folders.has(name) ? `Another folder called ${name} is already on this map.` : 'Not a folder this map can draw.' });
      if (folder !== PROJECT && !remembered().includes(folder)) fs.writeFileSync(PROJECTS, JSON.stringify([...remembered(), folder], null, 1));
      return json(200, { name, href: `/${name}/` });
    }
    return false;
  };
  /** @param {any} req @param {any} res @param {URL} url @param {any} who @param {(code: any, data: any, cookie?: any) => any} json @returns {Promise<boolean>} */
  return async (req, res, url, who, json) => (await answer(req, res, url, who, json)) !== false;
}
