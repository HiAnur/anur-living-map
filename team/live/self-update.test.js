import { describe, expect, it } from 'vitest';

import { selfUpdate } from './self-update.js';

// Keeping itself current never cuts Claude's work short: while a map is busy, nothing is pulled or restarted.

/** A stand-in git on main, two commits behind origin's newest release, whose move to it fails so nothing on disk changes. */
function fakeGit() {
  /** @type {string[]} */
  const calls = [];
  const git = async (/** @type {any[]} */ ...a) => {
    const cmd = a.filter((x) => !String(x).startsWith('http.') && x !== '-c').join(' ');
    calls.push(cmd);
    if (cmd === 'rev-parse --is-inside-work-tree') return 'true';
    if (cmd === 'describe --tags --abbrev=0 --match v[0-9]* origin/main') return 'v0.1.42';
    if (cmd === 'describe --tags --abbrev=0 --match dev-[0-9]* --match v[0-9]* origin/main') return 'dev-0.1.45';
    if (cmd === 'rev-list --count HEAD..v0.1.42') return '2';
    if (cmd === 'rev-list --count HEAD..dev-0.1.45') return '5';
    if (cmd === 'branch --show-current') return 'main';
    if (cmd.startsWith('merge')) return null;
    return '';
  };
  return { git, calls, pulled: () => calls.filter((c) => c.startsWith('merge')).length };
}
const server = /** @type {any} */ ({ closeAllConnections() {}, close() {} });
const until = async (/** @type {() => boolean} */ ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); expect(ok()).toBe(true); };

describe('keeping itself current', () => {
  it('waits while Claude is at work on a map, and updates once all is quiet', async () => {
    let busy = true;
    const g = fakeGit();
    const { keepCurrent } = selfUpdate(server, () => busy, { git: g.git, wait: 10, channel: 'stable' });
    await keepCurrent();
    expect(g.pulled()).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(g.pulled()).toBe(0);
    busy = false;
    await until(() => g.pulled() === 1);
  });
  it('updates at once when nothing is at work', async () => {
    const g = fakeGit();
    await selfUpdate(server, () => false, { git: g.git, channel: 'stable' }).keepCurrent();
    expect(g.pulled()).toBe(1);
  });
  it('moves to the newest release, never to main itself', async () => {
    const g = fakeGit();
    const u = selfUpdate(server, () => false, { git: g.git, channel: 'stable' });
    expect(await u.checkLatest()).toBe(false);
    expect(u.VERSION.behind).toBe(2);
    await u.pull();
    expect(g.calls).toContain('merge -q --ff-only v0.1.42');
    expect(g.calls.some((c) => c.startsWith('pull') || c.includes('origin/main') && !c.startsWith('describe'))).toBe(false);
  });
  it('on the dev channel, moves to the newest passing build, which customers never see unreleased', async () => {
    const g = fakeGit();
    const u = selfUpdate(server, () => false, { git: g.git, channel: 'dev' });
    expect(u.VERSION.channel).toBe('dev');
    expect(await u.checkLatest()).toBe(false);
    expect(u.VERSION.behind).toBe(5);
    await u.pull();
    expect(g.calls).toContain('merge -q --ff-only dev-0.1.45');
    // the stable channel never asks for dev builds
    const s = fakeGit();
    await selfUpdate(server, () => false, { git: s.git, channel: 'stable' }).checkLatest();
    expect(s.calls.some((c) => c.includes('dev-'))).toBe(false);
  });
});
