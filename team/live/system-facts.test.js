import { describe, expect, it } from 'vitest';

import { isTestFile, readRepo } from './system-facts.js';
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
  it('says when TypeScript CDK holds no function its source shows, rather than drawing a repo with nothing in it', async () => {
    const r = await readRepo(repo('ts-empty', { 'cdk.json': '{"app": "npx ts-node bin/app.ts"}', 'lib/stack.ts': 'export class Stack {}\n' }));
    expect(r.unread).toEqual([expect.stringContaining('CDK in TypeScript')]);
    expect((await readRepo(api())).unread).toEqual([]);
    expect((await readRepo(trading())).unread).toEqual([]);
  });
});

describe('leaving tests out', () => {
  it('reads a call in the code, and nothing from tests, fixtures or harnesses that make the same call', async () => {
    const call = (/** @type {string} */ host) => `export const ip = () => fetch('https://${host}.example.com');\n`;
    const py = (/** @type {string} */ host) => `import os\nURL = "https://${host}.example.com"\nSTAGE = os.environ.get("${host.toUpperCase().replace(/-/g, '_')}")\n`;
    const r = await readRepo(repo('tested-app', {
      'package.json': JSON.stringify({ dependencies: { react: '1' } }),
      'src/ip.ts': call('checkip'),
      'src/ip.test.ts': call('in-test'), 'src/ip.spec.tsx': call('in-spec'), 'src/__tests__/ip.ts': call('in-tests-folder'),
      'e2e/ip.ts': call('in-e2e'), 'test/fixtures/app/ip.ts': call('in-fixture'), 'src/sample.harness.js': call('in-harness'), 'src/__mocks__/ip.ts': call('in-mock'),
      'lambdas/handler.py': py('real-py'), 'tests/test_handler.py': py('py-tests'), 'lambdas/test_handler.py': py('py-test-file'),
      'lambdas/handler_test.py': py('py-test-suffix'), 'conftest.py': py('py-conftest'),
      'Tests/AppTests/ClientTests.swift': 'let p = "/api/in-swift-tests"\n',
    }));
    const said = JSON.stringify(r.facts);
    expect(r.facts.find((f) => f.kind === 'api_call')).toMatchObject({ path: 'https://checkip.example.com', at: 'src/ip.ts:1' });
    expect(said).toContain('real-py');
    for (const t of ['in-test', 'in-spec', 'in-tests-folder', 'in-e2e', 'in-fixture', 'in-harness', 'in-mock', 'py-tests', 'py-test-file', 'py-test-suffix', 'py-conftest', 'in-swift-tests']) expect(said).not.toContain(t);
  });
  it('knows a test, a fixture and a harness by its path, and code by its own', () => {
    for (const f of ['a.test.js', 'web/x.spec.tsx', 'team/live/system.harness.js', 'e2e/map.ts', 'ledger/fixtures/x.txt', 'Tests/CoreTests/A.swift', 'test_x.py', 'pkg/x_test.go', 'conftest.py']) expect(isTestFile(f), f).toBe(true);
    for (const f of ['src/attest.ts', 'app/(app)/(tabs)/account/brokerageProfile/index.tsx', 'latest/index.js', 'contest.py', 'protest/x.ts']) expect(isTestFile(f), f).toBe(false);
  });
  it('reads the routes an Express server serves', async () => {
    const r = await readRepo(repo('express-api', { 'server.ts': "const app = express();\napp.get('/users/:id', h);\nrouter.post('/orders', h);\napp.all('/health', h);\naxios.get('/not-a-route');\n" }));
    expect(r.kinds).toEqual(['server']);
    expect(r.facts).toEqual([expect.objectContaining({ kind: 'server_routes', at: 'server.ts:2', routes: ['GET /users/{id}', 'POST /orders', 'ANY /health'] })]);
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
