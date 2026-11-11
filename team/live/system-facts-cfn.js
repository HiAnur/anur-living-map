// Facts about a service from its compiled CloudFormation (`cdk.out/*.template.json`), read by code with no model and
// nothing run. One fact per function (its construct path, deployed name, handler, the routes that reach it, what
// its role may touch, its settings), and one per table, queue, topic, bucket, API, HTTP route, user pool, secret,
// parameter and schedule. A route to a function another repo deploys, named in the route's ARN, is an
// `outside_function` fact. Part of drawing a system map from code: see system-facts.js.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */

/** Every logical id a CloudFormation value points at (Ref, GetAtt, Sub). @param {any} v @returns {Set<string>} */
function refs(v) {
  const out = new Set();
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('Ref' in v) out.add(String(v.Ref));
    if ('Fn::GetAtt' in v) { const g = v['Fn::GetAtt']; out.add(Array.isArray(g) ? String(g[0]) : String(g).split('.')[0]); }
    if ('Fn::Sub' in v) {
      const s = Array.isArray(v['Fn::Sub']) ? v['Fn::Sub'][0] : v['Fn::Sub'];
      for (const m of String(s).matchAll(/\$\{([A-Za-z0-9]+)/g)) out.add(m[1]);
    }
    for (const x of Object.values(v)) for (const r of refs(x)) out.add(r);
  } else if (Array.isArray(v)) for (const x of v) for (const r of refs(x)) out.add(r);
  return out;
}

/** Every string a value mentions as a reference: Ref names, GetAtt attributes. @param {any} v @returns {Set<string>} */
function tokens(v) {
  const out = new Set();
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'Ref') out.add(String(x));
      else if (k === 'Fn::GetAtt') for (const y of Array.isArray(x) ? x : [x]) out.add(String(y));
      else for (const t of tokens(x)) out.add(t);
    }
  } else if (Array.isArray(v)) for (const x of v) for (const t of tokens(x)) out.add(t);
  return out;
}

/** @param {any} res */
const pathOf = (res) => String(res?.Metadata?.['aws:cdk:path'] || '').replace(/\/(Resource|Default)$/, '');
/** @param {unknown} v a literal name, or nothing when the name is computed */
const literal = (v) => typeof v === 'string' ? v : undefined;

const KINDS = /** @type {Record<string, string>} */ ({
  'AWS::DynamoDB::Table': 'table', 'AWS::DynamoDB::GlobalTable': 'table', 'AWS::SQS::Queue': 'queue', 'AWS::SNS::Topic': 'topic',
  'AWS::S3::Bucket': 'bucket', 'AWS::Events::Rule': 'schedule', 'AWS::Cognito::UserPool': 'user_pool', 'AWS::SecretsManager::Secret': 'secret',
  'AWS::SSM::Parameter': 'parameter', 'AWS::StepFunctions::StateMachine': 'state_machine', 'AWS::Kinesis::Stream': 'stream',
});
const NAMES = ['TableName', 'QueueName', 'TopicName', 'BucketName', 'Name', 'UserPoolName', 'StateMachineName', 'StreamName'];

/**
 * The facts in a repo's `cdk.out`, or [] when it has none.
 * @param {string} root the repo's folder @returns {Fact[]}
 */
