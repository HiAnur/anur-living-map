// What a map answers to read it, at <map address>/api/...: the map, its background maps, its file to share,
// plan.md, its versions, the rules a chat follows, and the outbox. True when the path was one of them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describeMap } from './map-context.js';
import { inlineModules } from './page-modules.js';
import { forArea, sharedState, withoutActions, withoutRepos } from './sharing.js';

const DIR = import.meta.dirname;

/**
 * @param {{ getState: () => any, getHistory: () => any[], contextMaps: ((who: any) => any[]) | null, name: string,
 *   project: string, mapName: (folder: any) => string, chatRules: (base: any) => string, address: () => string,
 *   rulesSeen: Map<string, string>, OUTBOX: string, HIST: string, hiddenFor?: (who: string | null) => Set<string> }} deps
 *   `hiddenFor`: the repos someone may not read on GitHub (no one: a guest), cut from all they read
 */
export function readRoutes({ getState, getHistory, contextMaps, name, project, mapName, chatRules, address, rulesSeen, OUTBOX, HIST, hiddenFor = () => new Set() }) {
  /** @param {any} req @param {any} res @param {string} p @param {{ who: any, role: any, guest: boolean }} asker */
  return (req, res, p, { who, role, guest }) => {
  // someone who sees one area reads only what belongs to it (forArea in sharing.js)
  const sees = !guest && who ? getState().people?.find((/** @type {any} */ x) => x.id === who)?.sees : undefined, oneArea = !!sees && sees !== 'all';
  // and the repos they may not read on GitHub are left out of everything they read (withoutRepos in sharing.js)
  const hidden = hiddenFor(guest ? null : who);
  if (p === '/api/context-options' && req.method === 'GET') {
    const maps = (contextMaps?.(who) || []).filter((/** @type {any} */ m) => m.allowed()).map((/** @type {any} */ m) => {
      const d = describeMap(m.id,m.snapshot(),who);
      return {id:m.id,title:d.name,boxes:d.counts.boxes};
    });
    res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({maps})); return true;
  }
  if (p === '/api/context-description' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(describeMap(name || mapName(project) || 'map', withoutRepos(getState(), hidden), who))); return true;
  }
  if (p === '/api/state') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(sharedState(getState(), role === 'owner', guest, who, hidden))); return true; }
  // Share as a file: the map's page with the map's own data written into it, named <title>.html. It opens on its
  // own anywhere, drawn from that data, and POST /api/maps/load brings the same data back as a map here
  if (p === '/api/file') {
    const exported = sharedState(getState(), false, guest, who, hidden); exported.nodes = withoutActions(exported.nodes);
    const data = JSON.stringify(exported).replace(/<\//g, '<\\/');
    const html = inlineModules(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), (f) => fs.readFileSync(path.join(DIR, f), 'utf8'))
      .replace('</head>', `<meta name="lm-file" content="${new Date().toISOString()}">\n<script id="lm-data" type="application/json">${data}</script>\n</head>`);
    const file = `${String(getState().title || 'map').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'map'}.html`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file)}` }).end(html);
    return true;
  }
  // the plan.md Claude wrote for this map, read from the repo's root
  if (p === '/api/planmd') {
    const f = project && path.join(project, 'plan.md');
    if (!f || !fs.existsSync(f)) res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Claude has not written plan.md yet. It appears here once it has.');
    else res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(fs.readFileSync(f));
    return true;
  }
  // the map's versions, newest first, and one version's boxes, lines and questions
  // a change's own words can quote a comment or an answer, so someone who sees one area reads only who changed it
  if (p === '/api/history') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(oneArea ? getHistory().map((/** @type {any} */ h) => ['start', 'save'].includes(h.kind) ? h : { ...h, what: `${h.by || 'Someone'} changed the map` }) : getHistory())); return true; }
  const ver = p.match(/^\/api\/history\/(\w+)$/), vfile = ver && getHistory().some((/** @type {any} */ h) => h.id === ver[1]) && path.join(HIST, `${ver[1]}.json`);
  if (ver) {
    if (!vfile || !fs.existsSync(vfile)) { res.writeHead(404).end(); return true; }
    // an earlier version is cut to the area of whoever looks at it now, like the map itself
    const old = () => withoutRepos(JSON.parse(fs.readFileSync(vfile, 'utf8')), hidden);
    const content = oneArea ? JSON.stringify(forArea(old(), sees)) : hidden.size ? JSON.stringify(old()) : fs.readFileSync(vfile);
    res.writeHead(200, { 'content-type': 'application/json' }).end(content); return true;
  }
  // with ?session=, that chat now has these rules, so its next message carries only the news
  if (p === '/api/rules') {
    const rules = chatRules(address()), session = new URL(req.url, 'http://x').searchParams.get('session');
    if (session && rules) rulesSeen.set(session, crypto.createHash('sha1').update(rules).digest('hex'));
    res.writeHead(200, { 'content-type': 'text/plain' }).end(rules + '\n'); return true;
  }
  // the outbox is what the map tells its chat, in full: a chat reads it, not someone who sees one area
  if (p === '/api/outbox' && oneArea) { res.writeHead(403).end(); return true; }
  if (p === '/api/outbox') { res.writeHead(200, { 'content-type': 'text/plain' }).end(fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8') : ''); return true; }
    return false;
  };
}
