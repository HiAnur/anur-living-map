// The facts about one repo, read by code: no model, nothing installed or run. Which readers apply follows from
// what the repo holds: its compiled CloudFormation (`cdk.out`), its Python source, an app's source, an Amplify
// project, its manifests, the routes a Node server serves, a Swift package or Apple app, a static site, and its deploy
// and release scripts. Every fact has an id, a kind, what it says, and where it came from (`path:line`, or a template and logical
// id). These are what a system map is drawn from: the agent may only propose boxes and lines that cite them, and code
// checks every citation (the rules in issue #363).
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { amplifyFacts, appFacts } from './system-facts-app.js';
import { cfnFacts } from './system-facts-cfn.js';
import { deployFacts } from './system-facts-deploy.js';
import { manifestFacts } from './system-facts-manifest.js';
import { routeFacts } from './system-facts-routes.js';
import { siteFacts } from './system-facts-site.js';
import { swiftFacts } from './system-facts-swift.js';
import { onGitHub } from './system-work.js';
import { tsCdkFacts } from './system-facts-ts.js';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */

const PYTHON = path.join(import.meta.dirname, 'system_facts.py');

// Tests and their fixtures say what code might do, not what it does: a call in a test's sample app is not a call the
// system makes. Every reader is handed the repo's files with these left out, so none of them reads one.
const TEST_FILE = /(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures?)\/|\.(test|spec|harness)\.[^/]+$|(^|\/)(test_[^/]*\.py|[^/]*_test\.(py|go)|conftest\.py)$/i;
/** Whether a file is a test, or a fixture or harness tests use. @param {string} f a path in the repo */
export const isTestFile = (f) => TEST_FILE.test(f);

/** The repo's files, as git lists them (or every file, for a folder that is not a repo). @param {string} root @returns {string[]} */
export function repoFiles(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    /** @type {string[]} */
    const out = [];
    /** @param {string} dir */
    const walk = (dir) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; const rel = path.join(dir, e.name); e.isDirectory() ? walk(rel) : out.push(rel); } };
    walk('');
    return out.slice(0, 20000);
  }
}

/** The commit a repo is at, and its branch, or nothing for a folder that is not a repo. @param {string} root @returns {{ commit: string, branch: string } | null} */
export function repoHead(root) {
  try {
    const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const branch = execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { commit, branch };
  } catch {
    // a repo downloaded from GitHub (github.js) has no .git: it says which commit it is beside its files
    try { const { commit, branch } = JSON.parse(fs.readFileSync(path.join(root, '.living-map-head.json'), 'utf8')); return { commit: String(commit), branch: String(branch) }; }
    catch { return null; } // a folder that is neither: no commit to name
  }
}

/**
 * The repo on GitHub a folder is, for links to its files: a download says so beside its files, a clone by its origin.
 * @param {string} root @returns {{ owner: string, name: string } | null}
 */
export function githubOf(root) {
  try {
    const [owner, name] = String(JSON.parse(fs.readFileSync(path.join(root, '.living-map-head.json'), 'utf8')).repo || '').split('/');
    if (owner && name) return { owner, name };
  } catch { /* not a download: its clone's origin says */ }
  return onGitHub(root);
}

/**
 * Python facts, from system_facts.py run with the Mac's python3 on the files it is handed; none when python3 is missing.
 * @param {string} root @param {string[]} files the repo's Python files, tests left out @returns {Promise<Fact[]>}
 */
export function pythonFacts(root, files) {
  return new Promise((resolve) => {
    const child = execFile('python3', ['-I', PYTHON, root], { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (error, out) => {
      if (error) return resolve([]);
      try { resolve(JSON.parse(out).facts || []); } catch { resolve([]); }
    });
    // python3 missing or gone before it read the list: the callback above answers with no facts
    child.stdin?.on('error', () => {});
    child.stdin?.end(files.join('\n'));
  });
}

/**
 * Everything code can read about one repo: what kinds of source it holds, the facts, and the commit they are from.
 * @param {string} root the repo's folder
 * @returns {Promise<{ repo: string, root: string, head: { commit: string, branch: string } | null, kinds: string[], facts: Fact[], unread: string[], github: { owner: string, name: string } | null }>}
 */
export async function readRepo(root) {
  const files = repoFiles(root).filter((f) => !isTestFile(f));
  /** @type {string[]} */
  const kinds = [];
  /** @type {Fact[]} */
  const facts = [];
  const cfn = cfnFacts(root);
  if (cfn.length) { kinds.push('cloudformation'); facts.push(...cfn); }
  const pyFiles = files.filter((f) => f.endsWith('.py'));
  const py = pyFiles.length ? await pythonFacts(root, pyFiles) : [];
  // a repo whose infrastructure came from cdk.out keeps its Python code facts, not its CDK constructs twice
  const pyKept = cfn.length ? py.filter((f) => !['construct', 'grant', 'policy', 'link'].includes(f.kind)) : py;
  const pyCdk = files.includes('cdk.json') && !cfn.length && /python/.test(fs.readFileSync(path.join(root, 'cdk.json'), 'utf8'));
  if (pyKept.length) { kinds.push(pyCdk ? 'python-cdk' : 'python'); facts.push(...pyKept); }
  // CDK in TypeScript with nothing compiled, as a repo from GitHub is: read from its source
  const tsCdk = files.includes('cdk.json') && !cfn.length && !/python/.test(fs.readFileSync(path.join(root, 'cdk.json'), 'utf8'));
  const ts = tsCdk ? tsCdkFacts(root, files) : [];
  if (ts.length) { kinds.push('typescript-cdk'); facts.push(...ts); }
  const app = appFacts(root, files);
  if (app.length) { kinds.push('app'); facts.push(...app); }
  const amp = amplifyFacts(root);
  if (amp.length) { kinds.push('amplify'); facts.push(...amp); }
  const man = manifestFacts(root, files);
  if (man.some((f) => f.kind === 'container' || f.kind === 'compose_service')) kinds.push('containers');
  if (man.some((f) => f.kind === 'api_spec')) kinds.push('openapi');
  facts.push(...man);
  const served = routeFacts(root, files);
  if (served.length) { kinds.push('server'); facts.push(...served); }
  const swift = swiftFacts(root, files);
  if (swift.some((f) => f.kind === 'apple_app' || f.kind === 'swift_target')) kinds.push(swift.some((f) => f.kind === 'apple_app') ? 'apple-app' : 'swift');
  facts.push(...swift);
  const site = siteFacts(root, files);
  if (site.length) { kinds.push('site'); facts.push(...site); }
  const deploy = deployFacts(root, files);
  if (deploy.some((f) => f.kind === 'deploy_target')) kinds.push('deploy');
  facts.push(...deploy);
  facts.forEach((f, i) => { f.id = `f${i + 1}`; });
  /** @type {string[]} */
  const unread = [];
  if (tsCdk && !ts.some((f) => f.kind === 'function')) unread.push('Its infrastructure is CDK in TypeScript, and no function could be read from its source.');
  return { repo: path.basename(root), root, head: repoHead(root), kinds, facts, unread, github: githubOf(root) };
}
