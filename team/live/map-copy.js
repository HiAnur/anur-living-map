// A duplicate keeps the map's content and code sources, with its own owner, history and connections.
// Copy only the system drawing's supporting files: chats, cloud credentials and pending work belong to the original.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { allBoxesOf } from './map-walk.js';

/** @param {{ state: MapState, title: string, who: string, source: string, dir: string }} o */
export function copyMap({ state, title, who, source, dir }) {
  const copy = structuredClone(state);
  copy.title = copy.renamed = title;
  Object.assign(copy, { admins: [who], people: [], removedPeople: [], linkSharing: { mode: 'restricted' }, linked: [], said: {}, threads: {}, proposals: [] });
  for (const key of ['starting', 'redraw', 'meeting', 'saves', 'itemNotes']) delete copy[key];
  // An Action in the copy starts its own execution chat, and needs its own approval to run unattended.
  const boxes = [...allBoxesOf(copy), ...(copy.archived || []).flatMap((/** @type {any} */ a) => a.box ? allBoxesOf({ nodes: [a.box] }) : [])];
  for (const n of boxes) if (n.action) {
    const a = n.action;
    a.id = crypto.randomUUID();
    for (const key of ['session', 'cwd', 'auto', 'autoPrepare', 'held', 'since', 'progress']) delete a[key];
    if (['gathering', 'running', 'blocked', 'unconfirmed', 'sent'].includes(a.stage)) {
      a.stage = a.brief ? 'ready' : 'draft';
      for (const key of ['completion', 'error', 'turns']) delete a[key];
    }
  }
  if (copy.drawing?.status === 'running') {
    copy.drawing.status = 'stopped';
    copy.drawing.error = 'The original map was still drawing when this copy was made.';
    for (const p of copy.drawing.progress || []) if (!['done', 'failed'].includes(p.stage)) p.stage = 'cancelled';
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ['system-facts.json', 'system-drawn.json', 'system-report.json', 'system-folders.json']) {
    const from = path.join(source, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(copy));
}
