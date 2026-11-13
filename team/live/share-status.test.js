import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { read } from './map.harness.js';
import { openMap } from './server.js';

// Share says where a map is kept for everyone who opens it, so no one is left on "Checking sharing status…"; only
// an owner is sent the online copy's link and what went wrong with it.
let dir = '', was = process.env.LIVING_MAP_CLOUD_CONFIG;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-share-status-'));
  fs.writeFileSync(path.join(dir, 'cloud.json'), JSON.stringify({ url: 'https://maps.example', publishKey: 'b'.repeat(64) }));
  process.env.LIVING_MAP_CLOUD_CONFIG = path.join(dir, 'cloud.json');
});
afterEach(() => {
  if (was === undefined) delete process.env.LIVING_MAP_CLOUD_CONFIG; else process.env.LIVING_MAP_CLOUD_CONFIG = was;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The cloud status the map's live stream sends someone when they open it. @param {any} map @param {string} who */
const cloudSent = async (map, who) => {
  const { text } = await read(map, who, '/api/events');
  const line = text.split('event: cloud\ndata: ')[1];
  return line ? JSON.parse(line.split('\n')[0]) : null;
};

it('sends every member where the map is kept, and only an owner its link and errors', async () => {
  const map = openMap({ name: 'shared', home: path.join(dir, 'map'), initialState: { title: 'Shared', nodes: [], edges: [], calls: [], threads: {},
    people: [{ id: 'Duy', role: 'Admin', sees: 'all', joined: '2026-01-01' }, { id: 'Sam', sees: 'all', joined: '2026-01-01' }] } });
  try {
    const owner = await cloudSent(map, 'Duy'), member = await cloudSent(map, 'Sam');
    expect(owner).toMatchObject({ configured: true, published: false });
    expect(Object.keys(owner)).toEqual(expect.arrayContaining(['url', 'error']));
    expect(member).toEqual({ configured: true, published: false });
  } finally { map.close(); }
});
