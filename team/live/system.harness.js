import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

// Small made-up repos for the system-map tests: a CDK service compiled to CloudFormation, a Python CDK service, and an
// app with an Amplify backend. Each call makes a fresh copy in a temporary folder, removed after the file's tests.

const made = /** @type {string[]} */ ([]);
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
/** @param {string} name @param {Record<string, string>} files */
export function repo(name, files) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lm-sys-')), name);
  made.push(path.dirname(root));
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
  return root;
}

// the API service: a route served by its own function, a route through a nested stack's output (whose hash differs
// from the function's own), a route to a function another repo deploys, a table and what the function may touch
export const api = () => repo('api-service', {
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
export const trading = () => repo('trading-service', {
  'cdk.json': '{"app": "python3 app.py"}',
  'stacks/trading.py': '"""The trading stack: places orders."""\nfrom aws_cdk import aws_lambda as lambda_\n\nclass Trading:\n    def __init__(self):\n        fn = lambda_.Function(self, "Trade", function_name="InitiateTrade", handler="trade.handler")\n        table.grant_read_write_data(fn)\n',
  'lambdas/trade.py': '"""Places a trade."""\nimport os\nimport boto3\nfrom stacks import trading\n\nFN_LIST_ORDERS = "ListOrders"\n\ndef handler(event, context):\n    db = boto3.client("dynamodb")\n    db.put_item(TableName="users-table", Item={})\n    return os.environ.get("STAGE")\n',
});
// the app: a screen, a call to the API's route, a call to an outside service, state and an SDK
export const app = () => repo('mobile-app', {
  'package.json': JSON.stringify({ dependencies: { expo: '1', react: '1', 'aws-amplify': '1', '@reduxjs/toolkit': '1' } }),
  'app/(tabs)/home.tsx': 'export default function Home() { return null }\n',
  'src/model/user.ts': "import { get } from 'aws-amplify/api';\nimport { createSlice } from '@reduxjs/toolkit';\nexport const loadUser = (id: string) => get({ apiName: API_NAME, path: `/user/${id}` });\nexport async function ip() { return fetch('https://checkip.example.com'); }\nexport const s = createSlice({ name: 'user', initialState: {}, reducers: {} });\nconst k = process.env.EXPO_PUBLIC_KEY;\n",
  'amplify/backend/backend-config.json': JSON.stringify({ auth: { pool: { service: 'Cognito' } }, api: { main: { service: 'API Gateway', dependsOn: [{ category: 'auth', resourceName: 'pool' }] } } }),
});
