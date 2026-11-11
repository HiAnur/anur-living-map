import { describe, expect, it } from 'vitest';

import { repo } from './system.harness.js';
import { manifestFacts } from './system-facts-manifest.js';
import { linkRepos } from './system-links.js';

// Manifests read as text: packages, containers, compose services and the routes an OpenAPI spec serves.

const files = (/** @type {Record<string, string>} */ f) => ({ root: repo('shop', f), list: Object.keys(f) });

describe('facts from manifests', () => {
  it('reads packages, Dockerfiles and compose services, with what each depends on', () => {
    const { root, list } = files({
      'package.json': JSON.stringify({ name: 'shop', workspaces: ['apps/*'], dependencies: { express: '1', pg: '1' } }),
      'node_modules/x/package.json': JSON.stringify({ name: 'x' }),
      'pyproject.toml': '[project]\nname = "billing"\ndependencies = [\n  "fastapi>=1",\n  "boto3",\n]\n',
      'worker/requirements.txt': '# tools\nredis==5\n-r base.txt\ncelery\n',
      'Dockerfile': 'FROM node:22 AS build\nRUN npm ci\nFROM node:22-slim\nEXPOSE 3000\nCMD ["node", "server.js"]\n',
      'docker-compose.yml': 'version: "3"\nservices:\n  api:\n    build: .\n    ports:\n      - "3000:3000"\n    depends_on:\n      - db\n      - cache\n  db:\n    image: postgres:16 # the store\n  cache:\n    image: redis:7\n    depends_on:\n      db:\n        condition: service_healthy\n',
    });
    const facts = manifestFacts(root, list);
    expect(facts.filter((f) => f.kind === 'package')).toEqual([
      expect.objectContaining({ at: 'package.json', name: 'shop', language: 'javascript', dependencies: ['express', 'pg'], workspaces: ['apps/*'] }),
      expect.objectContaining({ at: 'pyproject.toml', name: 'billing', language: 'python', dependencies: ['fastapi', 'boto3'] }),
      expect.objectContaining({ at: 'worker/requirements.txt', name: 'worker', dependencies: ['redis', 'celery'] }),
    ]);
    expect(facts.find((f) => f.kind === 'container')).toMatchObject({ at: 'Dockerfile', from: 'node:22-slim', expose: ['3000'], runs: '["node", "server.js"]' });
    expect(facts.filter((f) => f.kind === 'compose_service')).toEqual([
      expect.objectContaining({ name: 'api', at: 'docker-compose.yml:3', build: '.', ports: ['3000:3000'], depends_on: ['db', 'cache'] }),
      expect.objectContaining({ name: 'db', image: 'postgres:16' }),
      expect.objectContaining({ name: 'cache', image: 'redis:7', depends_on: ['db'] }),
    ]);
  });
  it('reads the routes an OpenAPI spec serves, in YAML or JSON, and links a call from another repo to them', () => {
    const yaml = files({ 'openapi.yaml': 'openapi: 3.0.0\ninfo:\n  title: Orders API\npaths:\n  /orders/{orderId}:\n    get:\n      summary: One order\n    delete:\n      summary: Cancel\n  /orders:\n    post:\n      summary: Place\n' });
    const spec = manifestFacts(yaml.root, yaml.list)[0];
    expect(spec).toMatchObject({ kind: 'api_spec', name: 'Orders API', routes: ['GET /orders/{orderId}', 'DELETE /orders/{orderId}', 'POST /orders'] });
    const json = files({ 'swagger.json': JSON.stringify({ swagger: '2.0', info: { title: 'Old' }, paths: { '/ping': { get: {}, parameters: [] } } }) });
    expect(manifestFacts(json.root, json.list)[0]).toMatchObject({ kind: 'api_spec', routes: ['GET /ping'] });
    // a file that only looks like a spec is not one
    const notSpec = files({ 'openapi-notes.yaml': 'notes: none\n' });
    expect(manifestFacts(notSpec.root, notSpec.list)).toEqual([]);
    const server = { repo: 'orders', root: '', head: null, kinds: [], facts: [{ ...spec, id: 'f1' }] };
    const app = { repo: 'app', root: '', head: null, kinds: [], facts: [{ id: 'f1', kind: 'api_call', at: 'src/api.ts:3', method: 'GET', path: '/orders/{id}' }] };
    expect(linkRepos([server, app]).links).toEqual([expect.objectContaining({ kind: 'calls_route', fromRepo: 'app', toRepo: 'orders', route: 'GET /orders/{}' })]);
  });
});
