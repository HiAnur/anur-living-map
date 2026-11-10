import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closeBuild, openBuild } from './action-build.js';

// Real git, on a throwaway project whose origin is a bare repository on disk. Its path contains github.com/, so it
// passes for a GitHub remote; opening the pull request itself is the one step handed in.
const dirs = /** @type {string[]} */ ([]);
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
// a test run from a git hook would otherwise inherit that repository's location; and commits need a name
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete process.env[key];
Object.assign(process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' });
const sh = (/** @type {string} */ cwd, /** @type {string[]} */ ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
function project({ remote = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-build-')); dirs.push(root);
  const origin = path.join(root, 'github.com', 'acme', 'app.git'), repo = path.join(root, 'app');
  fs.mkdirSync(origin, { recursive: true }); sh(origin, 'init', '-q', '--bare', '-b', 'main');
  fs.mkdirSync(repo); sh(repo, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-q', '-m', 'first');
  if (remote) { sh(repo, 'remote', 'add', 'origin', origin); sh(repo, 'push', '-q', '-u', 'origin', 'main'); sh(repo, 'remote', 'set-head', 'origin', 'main'); }
  return { root, repo, origin, worktrees: path.join(root, 'worktrees') };
}
const action = { id: 'ab12cd34-0000', brief: { goal: 'Add the form' } };

describe('a build on its own branch', () => {
  it('works in a worktree from the default branch, leaving the project\'s checkout alone', async () => {
    const p = project();
    const build = /** @type {any} */ (await openBuild({ project: p.repo, root: p.worktrees, action, box: { id: 'Contact form' } }));
    expect(build).toMatchObject({ base: 'main', from: 'origin/main', branch: 'action/contact-form-ab12cd34' });
    expect(fs.existsSync(path.join(build.worktree, 'a.txt'))).toBe(true);
    expect(build.worktree.startsWith(p.worktrees)).toBe(true);
    expect(sh(p.repo, 'branch', '--show-current')).toBe('main');
    expect(sh(p.repo, 'status', '--porcelain')).toBe('');
  });
  it('commits what the run changed, pushes the branch and opens its pull request', async () => {
    const p = project(), asked = /** @type {any[]} */ ([]);
    const build = /** @type {any} */ (await openBuild({ project: p.repo, root: p.worktrees, action, box: { id: 'form' } }));
    fs.writeFileSync(path.join(build.worktree, 'form.html'), '<form></form>\n');
    const done = await closeBuild({ build, title: 'Add the form', body: 'From the map', openPull: async (pr) => { asked.push(pr); return 'https://github.com/acme/app/pull/7'; } });
    expect(done).toEqual({ commits: 1, pull: 'https://github.com/acme/app/pull/7', note: '' });
    expect(asked[0]).toMatchObject({ base: 'main', branch: build.branch, title: 'Add the form', body: 'From the map' });
    expect(sh(p.origin, 'log', '--format=%s', build.branch)).toBe('Add the form\nfirst');
    expect(fs.existsSync(build.worktree)).toBe(false);
    expect(sh(p.repo, 'status', '--porcelain')).toBe('');
  });
  it('opens no pull request for a run that changed nothing', async () => {
    const p = project();
    const build = /** @type {any} */ (await openBuild({ project: p.repo, root: p.worktrees, action, box: { id: 'form' } }));
    const done = await closeBuild({ build, title: 'Add the form', body: '', openPull: async () => 'https://github.com/acme/app/pull/9' });
    expect(done).toMatchObject({ commits: 0, pull: null });
    expect(done.note).toMatch(/changed nothing/);
  });
  it('keeps the commit on its branch when the project has no remote, and says so', async () => {
    const p = project({ remote: false });
    const build = /** @type {any} */ (await openBuild({ project: p.repo, root: p.worktrees, action, box: { id: 'form' } }));
    expect(build.from).toBe('main');
    fs.writeFileSync(path.join(build.worktree, 'b.txt'), 'two\n');
    const done = await closeBuild({ build, title: 'Add b', body: '' });
    expect(done).toMatchObject({ commits: 1, pull: null });
    expect(done.note).toMatch(/no remote/);
    expect(sh(p.repo, 'log', '--format=%s', build.branch)).toBe('Add b\nfirst');
  });
  it('opens the same branch again on Continue after its worktree was removed', async () => {
    const p = project();
    const build = /** @type {any} */ (await openBuild({ project: p.repo, root: p.worktrees, action, box: { id: 'form' } }));
    fs.writeFileSync(path.join(build.worktree, 'form.html'), '<form></form>\n');
    await closeBuild({ build, title: 'Add the form', body: '', openPull: async () => 'https://github.com/acme/app/pull/7' });
    const again = /** @type {any} */ (await openBuild({ project: p.repo, root: p.worktrees, action: { ...action, build }, box: { id: 'form' } }));
    expect(again).toEqual(build);
    expect(fs.readFileSync(path.join(again.worktree, 'form.html'), 'utf8')).toBe('<form></form>\n');
  });
  it('refuses a project that is not a git repository', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-build-')); dirs.push(root);
    expect(await openBuild({ project: root, root: path.join(root, 'w'), action, box: { id: 'form' } })).toEqual({ error: expect.stringMatching(/git repository/) });
  });
});
