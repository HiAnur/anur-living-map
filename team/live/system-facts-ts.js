// Facts from CDK written in TypeScript, read from its source with no compiler and nothing run: what a repo
// downloaded from GitHub has, since its compiled cdk.out is build output git does not keep. It reads what the
// CloudFormation reader reads from a template, as far as the source says it in so many words:
//   constructs (functions with their deployed names, handlers, settings and routes; tables, queues, topics,
//   buckets, secrets, parameters, state machines, APIs, schedules, user pools)
//   resources made elsewhere and named here (Table.fromTableName, Function.fromFunctionName, …)
//   grants, policy statements, event sources and schedule targets, as what a function may touch and what runs it
//   in handler code: AWS SDK commands, the names they are given, and the settings read
// A resource handed to a stack as a prop is followed back through the app's wiring (`usersTable: usersStack.table`)
// to the construct that made it. Each fact says where it came from as `file:line#ConstructId`.

import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */

const MADE = /** @type {Record<string, string>} */ ({
  NodejsFunction: 'function', Function: 'function', DockerImageFunction: 'function', SingletonFunction: 'function', PythonFunction: 'function',
  Table: 'table', TableV2: 'table', Queue: 'queue', Topic: 'topic', Bucket: 'bucket', Secret: 'secret', StringParameter: 'parameter',
  StateMachine: 'state_machine', RestApi: 'api', LambdaRestApi: 'api', HttpApi: 'api', SpecRestApi: 'api', Rule: 'schedule', CfnSchedule: 'schedule',
  UserPool: 'user_pool', Stream: 'stream',
});
const NAMES = ['functionName', 'tableName', 'queueName', 'topicName', 'bucketName', 'secretName', 'parameterName', 'stateMachineName', 'restApiName', 'apiName', 'ruleName', 'userPoolName', 'streamName', 'name'];
// Kind.fromX(scope, 'Id', name): a resource another stack or repo made, named here
const IMPORTED = /\b(\w+)\.(from(?:Table|Function|Queue|Topic|Bucket|Secret|StringParameter|StateMachine|UserPool|Stream)\w*)\s*\(/g;
const IMPORTED_KIND = /** @type {Record<string, string>} */ ({ Table: 'table', Function: 'function', Queue: 'queue', Topic: 'topic', Bucket: 'bucket', Secret: 'secret', StringParameter: 'parameter', StateMachine: 'state_machine', UserPool: 'user_pool', Stream: 'stream' });

/** The source with comments blanked out, so offsets and lines stay where they were. @param {string} s */
export function blankComments(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { const j = s.indexOf('\n', i); const e = j < 0 ? s.length : j; out += ' '.repeat(e - i); i = e; continue; }
    if (c === '/' && d === '*') { const j = s.indexOf('*/', i + 2); const e = j < 0 ? s.length : j + 2; out += s.slice(i, e).replace(/[^\n]/g, ' '); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') { const e = endOfString(s, i); out += s.slice(i, e); i = e; continue; }
    out += c; i++;
  }
  return out;
}
/** @param {string} s @param {number} i where a string starts @returns {number} just after it ends */
function endOfString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) { if (s[j] === '\\') j++; else if (s[j] === q) return j + 1; else if (q !== '`' && s[j] === '\n') return j; }
  return s.length;
}
/** The text between a bracket at `open` and its match. @param {string} s @param {number} open */
export function inside(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') { j = endOfString(s, j) - 1; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth === 0) return s.slice(open + 1, j);
  }
  return s.slice(open + 1);
}
/** Top-level comma-separated parts. @param {string} s */
export function parts(s) {
  const out = [];
  let depth = 0, from = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') { j = endOfString(s, j) - 1; continue; }
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(from, j).trim()); from = j + 1; }
  }
  const last = s.slice(from).trim();
  if (last) out.push(last);
  return out;
}
/** A key's value in an object literal's text, at its top level. @param {string} obj @param {string} key */
export function propOf(obj, key) {
  for (const p of parts(obj)) {
    const m = /^(?:['"]?)([\w$]+)(?:['"]?)\s*:\s*([\s\S]*)$/.exec(p);
    if (m && m[1] === key) return m[2].trim();
    if (p === key) return key; // shorthand
  }
  return null;
}

/** @param {string} root @param {string[]} files the repo's files @returns {Fact[]} */
export function tsCdkFacts(root, files) {
  const sources = files.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts') && !/(^|\/)(node_modules|cdk\.out|dist|build)\//.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !/(^|\/)(test|tests|__tests__)\//.test(f))
    .map((rel) => { try { return { rel, text: blankComments(fs.readFileSync(path.join(root, rel), 'utf8')) }; } catch { return null; } }) // unreadable: left out
    .filter(/** @returns {x is { rel: string, text: string }} */ (x) => !!x && x.text.length < 400_000);
  /** @type {Fact[]} */
  const facts = [];
  /** @param {string} kind @param {string} at @param {Record<string, any>} said */
  const add = (kind, at, said) => { const f = { id: `t${facts.length + 1}`, kind, at, ...said }; facts.push(f); return f; };

  // string constants anywhere in the repo, so a name given as FN_COPY reads as its value
  /** @type {Map<string, string>} */
  const constants = new Map();
  for (const { text } of sources) for (const m of text.matchAll(/(?:const|let|readonly|static)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(['"`])([^'"`$\n]{1,200})\2/g)) if (!constants.has(m[1])) constants.set(m[1], m[3]);
  for (const { text } of sources) for (const m of text.matchAll(/\b([A-Z][A-Za-z_]*)\s*=\s*(['"])([^'"\n]{1,200})\2\s*[,}\n]/g)) if (!constants.has(m[1])) constants.set(m[1], m[3]);
  /** A literal, a constant or a member naming one (`Names.Copy`), else null. @param {string | null} expr */
  const literal = (expr) => {
    if (!expr) return null;
    const e = expr.trim().replace(/\s+as\s+const$/, '');
    const q = /^(['"`])([^'"`$]*)\1$/.exec(e);
    if (q) return q[2];
    const id = /^(?:[\w$]+\.)*([\w$]+)$/.exec(e);
    return id ? constants.get(id[1]) ?? null : null;
  };
  /** @param {string} text @param {number} index */
  const lineAt = (text, index) => text.slice(0, index).split('\n').length;

  /** every construct, by file and the variable it is held in, for grants and the app's wiring */
  /** @type {Map<string, Fact>} */
  const held = new Map();
  /** class fields set to a construct: `UsersStack.table` → the table */
  /** @type {Map<string, Fact>} */
  const fields = new Map();
  for (const { rel, text } of sources) {
    if (!/aws-cdk-lib|@aws-cdk\//.test(text)) continue;
    const classes = [...text.matchAll(/class\s+([\w$]+)\s+extends\s+[\w$.]+/g)].map((m) => ({ name: m[1], at: m.index || 0 }));
    const classAt = (/** @type {number} */ i) => classes.filter((c) => c.at < i).at(-1)?.name || '';
    /** what holds the value an expression starting at `i` makes: `const x =` or `this.x =` @param {number} i */
    const holder = (i) => /(?:(?:const|let|var)\s+([\w$]+)|this\.([\w$]+))\s*(?::\s*[\w$.<>\[\]]+\s*)?=\s*$/.exec(text.slice(Math.max(0, i - 160), i));
    for (const m of text.matchAll(/\bnew\s+(?:[\w$]+\.)*([\w$]+)\s*\(/g)) {
      const kind = MADE[m[1]];
      if (!kind || m.index === undefined) continue;
      const args = parts(inside(text, m.index + m[0].length - 1));
      const id = literal(args[1] || '');
      if (args.length < 2 || !id) continue;
      const props = (args[2] || '').startsWith('{') ? inside(args[2], 0) : '';
      const name = NAMES.map((k) => literal(propOf(props, k))).find(Boolean);
      /** @type {Record<string, any>} */
      const said = { construct: m[1], logical_id: id, module: rel, ...(name ? { name } : {}) };
      if (kind === 'function') {
        const entry = /['"`]([^'"`]+\.(?:ts|js|py))['"`]/.exec(propOf(props, 'entry') || propOf(props, 'code') || '')?.[1];
        if (entry) said.entry = path.normalize(path.join(path.dirname(rel), entry)).replace(/^(\.\.\/)+/, '');
        const handler = literal(propOf(props, 'handler'));
        if (handler) said.handler = handler;
        const env = propOf(props, 'environment');
        if (env?.startsWith('{')) said.settings = Object.fromEntries(parts(inside(env, 0)).map((p) => /^['"]?([\w$]+)['"]?\s*:\s*([\s\S]+)$/.exec(p)).filter(Boolean).map((x) => [/** @type {RegExpExecArray} */ (x)[1], literal(/** @type {RegExpExecArray} */ (x)[2]) ?? /** @type {RegExpExecArray} */ (x)[2].replace(/\s+/g, ' ').slice(0, 120)]));
        said.routes = []; said.may = [];
      }
      if (kind === 'schedule') {
        const expr = propOf(props, 'schedule') || propOf(props, 'scheduleExpression');
        if (expr) said.schedule = (literal(expr) || expr).replace(/\s+/g, ' ').slice(0, 120);
        said.target_exprs = [...(propOf(props, 'targets') || '').matchAll(/new\s+(?:[\w$]+\.)*LambdaFunction\s*\(\s*([\w$.]+)/g), ...(propOf(props, 'target') || '').matchAll(/arn\s*:\s*([\w$.]+)\.functionArn/g)].map((x) => x[1]);
      }
      const f = add(kind, `${rel}:${lineAt(text, m.index)}#${id}`, said);
      const h = holder(m.index);
      if (h?.[1]) held.set(`${rel}:${h[1]}`, f);
      if (h?.[2]) { held.set(`${rel}:this.${h[2]}`, f); fields.set(`${classAt(m.index)}.${h[2]}`, f); }
    }
    for (const m of text.matchAll(IMPORTED)) {
      if (m.index === undefined) continue;
      const base = /^(?:Lambda)?(Table|Function|Queue|Topic|Bucket|Secret|StringParameter|StateMachine|UserPool|Stream)/.exec(m[2].replace(/^from/, ''))?.[1];
      const kind = base ? IMPORTED_KIND[base] : null;
      if (!kind) continue;
      const args = parts(inside(text, m.index + m[0].length - 1));
      const id = literal(args[1] || '') || m[2];
      const raw = args[2] || '';
      // a name, or the last part of an ARN that names it
      const name = literal(raw) || /(?:table\/|function:|:)([A-Za-z0-9_.-]{3,})['"`]?\s*$/.exec(raw)?.[1] || null;
      const f = kind === 'function'
        ? add('outside_function', `${rel}:${lineAt(text, m.index)}#${id}`, { name: name || id, module: rel, construct: `${m[1]}.${m[2]}` })
        : add('construct', `${rel}:${lineAt(text, m.index)}#${id}`, { construct: `${m[1]}.${m[2]}`, logical_id: id, module: rel, imported: kind, ...(name ? { name, [`${kind}_name`]: JSON.stringify(name) } : {}) });
      const h = holder(m.index);
      if (h?.[1]) held.set(`${rel}:${h[1]}`, f);
      if (h?.[2]) { held.set(`${rel}:this.${h[2]}`, f); fields.set(`${classAt(m.index)}.${h[2]}`, f); }
    }
  }
  // the app's wiring: `const users = new UsersStack(…)`, then `usersTable: users.table` hands that table on as a prop
  /** @type {Map<string, string>} */
  const stackOf = new Map();
  for (const { text } of sources) for (const m of text.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*new\s+([\w$]+)\s*\(/g)) stackOf.set(m[1], m[2]);
  /** @type {Map<string, Fact>} */
  const props = new Map();
  for (const { text } of sources) for (const m of text.matchAll(/([\w$]+)\s*:\s*([\w$]+)\.([\w$]+)\s*[,}\n]/g)) {
    const f = fields.get(`${stackOf.get(m[2])}.${m[3]}`);
    if (f && !props.has(m[1])) props.set(m[1], f);
  }
  /** The construct an expression names, in this file or handed in as a prop. @param {string} rel @param {string} expr */
  const resolve = (rel, expr) => {
    const e = expr.trim().replace(/!$/, '').replace(/\.(functionArn|tableArn|queueArn|queueUrl|topicArn|bucketArn|secretArn|stateMachineArn|functionName|tableName|queueName|parameterName)$/, '');
    const prop = /^(?:this\.)?props\.([\w$]+)$/.exec(e);
    return held.get(`${rel}:${e}`) || (prop ? props.get(prop[1]) : undefined) || null;
  };
  const lid = (/** @type {Fact} */ f) => String(f.at).split('#')[1];

  for (const { rel, text } of sources) {
    if (!/aws-cdk-lib|@aws-cdk\//.test(text)) continue;
    // grants: `table.grantReadData(fn)`
    for (const m of text.matchAll(/([\w$.!]+)\.(grant\w*)\s*\(/g)) {
      if (m.index === undefined) continue;
      const to = parts(inside(text, m.index + m[0].length - 1))[0] || '';
      const res = resolve(rel, m[1]), fn = resolve(rel, to);
      add('grant', `${rel}:${lineAt(text, m.index)}`, { module: rel, resource: m[1], verb: m[2], to, ...(res?.name ? { resource_name: res.name } : {}) });
      if (fn?.kind === 'function' && res) fn.may.push({ services: [m[2]], on: [lid(res)] });
    }
    // policy statements a function is given: what it may do, on what
    for (const m of text.matchAll(/([\w$.!]+)\.(?:addToRolePolicy|addToPrincipalPolicy)\s*\(\s*new\s+(?:[\w$]+\.)*PolicyStatement\s*\(/g)) {
      if (m.index === undefined) continue;
      const fn = resolve(rel, m[1]);
      const body = inside(text, m.index + m[0].length - 1);
      const obj = body.trim().startsWith('{') ? inside(body.trim(), 0) : '';
      const actions = [...(propOf(obj, 'actions') || '').matchAll(/['"`]([\w*-]+:[\w*]+)['"`]/g)].map((x) => x[1]);
      const resources = parts(inside(propOf(obj, 'resources') || '[]', 0));
      const on = resources.map((r) => resolve(rel, r)).filter((x) => !!x).map((x) => lid(/** @type {Fact} */ (x)));
      const arns = resources.map((r) => literal(r) || (/^`[^`]*`$/.test(r) ? r.slice(1, -1) : null)).filter((x) => !!x);
      const named = resources.map((r) => /:function:([A-Za-z0-9_-]+)/.exec(r)?.[1]).filter((x) => !!x);
      if (fn?.kind === 'function') fn.may.push({ services: [...new Set(actions.map((a) => a.split(':')[0]))], on, ...(arns.length ? { arns } : {}) });
      if (named.length && actions.some((a) => /^lambda:Invoke/.test(a))) add('invokes_by_name', `${rel}:${lineAt(text, m.index)}`, { module: rel, names: named, ...(fn?.name ? { from: fn.name } : {}) });
    }
    // event sources: `fn.addEventSource(new SqsEventSource(queue))`
    for (const m of text.matchAll(/([\w$.!]+)\.addEventSource\s*\(\s*new\s+(?:[\w$]+\.)*(\w+EventSource)\s*\(\s*([\w$.!]+)/g)) {
      if (m.index === undefined) continue;
      const fn = resolve(rel, m[1]), src = resolve(rel, m[3]);
      add('event_source', `${rel}:${lineAt(text, m.index)}`, { module: rel, source: m[2], functions: fn ? [lid(fn)] : [], from: src ? [lid(src)] : [], ...(fn?.name ? { function: fn.name } : {}) });
    }
    // routes: `api.root.addResource('user').addResource('{id}')` and `.addMethod('GET', new LambdaIntegration(fn))`
    /** @type {Map<string, string>} */
    const paths = new Map();
    /** @param {string} expr */
    const pathOf = (expr) => {
      let e = expr.trim(), suffix = '';
      for (;;) {
        const step = /^([\s\S]*)\.addResource\s*\(\s*(['"`])([^'"`]+)\2[^)]*\)$/.exec(e);
        if (step) { suffix = `/${step[3]}${suffix}`; e = step[1].trim(); continue; }
        const at = /^([\s\S]*)\.resourceForPath\s*\(\s*(['"`])([^'"`]+)\2\s*\)$/.exec(e);
        if (at) return at[3].replace(/\/$/, '') + suffix;
        break;
      }
      if (/\.root$/.test(e)) return suffix || '/';
      const known = paths.get(e);
      return known !== undefined ? (known === '/' ? '' : known) + suffix || '/' : null;
    };
    for (const m of text.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*([\w$.]+(?:\s*\.\s*(?:addResource|resourceForPath)\s*\([^)]*\))+)/g)) {
      const p = pathOf(m[2].replace(/\s+\./g, '.'));
      if (p !== null) paths.set(m[1], p);
    }
    for (const m of text.matchAll(/([\w$.]+(?:\.(?:addResource|resourceForPath)\s*\([^)]*\))*)\s*\.addMethod\s*\(\s*(['"`])(\w+)\2\s*,\s*new\s+(?:[\w$]+\.)*LambdaIntegration\s*\(\s*([\w$.!]+)/g)) {
      const p = pathOf(m[1]);
      const fn = resolve(rel, m[4]);
      if (p !== null && fn?.kind === 'function') fn.routes.push(`${m[3]} ${p}`);
      else if (p !== null && fn?.kind === 'outside_function') (fn.routes ||= []).push(`${m[3]} ${p}`);
    }
  }
  // what runs a function on a schedule
  for (const f of facts) if (f.kind === 'schedule') {
    const rel = String(f.at).split(':')[0];
    f.targets = (f.target_exprs || []).map((/** @type {string} */ e) => resolve(rel, e)).filter((/** @type {any} */ x) => x?.kind === 'function').map((/** @type {Fact} */ x) => lid(x));
    delete f.target_exprs;
    if (!f.targets.length) delete f.targets;
  }
  for (const f of facts) if (f.kind === 'function') { if (!f.routes.length) delete f.routes; if (!f.may.length) delete f.may; }

  // handler code: AWS SDK commands and the names they are given, and the settings read
  for (const { rel, text } of sources) {
    if (/aws-cdk-lib|@aws-cdk\//.test(text)) continue;
    const seenEnv = new Set();
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g)) {
      const name = m[1] || m[2];
      if (seenEnv.has(name)) continue;
      seenEnv.add(name);
      add('env_read', `${rel}:${lineAt(text, m.index || 0)}`, { module: rel, name });
    }
    for (const m of text.matchAll(/new\s+(\w+Command)\s*\(\s*\{/g)) {
      if (m.index === undefined) continue;
      const obj = inside(text, m.index + m[0].length - 1);
      /** @type {Record<string, string>} */
      const names = {};
      for (const k of ['TableName', 'FunctionName', 'QueueUrl', 'TopicArn', 'Bucket', 'SecretId', 'Name', 'stateMachineArn', 'StateMachineArn']) {
        const v = propOf(obj, k);
        if (v) names[k] = literal(v) ?? v.replace(/\s+/g, ' ').slice(0, 80);
      }
      add('aws_call', `${rel}:${lineAt(text, m.index)}`, { module: rel, call: m[1], ...names });
      if (m[1] === 'InvokeCommand' && names.FunctionName && /^[\w-]+$/.test(names.FunctionName)) add('invokes_by_name', `${rel}:${lineAt(text, m.index)}`, { module: rel, names: [names.FunctionName] });
    }
  }
  return facts;
}
