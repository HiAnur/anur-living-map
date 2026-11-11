import { describe, expect, it } from 'vitest';

import { checkDrawing, importsModule } from './system-check.js';

// The rules code holds a drawing to, before anything is stored: the agent proposes, code checks.

const facts = /** @type {Map<string, any>} */ (new Map(/** @type {[string, any][]} */ ([
  ['f1', { id: 'f1', kind: 'function', at: 'a#Fn', name: 'Worker', may: [{ services: ['dynamodb'], on: ['Orders'] }] }],
  ['f2', { id: 'f2', kind: 'table', at: 'a#Orders', name: 'Orders', path: 'Stack/Orders' }],
  ['f3', { id: 'f3', kind: 'queue', at: 'a#Jobs', name: 'Jobs' }],
  ['f4', { id: 'f4', kind: 'doc', at: 'x.py:1', text: 'Chat users post here' }],
  ['f5', { id: 'f5', kind: 'grant', at: 'b.py:9', resource: 'orders', verb: 'grant_read', to: 'worker' }],
])));
const box = (/** @type {string} */ id, /** @type {string[]} */ cites, more = {}) => ({ id, name: id, kind: 'function', description: '', facts: cites, ...more });

describe('checking a drawing', () => {
  it('keeps boxes and lines whose facts show them', () => {
    const r = checkDrawing({ boxes: [box('worker', ['f1']), box('orders', ['f2'])], lines: [{ from: 'worker', to: 'orders', label: 'reads', facts: ['f1'] }] }, facts);
    expect(r.rejected).toEqual([]);
    expect(r.lines).toHaveLength(1);
  });
  it('rejects a box or line citing a fact that does not exist (rule 1)', () => {
    const r = checkDrawing({ boxes: [box('worker', ['f1', 'f99'])], lines: [] }, facts);
    expect(r.boxes).toEqual([]);
    expect(r.rejected[0]).toEqual({ item: 'box "worker"', why: 'cites facts that do not exist: f99' });
  });
  it('rejects a box or line citing nothing (rule 2)', () => {
    const r = checkDrawing({ boxes: [box('worker', ['f1']), box('ghost', [])], lines: [{ from: 'worker', to: 'worker', label: 'x', facts: [] }] }, facts);
    expect(r.boxes.map((b) => b.id)).toEqual(['worker']);
    expect(r.rejected.map((x) => x.why)).toEqual(['cites no fact', 'joins a box that is not on the map']);
  });
  it('rejects a line whose facts do not show both of its ends (rule 3)', () => {
    // the queue's own fact says nothing about the worker
    const r = checkDrawing({ boxes: [box('worker', ['f1']), box('jobs', ['f3'])], lines: [{ from: 'worker', to: 'jobs', label: 'sends', facts: ['f3'] }] }, facts);
    expect(r.lines).toEqual([]);
    expect(r.rejected).toEqual([{ item: 'line worker → jobs', why: 'its facts do not show both of its ends' }]);
  });
  it('accepts a line whose one fact names what the other end cites', () => {
    // the worker's permission names the Orders table, which the other box cites
    const r = checkDrawing({ boxes: [box('worker', ['f1']), box('orders', ['f2'])], lines: [{ from: 'worker', to: 'orders', label: 'reads', facts: ['f1'] }] }, facts);
    expect(r.lines.map((l) => l.label)).toEqual(['reads']);
  });
  it('matches names the way code writes them: a grant on self.allow_list_table to worker_lambda joins those constructs', () => {
    const cdk = /** @type {Map<string, any>} */ (new Map(/** @type {[string, any][]} */ ([
      ['c1', { id: 'c1', kind: 'construct', at: 'app.py:3', construct: 'BotWorkerLambda', module: 'app.py' }],
      ['c2', { id: 'c2', kind: 'construct', at: 'app.py:4', construct: 'BotAllowListDynamoDB', module: 'app.py' }],
      ['c3', { id: 'c3', kind: 'construct', at: 'app.py:5', construct: 'BotAuditDynamoDB', module: 'app.py' }],
      ['g1', { id: 'g1', kind: 'grant', at: 'stack.py:9', module: 'stack.py', resource: 'self.allow_list_table', verb: 'grant_read_write_data', to: 'worker_lambda' }],
    ])));
    const r = checkDrawing({ boxes: [box('worker', ['c1']), box('allow', ['c2']), box('audit', ['c3'])], lines: [
      { from: 'worker', to: 'allow', label: 'reads and writes', facts: ['g1'] },
      { from: 'worker', to: 'audit', label: 'writes', facts: ['g1'] },
    ] }, cdk);
    expect(r.lines.map((l) => l.to)).toEqual(['allow']);
    expect(r.rejected).toEqual([{ item: 'line worker → audit', why: 'its facts do not show both of its ends' }]);
  });
  it('keeps a line whose citations miss when one end\'s own facts name the other, with those facts as its evidence', () => {
    // the line cites the queue, but the worker's permission names the Orders table the other end cites
    const r = checkDrawing({ boxes: [box('worker', ['f1']), box('orders', ['f2']), box('jobs', ['f3'])], lines: [{ from: 'worker', to: 'orders', label: 'reads', facts: ['f3'] }] }, facts);
    expect(r.lines).toEqual([expect.objectContaining({ to: 'orders', facts: ['f3', 'f1'] })]);
  });
  it('joins a module to the package it imports, however common its name', () => {
    const py = /** @type {Map<string, any>} */ (new Map(/** @type {[string, any][]} */ ([
      ['m1', { id: 'm1', kind: 'module', at: 'scripts/backfill.py:1', module: 'scripts/backfill.py' }],
      ['m2', { id: 'm2', kind: 'module', at: 'utils/dynamo.py:1', module: 'utils/dynamo.py' }],
      ['i1', { id: 'i1', kind: 'import', at: 'scripts/backfill.py:2', module: 'scripts/backfill.py', imports: 'utils.dynamo' }],
      ['i2', { id: 'i2', kind: 'import', at: 'utils/dynamo.py:2', module: 'utils/dynamo.py', imports: '.helpers' }],
    ])));
    const r = checkDrawing({ boxes: [box('backfill', ['m1']), box('utils', ['m2'])], lines: [{ from: 'backfill', to: 'utils', label: 'uses', facts: ['i1'] }] }, py);
    expect(r.lines).toHaveLength(1);
    expect(importsModule(py.get('i2'), 'utils/helpers.py')).toBe(true);
    expect(importsModule(py.get('i2'), 'scripts/helpers.py')).toBe(false);
    expect(importsModule(py.get('i1'), 'src/utils/dynamo.py')).toBe(true);
    expect(importsModule({ id: 'i3', kind: 'import', at: 'a.py:1', module: 'a.py', imports: 'utils' }, 'src/utils/__init__.py')).toBe(true);
  });
  it('accepts a platform line only when a link joins the two boxes\' repos', () => {
    const links = new Map([['x1', /** @type {any} */ ({ id: 'x1', kind: 'calls_route', at: 'links', fromRepo: 'app', toRepo: 'api' })],
      ...['app', 'api', 'bot'].map((r) => /** @type {[string, any]} */ ([`repo:${r}`, { id: `repo:${r}`, kind: 'repo', at: 'repo', fromRepo: r, toRepo: r }]))]);
    const boxes = [box('app', ['repo:app'], { repo: 'app' }), box('api', ['repo:api'], { repo: 'api' }), box('bot', ['repo:bot'], { repo: 'bot' })];
    const r = checkDrawing({ boxes, lines: [{ from: 'app', to: 'api', label: 'calls', facts: ['x1'] }, { from: 'bot', to: 'api', label: 'calls', facts: ['x1'] }] }, links);
    expect(r.lines.map((l) => `${l.from}>${l.to}`)).toEqual(['app>api']);
    expect(r.rejected).toEqual([{ item: 'line bot → api', why: 'its facts do not show both of its ends' }]);
  });
  it('marks what rests only on descriptions as unconfirmed (rule 4)', () => {
    const r = checkDrawing({ boxes: [box('chat', ['f4']), box('worker', ['f1'])], lines: [{ from: 'chat', to: 'worker', label: 'posts', facts: ['f4'] }] }, facts);
    expect(r.boxes.find((b) => b.id === 'chat')?.unconfirmed).toBe(true);
    expect(r.boxes.find((b) => b.id === 'worker')?.unconfirmed).toBeUndefined();
  });
  it('lists the structural facts no box cites (rule 5)', () => {
    expect(checkDrawing({ boxes: [box('worker', ['f1'])], lines: [] }, facts).leftOut).toEqual(['f2', 'f3', 'f5']);
  });
  it('rejects two boxes with one id, and trims what it keeps', () => {
    const r = checkDrawing({ boxes: [box('worker', ['f1'], { name: 'W'.repeat(200) }), box('worker', ['f2'])], lines: [] }, facts);
    expect(r.boxes).toHaveLength(1);
    expect(r.boxes[0].name).toHaveLength(80);
    expect(r.rejected[0].why).toMatch(/same id/);
  });
});
