// A build Action works on its own branch, in its own worktree, and ends in a pull request. Code does every git and
// GitHub step here: before the run it makes the branch and worktree from the default branch; after it, it commits
// what the run changed, pushes the branch and opens the pull request. The run only edits files and runs checks in
// the worktree it is given (its hook refuses git push and gh), so the project's own checkout is never touched.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ repo: string, base: string, from: string, branch: string, worktree: string }} Build */

// git run inside a git hook inherits where that repository is (GIT_DIR, GIT_INDEX_FILE, …); every command here names
// its own repository, so those are left out
const env = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_(DIR|INDEX_FILE|WORK_TREE|PREFIX|OBJECT_DIRECTORY|COMMON_DIR)$/.test(key)));
/** @param {string} cwd @param {string[]} args @returns {Promise<{ ok: boolean, out: string, err: string }>} */
const git = (cwd, ...args) => new Promise((resolve) => {
  execFile('git', ['-C', cwd, ...args], { timeout: 120_000, env: env() }, (error, out, err) => resolve({ ok: !error, out: String(out).trim(), err: String(err || error?.message || '').trim() }));
});

/**
 * The worktree and branch a build runs in: made on its first Execute from the default branch, and found again (or
 * made again from its branch) on Continue.
 * @param {{ project: string, root: string, action: { id: string, build?: Build }, box: { id: string } }} job
 * @returns {Promise<Build | { error: string }>}
 */
export async function openBuild({ project, root, action, box }) {
  const top = await git(project, 'rev-parse', '--show-toplevel');
  if (!top.ok) return { error: 'A build needs its project to be a git repository, so it can work on a branch of its own.' };
  const repo = top.out;
  if (action.build) {
    if (fs.existsSync(action.build.worktree)) return action.build;
    const again = await git(repo, 'worktree', 'add', action.build.worktree, action.build.branch);
    return again.ok ? action.build : { error: `Could not open this build's branch ${action.build.branch} again: ${again.err.slice(0, 200)}` };
  }
  const head = await git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  const base = head.ok ? head.out.replace(/^origin\//, '') : (await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).out || 'main';
  if (head.ok) await git(repo, 'fetch', '-q', 'origin', base);
  const from = head.ok ? `origin/${base}` : base;
  const slug = String(box.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'box';
  const branch = `action/${slug}-${String(action.id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
  const worktree = path.join(root, branch.replace('/', '-'));
  fs.mkdirSync(root, { recursive: true });
  const added = await git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, from);
  if (!added.ok) return { error: `Could not make a branch for this build: ${added.err.slice(0, 200)}` };
  return { repo, base, from, branch, worktree };
}

/**
 * After a run: commit what it changed, push the branch and open its pull request (or find the one Continue already
 * opened). `pull` is the pull request's link, or null with `note` saying why there is none.
 * @param {{ build: Build, title: string, body: string, openPull?: typeof ghPull }} job
 * @returns {Promise<{ commits: number, pull: string | null, note: string }>}
 */
export async function closeBuild({ build, title, body, openPull = ghPull }) {
  const { repo, base, from, branch, worktree } = build;
  await git(worktree, 'add', '-A');
  // `diff --cached --quiet` fails exactly when something is staged
  if (!(await git(worktree, 'diff', '--cached', '--quiet')).ok) {
    const committed = await git(worktree, 'commit', '-q', '-m', title);
    if (!committed.ok) return { commits: 0, pull: null, note: `Could not commit what the run changed on the branch ${branch}: ${committed.err.slice(0, 200)}` };
  }
  const commits = Number((await git(worktree, 'rev-list', '--count', `${from}..HEAD`)).out) || 0;
  if (!commits) return { commits, pull: null, note: 'The run changed nothing, so there is nothing to open a pull request for.' };
  const remote = await git(repo, 'remote', 'get-url', 'origin');
  if (!remote.ok) return { commits, pull: null, note: `Committed on the branch ${branch}. This project has no remote, so no pull request was opened.` };
  const pushed = await git(worktree, 'push', '-q', '-u', 'origin', branch);
  if (!pushed.ok) return { commits, pull: null, note: `Committed on the branch ${branch}, but pushing it failed: ${pushed.err.slice(0, 200)}` };
  if (!/github\.com[:/]/.test(remote.out)) return { commits, pull: null, note: `Pushed the branch ${branch}. Its remote is not on GitHub, so no pull request was opened.` };
  const pull = await openPull({ cwd: worktree, base, branch, title, body });
  if (!pull) return { commits, pull: null, note: `Pushed the branch ${branch}, but GitHub did not open a pull request for it.` };
  await git(repo, 'worktree', 'remove', '--force', worktree);
  return { commits, pull, note: '' };
}

/**
 * Opens a branch's pull request with the gh CLI, or finds the one it already has; null when gh cannot.
 * @param {{ cwd: string, base: string, branch: string, title: string, body: string }} pr
 * @returns {Promise<string | null>}
 */
export const ghPull = ({ cwd, base, branch, title, body }) => new Promise((resolve) => {
  const link = (/** @type {string} */ out) => out.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0] || null;
  execFile('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body], { cwd, timeout: 60_000 }, (error, out) => {
    if (!error && link(String(out))) return resolve(link(String(out)));
    execFile('gh', ['pr', 'view', branch, '--json', 'url', '-q', '.url'], { cwd, timeout: 30_000 }, (again, found) => resolve(again ? null : link(String(found))));
  });
});
