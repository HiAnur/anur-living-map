import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, describe, expect, it } from 'vitest';

import { openMap } from './server.js';
import { PRIVATE_REPO, withoutRepos } from './sharing.js';
import { linkRepos } from './system-links.js';
import { traceFrom } from './system-trace.js';

// Trace a request: code follows the facts behind a box, hop by hop, across repos, and draws the steps on the box.

// an app calling the orders service, whose function reads its table and drops work on a queue a worker takes
const app = { repo: 'app', root: '', head: null, kinds: [], facts: [{ id: 'f1', kind: 'api_call', at: 'src/orders.ts:3', method: 'GET', path: '/orders/{id}' }] };
const orders = { repo: 'orders', root: '', head: null, kinds: [], facts: [
  { id: 'f1', kind: 'function', at: 'cdk.out/Orders.json#GetOrderFn', name: 'GetOrder', routes: ['GET /orders/{orderId}'],
    may: [{ services: ['dynamodb:GetItem'], on: ['OrdersTable'] }, { services: ['sqs:SendMessage'], on: ['WorkQueue'] }] },
  { id: 'f2', kind: 'table', at: 'cdk.out/Orders.json#OrdersTable', name: 'orders-table' },
  { id: 'f3', kind: 'queue', at: 'cdk.out/Orders.json#WorkQueue', name: 'work-queue' },
  { id: 'f4', kind: 'event_source', at: 'cdk.out/Orders.json#WorkMapping', from: ['WorkQueue'], functions: ['WorkerFn'] },
  { id: 'f5', kind: 'function', at: 'cdk.out/Orders.json#WorkerFn', name: 'Worker' },
] };
const store = { readings: [app, orders], links: linkRepos([app, orders]).links };

describe('tracing a request', () => {
  it('follows a call to the route another repo serves, what its function may touch, and what that sets off', () => {
    expect(traceFrom('app', ['f1'], store).steps).toEqual([
      { from: 'app', to: 'GetOrder', label: 'GET /orders/{}' },
      { from: 'GetOrder', to: 'orders-table', label: 'dynamodb:GetItem' },
      { from: 'GetOrder', to: 'work-queue', label: 'sqs:SendMessage' },
      { from: 'work-queue', to: 'Worker', label: 'triggers' },
    ]);
  });
  it('stops at a repo the asker may not read, naming neither it nor the step into it', () => {
    const { steps, repos } = traceFrom('app', ['f1'], store, new Set(['orders']));
    expect(steps).toEqual([{ from: 'app', to: PRIVATE_REPO, label: 'A private step' }]);
    expect(repos).toEqual([['app', 'orders']]);
  });
  it('draws nothing from a box whose facts lead nowhere', () => {
    expect(traceFrom('orders', ['f2'], store).steps).toEqual([]);
  });
});

describe('a traced request on the map', () => {
  const dirs = /** @type {string[]} */ ([]);
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  /** The map's own route, as `who` posts to it. @param {any} map @param {string} who @param {any} body */
  const trace = async (map, who, body) => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST', url: '/api/system-trace', headers: { host: 'localhost:4323', origin: 'http://localhost:4323', 'content-type': 'application/json' } });
    let status = 0, text = '';
    const res = { writeHead(/** @type {number} */ s) { status = s; return res; }, end(/** @type {string} */ t) { text = t || ''; return res; } };
    await map.handle(req, res, '/api/system-trace', who);
    return { status, body: text ? JSON.parse(text) : null };
  };
  const mapOf = () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-trace-')); dirs.push(home);
    fs.writeFileSync(path.join(home, 'system-facts.json'), JSON.stringify(store));
    const map = openMap({ name: 'shop', home, memory: true, initialState: {
      title: 'Shop system', people: [{ id: 'Duy', role: 'Admin', sees: 'all' }], calls: [], edges: [], start: 'app',
      drawing: { status: 'done', at: 1, by: 'Duy', repos: 2, progress: [] },
      nodes: [{ id: 'app', label: 'App', x: 0, y: 0, source: { kind: 'code', repo: 'app', facts: ['f1'] } },
        { id: 'orders', label: 'Orders', x: 300, y: 0, source: { kind: 'code', repo: 'orders', facts: ['f2'] } }],
    } });
    return map;
  };
  it('puts the steps on the box as its sequence, for someone on the map, and says when there are none', async () => {
    const map = mapOf();
    expect((await trace(map, 'Sam', { id: 'app' })).status).toBe(403);
    expect((await trace(map, 'Duy', { id: 'orders' })).body).toEqual({ error: 'Code shows no request leaving this box.' });
    expect(await trace(map, 'Duy', { id: 'app' })).toEqual({ status: 200, body: { steps: 4 } });
    const box = /** @type {any} */ (map.snapshot().nodes.find((/** @type {any} */ n) => n.id === 'app'));
    expect(box.diagram).toMatchObject({ kind: 'sequence', title: 'Trace: App', items: [{ from: 'app', to: 'GetOrder', label: 'GET /orders/{}' }, expect.anything(), expect.anything(), expect.anything()] });
    // someone who may not read the orders repo sees only that a step went somewhere private
    const cut = withoutRepos(map.snapshot(), new Set(['orders'])).nodes.find((/** @type {any} */ n) => n.id === 'app');
    expect(cut.diagram.items).toEqual([
      { from: 'app', to: PRIVATE_REPO, label: 'A private step' },
      ...Array(3).fill({ from: PRIVATE_REPO, to: PRIVATE_REPO, label: 'A private step' }),
    ]);
    expect(cut.traceRepos).toBeUndefined();
    map.close();
  });
});
