// The facts about one repo, read by code: no model, nothing installed or run. Which readers apply follows from
// what the repo holds: its compiled CloudFormation (`cdk.out`), its Python source, an app's source, an Amplify
// project. Every fact has an id, a kind, what it says, and where it came from (`path:line`, or a template and logical
// id). These are what a system map is drawn from: the agent may only propose boxes and lines that cite them, and code
// checks every citation (the rules in issue #363).
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { amplifyFacts, appFacts } from './system-facts-app.js';
import { cfnFacts } from './system-facts-cfn.js';

/** @typedef {{ id: string, kind: string, at: string, [said: string]: any }} Fact */

const PYTHON = path.join(import.meta.dirname, 'system_facts.py');

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

/** Python facts, from system_facts.py run with the Mac's python3; none when python3 is missing. @param {string} root @returns {Promise<Fact[]>} */
export function pythonFacts(root) {
  return new Promise((resolve) => {
    execFile('python3', ['-I', PYTHON, root], { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (error, out) => {
      if (error) return resolve([]);
      try { resolve(JSON.parse(out).facts || []); } catch { resolve([]); }
    });
  });
}

/**
 * Everything code can read about one repo: what kinds of source it holds, the facts, and the commit they are from.
 * @param {string} root the repo's folder
 * @returns {Promise<{ repo: string, root: string, head: { commit: string, branch: string } | null, kinds: string[], facts: Fact[], unread: string[] }>}
 */
export async function readRepo(root) {
  const files = repoFiles(root);
  /** @type {string[]} */
  const kinds = [];
  /** @type {Fact[]} */
  const facts = [];
  const cfn = cfnFacts(root);
  if (cfn.length) { kinds.push('cloudformation'); facts.push(...cfn); }
  const py = files.some((f) => f.endsWith('.py')) ? await pythonFacts(root) : [];
  // a repo whose infrastructure came from cdk.out keeps its Python code facts, not its CDK constructs twice
  const pyKept = cfn.length ? py.filter((f) => !['construct', 'grant', 'policy', 'link'].includes(f.kind)) : py;
  if (pyKept.length) { kinds.push(files.includes('cdk.json') && !cfn.length ? 'python-cdk' : 'python'); facts.push(...pyKept); }
  const app = appFacts(root, files);
  if (app.length) { kinds.push('app'); facts.push(...app); }
  const amp = amplifyFacts(root);
  if (amp.length) { kinds.push('amplify'); facts.push(...amp); }
  facts.forEach((f, i) => { f.id = `f${i + 1}`; });
  /** @type {string[]} */
  const unread = [];
  // CDK in TypeScript is read only from what it compiles to, which git does not keep
  if (files.includes('cdk.json') && !cfn.length && !/python/.test(fs.readFileSync(path.join(root, 'cdk.json'), 'utf8'))) {
    unread.push('Its infrastructure is CDK in TypeScript with no cdk.out here: run `npx cdk synth` in it so the map can read its functions, tables and permissions.');
  }
  return { repo: path.basename(root), root, head: repoHead(root), kinds, facts, unread };
}
