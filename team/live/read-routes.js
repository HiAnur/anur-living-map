// What a map answers to read it, at <map address>/api/...: the map, its background maps, its file to share,
// plan.md, its versions, the rules a chat follows, and the outbox. True when the path was one of them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describeMap } from './map-context.js';
import { sharedState, withoutActions } from './sharing.js';

const DIR = import.meta.dirname;

/**
 * @param {{ getState: () => any, getHistory: () => any[], contextMaps: ((who: any) => any[]) | null, name: string,
 *   project: string, mapName: (folder: any) => string, chatRules: (base: any) => string, address: () => string,
 *   rulesSeen: Map<string, string>, OUTBOX: string, HIST: string }} deps
 */
export function readRoutes({ getState, getHistory, contextMaps, name, project, mapName, chatRules, address, rulesSeen, OUTBOX, HIST }) {
  /** @param {any} req @param {any} res @param {string} p @param {{ who: any, role: any, guest: boolean }} asker */
  return (req, res, p, { who, role, guest }) => {
  if (p === '/api/context-options' && req.method === 'GET') {
    const maps = (contextMaps?.(who) || []).filter((/** @type {any} */ m) => m.allowed()).map((/** @type {any} */ m) => {
      const d = describeMap(m.id,m.snapshot(),who);
      return {id:m.id,title:d.name,boxes:d.counts.boxes};
    });
    res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({maps})); return true;
  }
  if (p === '/api/context-description' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(describeMap(name || mapName(project) || 'map', getState(), who))); return true;
  }
  if (p === '/api/state') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(sharedState(getState(), role === 'owner', guest))); return true; }
  // Share as a file: the map's page with the map's own data written into it, named <title>.html. It opens on its
  // own anywhere, drawn from that data, and POST /api/maps/load brings the same data back as a map here
  if (p === '/api/file') {
    const exported = sharedState(getState(), false, guest); exported.nodes = withoutActions(exported.nodes);
    const data = JSON.stringify(exported).replace(/<\//g, '<\\/');
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
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
  if (p === '/api/history') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(getHistory())); return true; }
  const ver = p.match(/^\/api\/history\/(\w+)$/), vfile = ver && getHistory().some((/** @type {any} */ h) => h.id === ver[1]) && path.join(HIST, `${ver[1]}.json`);
  if (ver) { if (!vfile || !fs.existsSync(vfile)) res.writeHead(404).end(); else res.writeHead(200, { 'content-type': 'application/json' }).end(fs.readFileSync(vfile)); return true; }
  // with ?session=, that chat now has these rules, so its next message carries only the news
  if (p === '/api/rules') {
    const rules = chatRules(address()), session = new URL(req.url, 'http://x').searchParams.get('session');
    if (session && rules) rulesSeen.set(session, crypto.createHash('sha1').update(rules).digest('hex'));
    res.writeHead(200, { 'content-type': 'text/plain' }).end(rules + '\n'); return true;
  }
  if (p === '/api/outbox') { res.writeHead(200, { 'content-type': 'text/plain' }).end(fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8') : ''); return true; }
    return false;
  };
}
