import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { checkCommand, COMMANDS } from './commands.js';
import { openMap } from './server.js';

// Each action's schema: what the page sends today passes, what a handler cannot use is refused with the field
// named, and a map answers that with 400 before anything changes.
describe('action schemas', () => {
  it('pass what the page sends', () => {
    for (const a of [
      { type: 'actionstart', id: 'research', intent: 'Find pilot users' },
      { type: 'actionanswer', id: 'research', answer: 'Customers' },
      { type: 'actioncontinue', id: 'research', revision: '3', answer: 'Go on' },
      { type: 'actionexecute', id: 'research', revision: 7 },
      { type: 'autosave', on: false },
      { type: 'contextmap', id: 'gtm', include: true },
      { type: 'describemap', description: 'What this map is for' },
      { type: 'rename', title: 'Launch' },
      { type: 'restore', id: 'm1abc' },
      { type: 'comment', x: 120, y: -40, node: null, view: 'system', text: 'Why?' },
      { type: 'reply', id: '3', text: 'Because' },
      { type: 'resolve', id: 3 },
      { type: 'openchat', chat: '@Duy#m1' },
      { type: 'editmemory', id: 'k1', text: 'Tuesdays' },
      { type: 'forget', id: 'k1' },
      { type: 'savenow', by: 'Duy', revision: 4 },
      { type: 'newchat' }, { type: 'execute' }, { type: 'planmd' }, { type: 'reset' }, { type: 'open' }, { type: 'undo' }, { type: 'redo' },
    ]) expect(checkCommand(a), a.type).toBeNull();
  });
  it('refuse what a handler cannot use, naming the field', () => {
    expect(checkCommand({ type: 'comment', y: 4, text: 'x' })).toBe('comment needs x.');
    expect(checkCommand({ type: 'comment', x: '4', y: 4 })).toBe('comment: x must be a number.');
    expect(checkCommand({ type: 'comment', x: Infinity, y: 4 })).toBe('comment: x must be a number.');
    expect(checkCommand({ type: 'contextmap', id: 'gtm', include: 'yes' })).toBe('contextmap: include must be true or false.');
    expect(checkCommand({ type: 'describemap', description: 42 })).toBe('describemap: description must be text.');
    expect(checkCommand({ type: 'actionbox' })).toBe('actionbox needs id.');
    expect(checkCommand({ type: 'reply', id: {}, text: 'x' })).toBe('reply: id must be an id.');
    expect(checkCommand({ type: 'restore', id: '' })).toBe('restore: id must be an id.');
    expect(checkCommand({ type: 'autosave', on: 'off' })).toBe('autosave: on must be true or false.');
  });
  it('leave an action with no schema yet to its handler', () => {
    expect(checkCommand({ type: 'move', id: 'a', x: 'anything' })).toBeNull();
    expect(checkCommand({ type: 'nothing-like-it' })).toBeNull();
  });
  it('name only kinds the check knows', () => {
    for (const [type, schema] of Object.entries(COMMANDS)) for (const spec of Object.values(schema))
      expect(['id', 'text', 'string', 'number', 'boolean', 'array', 'object', 'any'], `${type}: ${spec}`).toContain(spec.replace(/\?$/, ''));
  });
});

describe('a map refusing a malformed action', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-commands-'));
  const map = openMap({ name: 'test-map', home, memory: true, initialState: { title: 'Launch', nodes: [], edges: [], people: [{ id: 'Duy', sees: 'all' }], calls: [], threads: {}, log: [] } });
  /** @param {unknown} a */
  const act = async (a) => {
    const req = Object.assign(Readable.from([JSON.stringify(a)]), { method: 'POST', url: '/api/act', headers: { host: 'localhost', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } });
    let status = 0, text = '';
    const res = { writeHead(/** @type {number} */ s) { status = s; return res; }, end(/** @type {string} */ t = '') { text = t; return res; }, setHeader() {} };
    await map.handle(req, res, '/api/act', /** @type {any} */ ('Duy'));
    return { status, body: text ? JSON.parse(text) : null };
  };
  it('answers 400 with the field, and changes nothing', async () => {
    expect(await act({ type: 'comment', y: 1, text: 'Why?' })).toEqual({ status: 400, body: { error: 'comment needs x.' } });
    expect(map.snapshot().comments ?? []).toEqual([]);
  });
  it('still does a well-formed one', async () => {
    expect((await act({ type: 'comment', x: 10, y: 20, text: 'Why?' })).status).toBe(200);
    expect(map.snapshot().comments).toHaveLength(1);
    map.close();
  });
});
