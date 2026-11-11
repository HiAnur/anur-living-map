import { describe, expect, it } from 'vitest';

import { readRepo } from './system-facts.js';
import { linkRepos } from './system-links.js';
import { api, app, repo, trading } from './system.harness.js';

// The fact readers and the cross-repo linker on small made-up repos: a CDK service compiled to CloudFormation, a
// Python CDK service, an app and an Amplify project. Code only: no model, nothing run but python3's parser.

describe('reading a repo', () => {
  it('reads compiled CloudFormation: functions with their names, routes, settings and permissions, tables, APIs', async () => {
    const r = await readRepo(api());
    expect(r.kinds).toContain('cloudformation');
    const fn = r.facts.find((f) => f.kind === 'function' && f.name === 'GetUser');
    expect(fn).toMatchObject({ routes: ['GET /user/{userId}'], settings: { TABLE: 'UsersTable' }, may: [{ services: ['dynamodb'], on: ['UsersTable'] }] });
    expect(fn?.at).toBe('cdk.out/Api.template.json#UsersFnAB12CD34');
    expect(r.facts.find((f) => f.kind === 'table')).toMatchObject({ name: 'users-table', keys: ['id'] });
    expect(r.facts.find((f) => f.kind === 'api')).toMatchObject({ name: 'Public' });
  });
  it('joins a route through a nested stack to its function, though the hashes differ', async () => {
    const r = await readRepo(api());
    expect(r.facts.find((f) => f.kind === 'function' && f.name === 'ListOrders')?.routes).toEqual(['GET /orders']);
  });
  it('records a route to a function another repo deploys, by the name in its ARN', async () => {
    const r = await readRepo(api());
    expect(r.facts.find((f) => f.kind === 'outside_function')).toMatchObject({ name: 'InitiateTrade', routes: ['POST /trade'] });
  });
  it('reads Python source: constructs with deployed names, grants, invoked names, AWS calls, settings, descriptions', async () => {
    const r = await readRepo(trading());
    expect(r.kinds).toContain('python-cdk');
    expect(r.facts.find((f) => f.kind === 'construct')).toMatchObject({ logical_id: 'Trade', function_name: "'InitiateTrade'", at: 'stacks/trading.py:6' });
    expect(r.facts.find((f) => f.kind === 'grant')).toMatchObject({ verb: 'grant_read_write_data', to: 'fn' });
    expect(r.facts.find((f) => f.kind === 'invokes_by_name')).toMatchObject({ names: ['ListOrders'] });
    expect(r.facts.find((f) => f.kind === 'aws_client')).toMatchObject({ service: 'dynamodb' });
    expect(r.facts.find((f) => f.kind === 'env_read')).toMatchObject({ name: 'STAGE' });
    expect(r.facts.find((f) => f.kind === 'import')).toMatchObject({ imports: 'stacks' });
    expect(r.facts.find((f) => f.kind === 'module' && f.module === 'lambdas/trade.py')?.doc).toBe('Places a trade.');
  });
  it('reads an app: screens, backend calls with the function they are in, outside calls, state, SDKs, settings, Amplify', async () => {
    const r = await readRepo(app());
    expect(r.kinds).toEqual(expect.arrayContaining(['app', 'amplify']));
    expect(r.facts.find((f) => f.kind === 'screens')).toMatchObject({ folder: 'app/(tabs)', routes: ['/home'] });
    expect(r.facts.find((f) => f.kind === 'api_call' && f.path === '/user/{}')).toMatchObject({ method: 'GET', in_function: 'loadUser' });
    expect(r.facts.find((f) => f.kind === 'state_slice')).toMatchObject({ name: 'user' });
    expect(r.facts.find((f) => f.kind === 'env_read')).toMatchObject({ name: 'EXPO_PUBLIC_KEY' });
    expect(r.facts.find((f) => f.kind === 'imports_sdks')?.packages).toEqual(['@reduxjs/toolkit', 'aws-amplify']);
    expect(r.facts.find((f) => f.kind === 'amplify_resource' && f.category === 'api')).toMatchObject({ dependsOn: ['auth/pool'] });
  });
  it('gives every fact a unique id and a place it came from', async () => {
    for (const r of [await readRepo(api()), await readRepo(trading()), await readRepo(app())]) {
      expect(new Set(r.facts.map((f) => f.id)).size).toBe(r.facts.length);
      expect(r.facts.every((f) => typeof f.at === 'string' && f.at.length > 0)).toBe(true);
    }
  });
  it('reads the same facts twice from unchanged code', async () => {
    const root = trading();
    expect(JSON.stringify((await readRepo(root)).facts)).toBe(JSON.stringify((await readRepo(root)).facts));
  });
  it('says when TypeScript CDK was never compiled, rather than drawing a repo with nothing in it', async () => {
    const r = await readRepo(repo('ts-service', { 'cdk.json': '{"app": "npx ts-node bin/app.ts"}', 'lib/stack.ts': 'export class Stack {}\n' }));
    expect(r.unread).toEqual([expect.stringContaining('npx cdk synth')]);
    expect((await readRepo(api())).unread).toEqual([]);
    expect((await readRepo(trading())).unread).toEqual([]);
  });
});

describe('linking repos', () => {
  it('finds calls, routes and invokes by name, and named resources across repos, citing both sides', async () => {
    const readings = [await readRepo(app()), await readRepo(api()), await readRepo(trading())];
    const { links, unmatched } = linkRepos(readings);
    const of = (/** @type {string} */ kind) => links.filter((l) => l.kind === kind);
    expect(of('calls_route')).toEqual([expect.objectContaining({ route: 'GET /user/{}', fromRepo: 'mobile-app', toRepo: 'api-service' })]);
    expect(of('calls_outside')).toEqual([expect.objectContaining({ url: 'https://checkip.example.com', fromRepo: 'mobile-app' })]);
    expect(of('reaches_function')).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: 'InitiateTrade', via: 'route', fromRepo: 'api-service', toRepo: 'trading-service' }),
      expect.objectContaining({ function: 'ListOrders', via: 'invoke', fromRepo: 'trading-service', toRepo: 'api-service' }),
    ]));
    expect(of('uses_resource')).toEqual([expect.objectContaining({ resource: 'users-table', resourceKind: 'table', fromRepo: 'trading-service', toRepo: 'api-service' })]);
    for (const l of links) for (const side of [l.from, l.to].filter(Boolean)) {
      const [repoName, id] = side.split(':');
      expect(readings.find((r) => r.repo === repoName)?.facts.some((f) => f.id === id), side).toBe(true);
    }
    expect(unmatched).toEqual([]);
  });
  it('lists an app call no route serves', async () => {
    const lonely = repo('lonely-app', { 'package.json': JSON.stringify({ dependencies: { react: '1' } }), 'src/a.ts': "get({ apiName: X, path: '/nowhere' });\n" });
    const { unmatched } = linkRepos([await readRepo(lonely), await readRepo(api())]);
    expect(unmatched).toEqual([expect.objectContaining({ repo: 'lonely-app', call: 'GET /nowhere' })]);
  });
});
