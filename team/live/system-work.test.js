import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoOf, workFinder } from './system-work.js';

// Where an Action on a system map works: its box's repo, inherited down the boxes inside it, in a clone on this Mac.

const dirs = /** @type {string[]} */ ([]);
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-work-')); dirs.push(d); return d; };
/** A clone whose origin is `url`, at `dir`. @param {string} dir @param {string} url */
const cloneAt = (dir, url) => { fs.mkdirSync(dir, { recursive: true }); execFileSync('git', ['init', '-q', dir]); execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', url]); return dir; };

describe('the repo a box belongs to', () => {
  it('is its own, or the nearest box above it that names one, at any depth', () => {
    const deep = { id: 'fn', label: 'GetUser' };
    const group = { id: 'users', label: 'Users API', inside: { nodes: [deep], edges: [] } };
    const svc = { id: 'api', label: 'api-service', source: { kind: 'code', repo: 'api-service' }, inside: { nodes: [group], edges: [] } };
    const outside = { id: 'stripe', label: 'Stripe' };
    const state = { nodes: [svc, outside], edges: [] };
    expect(repoOf(state, deep)).toBe('api-service');
    expect(repoOf(state, group)).toBe('api-service');
    expect(repoOf(state, { ...deep, source: { kind: 'code', repo: 'own-repo' } })).toBe('own-repo');
    expect(repoOf(state, outside)).toBeNull();
  });
});

describe('finding where to work', () => {
  it('finds your clone by its origin, whatever its folder is called', () => {
    const home = tmp();
    cloneAt(path.join(home, 'workspace', 'other'), 'git@github.com:Shop/other.git');
    const mine = cloneAt(path.join(home, 'workspace', 'shop-api-local'), 'git@github.com:Shop/api.git');
    const finder = workFinder({ home, data: tmp() });
    expect(finder.cloneOf('Shop', 'api')).toBe(mine);
    expect(finder.cloneOf('shop', 'API')).toBe(mine);
    expect(finder.cloneOf('Shop', 'api2')).toBeNull();
    // of two clones of one repo, the one named after it
    const named = cloneAt(path.join(home, 'code', 'api'), 'https://github.com/Shop/api');
    expect(workFinder({ home, data: tmp() }).cloneOf('Shop', 'api')).toBe(named);
  });
  it('clones once for a build when there is no clone, and only for a build', async () => {
    const data = tmp(), urls = /** @type {string[]} */ ([]);
    const finder = workFinder({ home: tmp(), data, clone: async (url, to) => { urls.push(url); cloneAt(to, url); return null; } });
    expect(await finder.workIn('Shop', 'api', false)).toEqual({ error: '' });
    expect(urls).toEqual([]);
    expect(await finder.workIn('Shop', 'api', true)).toEqual({ cwd: path.join(data, 'work', 'Shop', 'api') });
    expect(await finder.workIn('Shop', 'api', true)).toEqual({ cwd: path.join(data, 'work', 'Shop', 'api') });
    expect(urls).toEqual(['https://github.com/Shop/api.git']);
  });
  it('says how to go on when cloning fails', async () => {
    const finder = workFinder({ home: tmp(), data: tmp(), clone: async () => 'Authentication failed' });
    expect(await finder.workIn('Shop', 'api', true)).toEqual({ error: expect.stringMatching(/cloning it with your git sign-in failed: Authentication failed\. Clone it into ~\/workspace/) });
  });
});
