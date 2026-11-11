import { describe, expect, it } from 'vitest';

import { blankComments, inside, parts, propOf } from './system-facts-ts.js';
import { readRepo } from './system-facts.js';
import { linkRepos } from './system-links.js';
import { api, tsService } from './system.harness.js';

// CDK written in TypeScript, read from its source with no compiler and nothing run.

describe('reading TypeScript CDK from source', () => {
  it('reads a function with its deployed name (a constant), code, settings, route, permissions and what runs it', async () => {
    const r = await readRepo(tsService());
    expect(r.kinds).toEqual(['typescript-cdk']);
    expect(r.unread).toEqual([]);
    const fn = r.facts.find((f) => f.kind === 'function');
    expect(fn).toMatchObject({
      name: 'PlaceOrder', logical_id: 'Place', at: 'stacks/orders.ts:14#Place', entry: 'lib/lambda/place.ts',
      settings: { USERS_TABLE: 'props.usersTable.tableName', STAGE: 'prod' }, routes: ['POST /orders/{id}'],
    });
    // the grant on a prop is followed back through the app to the table it names
    expect(fn?.may).toEqual(expect.arrayContaining([{ services: ['grantReadData'], on: ['UsersTable'] }, expect.objectContaining({ services: ['lambda'] })]));
    expect(r.facts.find((f) => f.kind === 'construct')).toMatchObject({ imported: 'table', name: 'users-table', logical_id: 'UsersTable' });
    expect(r.facts.find((f) => f.kind === 'grant')).toMatchObject({ resource: 'props.usersTable', resource_name: 'users-table', to: 'place' });
    expect(r.facts.find((f) => f.kind === 'queue')).toMatchObject({ name: 'order-jobs', logical_id: 'Jobs' });
    expect(r.facts.find((f) => f.kind === 'event_source')).toMatchObject({ source: 'SqsEventSource', functions: ['Place'], from: ['Jobs'] });
    expect(r.facts.find((f) => f.kind === 'schedule')).toMatchObject({ targets: ['Place'] });
    expect(r.facts.find((f) => f.kind === 'api')).toMatchObject({ name: 'Orders' });
  });
  it('reads handler code: AWS commands with the names they are given, and the settings read', async () => {
    const r = await readRepo(tsService());
    expect(r.facts.filter((f) => f.kind === 'aws_call').map((f) => [f.call, f.TableName || f.FunctionName])).toEqual([['GetCommand', 'process.env.USERS_TABLE'], ['InvokeCommand', 'ListOrders']]);
    expect(r.facts.find((f) => f.kind === 'env_read')).toMatchObject({ name: 'USERS_TABLE', module: 'lib/lambda/place.ts' });
  });
  it('links a function another repo deploys, invoked by name from policy and code', async () => {
    const { links } = linkRepos([await readRepo(api()), await readRepo(tsService())]);
    expect(links.filter((l) => l.kind === 'reaches_function' && l.function === 'ListOrders').map((l) => [l.fromRepo, l.toRepo])).toEqual([['orders-ts', 'api-service'], ['orders-ts', 'api-service']]);
  });
  it('reads the same facts twice', async () => {
    const root = tsService();
    expect(JSON.stringify((await readRepo(root)).facts)).toBe(JSON.stringify((await readRepo(root)).facts));
  });
});

describe('the scanner', () => {
  it('blanks comments but not strings, keeping every line where it was', () => {
    const src = "a // gone\nb = '// kept' /* gone\nstill */ c";
    expect(blankComments(src)).toBe("a        \nb = '// kept'        \n         c");
  });
  it('splits arguments and reads keys at the top level only', () => {
    expect(parts("this, 'Id', { a: f(1, 2), b: [3, 4] }")).toEqual(['this', "'Id'", '{ a: f(1, 2), b: [3, 4] }']);
    expect(propOf(inside('{ a: { b: 1 }, b: "two", c }', 0), 'b')).toBe('"two"');
    expect(propOf(inside('{ a: { b: 1 }, b: "two", c }', 0), 'c')).toBe('c');
  });
});
