import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readRepo } from './system-facts.js';
import { linkRepos } from './system-links.js';

// The fact readers and the cross-repo linker on small made-up repos: a CDK service compiled to CloudFormation, a
// Python CDK service, an app and an Amplify project. Code only: no model, nothing run but python3's parser.

const made = /** @type {string[]} */ ([]);
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
/** @param {string} name @param {Record<string, string>} files */
function repo(name, files) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lm-sys-')), name);
  made.push(path.dirname(root));
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
  return root;
}

// the API service: a route served by its own function, a route through a nested stack's output (whose hash differs
// from the function's own), a route to a function another repo deploys, a table and what the function may touch
const api = () => repo('api-service', {
  'cdk.json': '{}',
  'cdk.out/Api.template.json': JSON.stringify({ Resources: {
    UsersFnAB12CD34: { Type: 'AWS::Lambda::Function', Metadata: { 'aws:cdk:path': 'Api/UsersFn/Resource' }, Properties: { FunctionName: 'GetUser', Handler: 'index.handler', Role: { 'Fn::GetAtt': ['UsersRole', 'Arn'] }, Environment: { Variables: { TABLE: { Ref: 'UsersTable' } } } } },
    UsersRole: { Type: 'AWS::IAM::Role', Properties: {} },
    UsersPolicy: { Type: 'AWS::IAM::Policy', Properties: { Roles: [{ Ref: 'UsersRole' }], PolicyDocument: { Statement: [{ Action: ['dynamodb:GetItem'], Resource: { 'Fn::GetAtt': ['UsersTable', 'Arn'] } }] } } },
    UsersTable: { Type: 'AWS::DynamoDB::Table', Metadata: { 'aws:cdk:path': 'Api/Users/Resource' }, Properties: { TableName: 'users-table', KeySchema: [{ AttributeName: 'id' }] } },
    Api: { Type: 'AWS::ApiGateway::RestApi', Properties: { Name: 'Public' } },
    UserRes: { Type: 'AWS::ApiGateway::Resource', Properties: { ParentId: { 'Fn::GetAtt': ['Api', 'RootResourceId'] }, PathPart: 'user' } },
    UserIdRes: { Type: 'AWS::ApiGateway::Resource', Properties: { ParentId: { Ref: 'UserRes' }, PathPart: '{userId}' } },
    GetUser: { Type: 'AWS::ApiGateway::Method', Properties: { HttpMethod: 'GET', ResourceId: { Ref: 'UserIdRes' }, Integration: { Uri: { 'Fn::Join': ['', ['arn:', { 'Fn::GetAtt': ['UsersFnAB12CD34', 'Arn'] }]] } } } },
    TradeRes: { Type: 'AWS::ApiGateway::Resource', Properties: { ParentId: { 'Fn::GetAtt': ['Api', 'RootResourceId'] }, PathPart: 'trade' } },
    PostTrade: { Type: 'AWS::ApiGateway::Method', Properties: { HttpMethod: 'POST', ResourceId: { Ref: 'TradeRes' }, Integration: { Uri: 'arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:1:function:InitiateTrade/invocations' } } },
    OrdersRes: { Type: 'AWS::ApiGateway::Resource', Properties: { ParentId: { 'Fn::GetAtt': ['Api', 'RootResourceId'] }, PathPart: 'orders' } },
    GetOrders: { Type: 'AWS::ApiGateway::Method', Properties: { HttpMethod: 'GET', ResourceId: { Ref: 'OrdersRes' }, Integration: { Uri: { 'Fn::Join': ['', ['arn:', { 'Fn::GetAtt': ['Nested', 'Outputs.ApiOrdersListOrdersLambda99887766Arn'] }]] } } } },
  } }),
  'cdk.out/ApiOrders.nested.template.json': JSON.stringify({ Resources: {
    ListOrdersLambda11223344: { Type: 'AWS::Lambda::Function', Metadata: { 'aws:cdk:path': 'Api/Orders/ListOrdersLambda/Resource' }, Properties: { FunctionName: 'ListOrders', Handler: 'orders.handler' } },
  } }),
});
// the trading service, in Python CDK: deploys InitiateTrade, invokes ListOrders by name, writes users-table
const trading = () => repo('trading-service', {
  'cdk.json': '{"app": "python3 app.py"}',
  'stacks/trading.py': '"""The trading stack: places orders."""\nfrom aws_cdk import aws_lambda as lambda_\n\nclass Trading:\n    def __init__(self):\n        fn = lambda_.Function(self, "Trade", function_name="InitiateTrade", handler="trade.handler")\n        table.grant_read_write_data(fn)\n',
  'lambdas/trade.py': '"""Places a trade."""\nimport os\nimport boto3\nfrom stacks import trading\n\nFN_LIST_ORDERS = "ListOrders"\n\ndef handler(event, context):\n    db = boto3.client("dynamodb")\n    db.put_item(TableName="users-table", Item={})\n    return os.environ.get("STAGE")\n',
});
// the app: a screen, a call to the API's route, a call to an outside service, state and an SDK
const app = () => repo('mobile-app', {
  'package.json': JSON.stringify({ dependencies: { expo: '1', react: '1', 'aws-amplify': '1', '@reduxjs/toolkit': '1' } }),
  'app/(tabs)/home.tsx': 'export default function Home() { return null }\n',
  'src/model/user.ts': "import { get } from 'aws-amplify/api';\nimport { createSlice } from '@reduxjs/toolkit';\nexport const loadUser = (id: string) => get({ apiName: API_NAME, path: `/user/${id}` });\nexport async function ip() { return fetch('https://checkip.example.com'); }\nexport const s = createSlice({ name: 'user', initialState: {}, reducers: {} });\nconst k = process.env.EXPO_PUBLIC_KEY;\n",
  'amplify/backend/backend-config.json': JSON.stringify({ auth: { pool: { service: 'Cognito' } }, api: { main: { service: 'API Gateway', dependsOn: [{ category: 'auth', resourceName: 'pool' }] } } }),
});

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
