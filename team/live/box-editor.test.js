import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Preparation answers in the background, as Claude would, without starting it: one question back.
vi.mock('./ask.js', () => ({
  askAgent: (/** @type {any} */ request) => {
    const t = setTimeout(() => request.onDone('', { tools: [], denied: [] }, { status: 'clarify', question: 'Which pilots?', choices: [] }));
    return () => clearTimeout(t);
  },
}));
const { openMap } = await import('./server.js');

// Who last changed a box is always on it: the person for what they did, Claude for what the map did in the
// background (an Action preparing or running), never left blank beside a fresh date.
const maps = /** @type {any[]} */ ([]);
afterEach(() => { for (const m of maps.splice(0)) m.close(); });
function open() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-editor-'));
  const map = openMap({ name: 'editor', home, memory: true, initialState: {
    title: 'Launch', people: [{ id: 'Duy', role: 'Admin', sees: 'all' }], calls: [], threads: {}, log: [],
    nodes: [{ id: 'web', label: 'Web', x: 0, y: 0 }], edges: [] } });
  maps.push(map);
  /** @param {any} a */
  const act = async (a) => {
    const req = Object.assign(Readable.from([JSON.stringify(a)]), { method: 'POST', url: '/api/act', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie: 'lm_session=x' } });
    let status = 0;
    const res = { writeHead(/** @type {number} */ s) { status = s; return res; }, end() { return res; }, setHeader() {}, write() {}, on() {} };
    await map.handle(req, res, '/api/act', /** @type {any} */ ('Duy'));
    return status;
  };
  const box = () => /** @type {any} */ (map.snapshot().nodes.find((/** @type {any} */ n) => n.id === 'web'));
  return { act, box };
}
const settled = () => new Promise((r) => setTimeout(r, 20));

describe('who last changed a box', () => {
  it('is the person who made it an Action box', async () => {
    const { act, box } = open();
    expect(await act({ type: 'actionbox', id: 'web' })).toBe(200);
    expect(box().action.stage).toBe('draft');
    expect(box().updatedBy).toBe('Duy');
  });
  it('is Claude once preparation answers in the background', async () => {
    const { act, box } = open();
    await act({ type: 'actionbox', id: 'web' });
    expect(await act({ type: 'actionstart', id: 'web', intent: 'Email the pilot customers' })).toBe(200);
    expect(box().updatedBy).toBe('Duy');
    await settled();
    expect(box().action.stage).toBe('clarify');
    expect(box().updatedBy).toBe('Claude');
  });
  it('is the person again for their next edit', async () => {
    const { act, box } = open();
    await act({ type: 'actionbox', id: 'web' });
    await act({ type: 'actionstart', id: 'web', intent: 'Email the pilot customers' });
    await settled();
    expect(await act({ type: 'renamebox', id: 'web', label: 'Website' })).toBe(200);
    expect(box().updatedBy).toBe('Duy');
  });
});
