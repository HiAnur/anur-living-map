import { describe, expect, it } from 'vitest';

import { selfUpdate } from './self-update.js';

// Keeping itself current never cuts Claude's work short: while a map is busy, nothing is pulled or restarted.

/** A stand-in git on main with two new commits on origin, whose pull fails so nothing on disk changes. */
function fakeGit() {
  /** @type {string[]} */
  const calls = [];
  const git = async (/** @type {any[]} */ ...a) => {
    const cmd = a.filter((x) => !String(x).startsWith('http.') && x !== '-c').join(' ');
    calls.push(cmd);
    if (cmd === 'rev-parse --is-inside-work-tree') return 'true';
    if (cmd.startsWith('rev-list --count HEAD..origin/main')) return '2';
    if (cmd === 'branch --show-current') return 'main';
    if (cmd.startsWith('pull')) return null;
    return '';
  };
  return { git, calls, pulled: () => calls.filter((c) => c.startsWith('pull')).length };
}
const server = /** @type {any} */ ({ closeAllConnections() {}, close() {} });
const until = async (/** @type {() => boolean} */ ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); expect(ok()).toBe(true); };

describe('keeping itself current', () => {
  it('waits while Claude is at work on a map, and updates once all is quiet', async () => {
    let busy = true;
    const g = fakeGit();
    const { keepCurrent } = selfUpdate(server, () => busy, { git: g.git, wait: 10 });
    await keepCurrent();
    expect(g.pulled()).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(g.pulled()).toBe(0);
    busy = false;
    await until(() => g.pulled() === 1);
  });
  it('updates at once when nothing is at work', async () => {
    const g = fakeGit();
    await selfUpdate(server, () => false, { git: g.git }).keepCurrent();
    expect(g.pulled()).toBe(1);
  });
});