export function cfnFacts(root) {
  const out = path.join(root, 'cdk.out');
  const files = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.endsWith('.template.json')).sort() : [];
  if (!files.length) return [];
  /** @type {Fact[]} */
  const facts = [];
  /** @param {string} kind @param {string} at @param {Record<string, any>} said */
  const add = (kind, at, said) => facts.push({ id: `f${facts.length + 1}`, kind, at, ...said });
  const templates = files.map((f) => ({ name: f, t: JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) }));
  // every function in every template, so a route in one template reaches a function in another
  /** @type {Map<string, string>} */
  const allFunctions = new Map();
  for (const { name, t } of templates) for (const [lid, r] of Object.entries(t.Resources || {})) if (/** @type {any} */ (r).Type === 'AWS::Lambda::Function') allFunctions.set(lid, name);
  const base = new Map([...allFunctions.keys()].map((f) => [f, f.replace(/[0-9A-F]{8}$/, '')]));
  // a nested stack's output names a function with another hash than the function's own: match the name without
  // its hash, preferring the longest name that fits
  /** @param {any} v @returns {string[]} */
  const functionsNamed = (v) => {
    const found = new Set();
    for (const tok of tokens(v)) {
      const exact = [...allFunctions.keys()].filter((f) => f === tok || tok.includes(f));
      if (exact.length) { exact.forEach((f) => found.add(f)); continue; }
      const fits = [...base].filter(([, b]) => new RegExp(`${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9A-F]{8}(Arn)?$`).test(tok)).map(([f]) => f);
      if (fits.length) found.add(fits.reduce((a, b) => (base.get(a)?.length || 0) >= (base.get(b)?.length || 0) ? a : b));
    }
    return [...found].sort();
  };
  /** @type {Map<string, Set<string>>} */
  const routes = new Map();
  /** @param {string} key @param {string} route */
  const route = (key, route) => { if (!routes.has(key)) routes.set(key, new Set()); routes.get(key)?.add(route); };
  /** @type {{ lid: string, at: string, said: Record<string, any> }[]} */
  const functions = [];
  for (const { name, t } of templates) {
    const R = /** @type {Record<string, any>} */ (t.Resources || {}), params = t.Parameters || {};
    const stack = name.replace(/\.(nested\.)?template\.json$/, '');
    /** @param {string} lid */
    const at = (lid) => `cdk.out/${name}#${lid}`;
    /** @param {string} lid @param {string[]} seen @returns {string} */
    const apiPath = (lid, seen = []) => {
      const r = R[lid];
      if (!r || r.Type !== 'AWS::ApiGateway::Resource' || seen.includes(lid)) return '';
      const parent = [...refs(r.Properties?.ParentId)][0];
      return apiPath(parent, [...seen, lid]) + '/' + String(r.Properties?.PathPart);
    };
    /** @type {Map<string, any[]>} */
    const may = new Map();
    for (const [lid, r] of Object.entries(R)) {
      const p = r.Properties || {};
      if (r.Type === 'AWS::ApiGateway::Method' && p.HttpMethod !== 'OPTIONS') {
        const uri = p.Integration?.Uri, res = [...refs(p.ResourceId)][0];
        const named = typeof uri === 'string' ? [...uri.matchAll(/function:([A-Za-z0-9_-]+)/g)].map((m) => m[1]) : [];
        const target = functionsNamed(uri);
        const key = `${p.HttpMethod} ${res ? apiPath(res) : '/'}`;
        for (const x of target.length ? target : named.length ? named.map((n) => `outside:${n}`) : ['?']) route(x, key);
      } else if (r.Type === 'AWS::ApiGatewayV2::Route') add('http_route', at(lid), { path: pathOf(r), route: p.RouteKey, stack });
      else if (r.Type === 'AWS::ApiGateway::RestApi' || r.Type === 'AWS::ApiGatewayV2::Api') add('api', at(lid), { path: pathOf(r), name: p.Name, stack });
      else if (KINDS[r.Type]) {
        const physical = NAMES.map((k) => literal(p[k])).find(Boolean);
        const keys = (p.KeySchema || []).map((/** @type {any} */ k) => k.AttributeName);
        const targets = [...new Set((p.Targets || []).flatMap((/** @type {any} */ tg) => [...refs(tg.Arn)]))];
        add(KINDS[r.Type], at(lid), { path: pathOf(r), stack, ...(physical ? { name: physical } : {}), ...(keys.length ? { keys } : {}),
          ...(p.ScheduleExpression ? { schedule: p.ScheduleExpression } : {}), ...(targets.length ? { targets: functionsNamed(p.Targets) } : {}) });
      } else if (r.Type === 'AWS::IAM::Policy') {
        for (const st of p.PolicyDocument?.Statement || []) {
          const acts = /** @type {unknown[]} */ ([]).concat(st.Action || []);
          const services = [...new Set(acts.map((a) => String(a).split(':')[0]))].sort();
          const on = [...refs(st.Resource)].filter((x) => x in R || x in params).sort().slice(0, 8);
          const arns = [].concat(st.Resource || []).filter((x) => typeof x === 'string').map((x) => String(x).slice(0, 90)).slice(0, 3);
          for (const role of refs(p.Roles)) { if (!may.has(role)) may.set(role, []); may.get(role)?.push({ services, on, arns }); }
        }
      } else if (r.Type === 'AWS::Lambda::EventSourceMapping') {
        add('event_source', at(lid), { functions: functionsNamed(p.FunctionName), from: [...refs(p.EventSourceArn)], stack });
      }
    }
    for (const [lid, r] of Object.entries(R)) {
      if (r.Type !== 'AWS::Lambda::Function') continue;
      const p = r.Properties || {};
      const settings = Object.fromEntries(Object.entries(p.Environment?.Variables || {}).map(([k, v]) => [k, [...refs(v)].sort().join(',') || (typeof v === 'string' ? v.slice(0, 80) : '…')]));
      functions.push({ lid, at: at(lid), said: { path: pathOf(r), stack, ...(literal(p.FunctionName) ? { name: p.FunctionName } : {}), handler: p.Handler,
        runtime: p.Runtime, settings, may: [...refs(p.Role)].flatMap((role) => may.get(role) || []).slice(0, 10) } });
    }
  }
  for (const { lid, at, said } of functions) add('function', at, { ...said, routes: [...(routes.get(lid) || [])].sort().slice(0, 40) });
  for (const [key, rs] of [...routes].filter(([k]) => k.startsWith('outside:')).sort()) add('outside_function', 'cdk.out', { name: key.slice(8), routes: [...rs].sort().slice(0, 20) });
  if (routes.get('?')) add('routes_unresolved', 'cdk.out', { routes: [...(routes.get('?') || [])].sort().slice(0, 60) });
  return facts;
}
