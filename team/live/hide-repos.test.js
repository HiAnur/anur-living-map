import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { read, send } from './map.harness.js';
import { allBoxesOf } from './map-walk.js';
import { openMap } from './server.js';
import { PRIVATE_REPO, withoutRepos } from './sharing.js';

// A system map shows each person only the repos GitHub lets them read (#362): a private repo they may not read is
// only "A private repo", in every copy of the map they receive and in what Claude reads for them.

const system = () => ({
  title: 'Shop system', people: [], calls: [{ id: 'q1', node: 'api-users', status: 'open', for: 'Duy', ask: 'Which table?' }],
  comments: [{ id: 'c1', node: 'api-users', view: 'system-api', msgs: [{ who: 'Sam', text: 'secret detail' }] }],
  memory: [{ box: 'api-users', text: 'about users' }], log: [], threads: { '@Duy>api-users': [{ who: 'Duy', text: 'how?' }], '@Duy>system-web': [{ who: 'Duy', text: 'ok' }] },
  drawing: { status: 'done', at: 1, repos: 2, progress: [] },
  nodes: [
    { id: 'system-api', label: 'api', sub: 'Orders and users', x: 100, y: 100, source: { kind: 'code', repo: 'api' },
      inside: { nodes: [{ id: 'api-users', label: 'Users API', sub: 'GET /users', x: 90, y: 150, source: { kind: 'code', repo: 'api' } }], edges: [] } },
    { id: 'system-web', label: 'web', sub: 'The shop site', x: 400, y: 100, source: { kind: 'code', repo: 'web' } },
  ],
  edges: [{ from: 'system-web', to: 'system-api', label: 'calls GET /users' }],
  start: 'system-api',
});

describe('leaving out the repos someone may not read', () => {
  it('keeps a hidden repo\'s place, unnamed and empty, its lines without words, and nothing written about it', () => {
    const cut = withoutRepos(system(), new Set(['api']));
    expect(cut.nodes[0]).toEqual({ id: 'system-api', x: 100, y: 100, label: PRIVATE_REPO, hiddenRepo: true });
    expect(cut.nodes[1].label).toBe('web');
    expect(cut.edges).toEqual([{ from: 'system-web', to: 'system-api' }]);
    expect([cut.calls, cut.comments, cut.memory]).toEqual([[], [], []]);
    expect(Object.keys(cut.threads)).toEqual(['@Duy>system-web']);
    expect(cut.start).toBeUndefined();
    expect(JSON.stringify(cut)).not.toMatch(/Orders|Users API|GET \/users|secret detail/);
  });
  it('changes nothing when nothing is hidden', () => {
    const s = system();
    expect(withoutRepos(s, new Set())).toBe(s);
  });
});

describe('a real system map', () => {
  const dirs = /** @type {string[]} */ ([]);
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  // one private repo and one public, as the drawing recorded them from GitHub
  const open = () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-hide-')); dirs.push(home);
    fs.writeFileSync(path.join(home, 'system-folders.json'), JSON.stringify({ folders: [], repos: [{ owner: 'Shop', name: 'api', private: true }, { owner: 'Shop', name: 'web', private: false }] }));
    fs.writeFileSync(path.join(home, 'system-report.json'), JSON.stringify({ repos: [{ repo: 'api', root: '/x/api' }, { repo: 'web', root: '/x/web' }] }));
    return openMap({ name: 'shop-system', home, memory: true, initialState: system() });
  };
  it('sends someone with no GitHub link only the public repo, in the map and its downloaded copy', async () => {
    const map = open();
    // Duy has linked no GitHub account on this Mac, so a private repo stays hidden from him
    const state = JSON.parse((await read(map, 'Duy', '/api/state')).text);
    expect(state.nodes.map((/** @type {any} */ n) => n.label)).toEqual([PRIVATE_REPO, 'web']);
    expect(allBoxesOf(state).some((/** @type {any} */ n) => n.label === 'Users API')).toBe(false);
    expect((await read(map, 'Duy', '/api/file')).text).not.toContain('Users API');
    map.close();
  });
  it('refuses any change to a box in a repo the person may not read', async () => {
    const map = open();
    expect((await send(map, 'Duy', { type: 'renamebox', id: 'api-users', label: 'Mine now' })).status).toBe(400);
    expect((await send(map, 'Duy', { type: 'renamebox', id: 'system-web', label: 'Website' })).status).toBe(200);
    map.close();
  });
});
