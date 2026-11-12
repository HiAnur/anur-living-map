// ── keeps itself current ──
// Run from a git clone on main with no changes of its own, the server looks at GitHub when it starts and every
// ten minutes, moves to the newest release (the v* tag CI puts on each push to main that passed its checks, never
// main itself), refreshes the skill's installed copy (chats.skillDir), and starts itself again in its place: every change is on disk already, pages and listeners reconnect by themselves. While Claude is at work
// on a map (a reply, an Action, a drawing) it neither pulls nor restarts, and looks again shortly. A copy without git
// (npx) is left to npx, which fetches the newest version each run. The commit it runs from goes in
// server.rev in the data folder (data-dir.js), which /anur-living-map reads to tell a server on older code.
// ANUR_LIVING_MAP_NO_UPDATE=1 turns the automatic look off; the map's update button still works.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { chats } from './agent.js';
import { DATA } from './data-dir.js';

const DIR = import.meta.dirname;

/**
 * @param {import('node:http').Server} server the server to start again in its place after a pull
 * @param {() => boolean} [busy] whether Claude is at work on a map now, when an update waits
 * @param {{ git?: (...a: any[]) => Promise<string | null>, wait?: number }} [test] stand-ins for git and the wait, in tests
 */
export function selfUpdate(server, busy = () => false, test = {}) {
  const REPO = path.resolve(DIR, '..', '..');
  const REV = path.join(DATA, 'server.rev');
  const git = test.git || ((/** @type {any[]} */ ...a) => new Promise((ok) => execFile('git', ['-C', REPO, ...a], { encoding: 'utf8' }, (e, out) => ok(e ? null : out.trim()))));
  const EVERY = 10 * 60_000;
  // the skill's copy is replaced file by file through a rename, never written in place: bash reads a running script
  // by offset, so writing over open-map.sh while /anur-living-map runs would tear it mid-line
  function refreshSkill() {
    // the map's own agent always has a copy; another agent's copy is kept current once it has one
    const src = path.join(REPO, 'team', 'skill', 'anur-living-map'), main = chats.skillDir('anur-living-map');
    for (const dst of new Set([main, ...(chats.skillDirs?.('anur-living-map') || []).filter((d) => fs.existsSync(d))]))
      for (const f of /** @type {string[]} */ (fs.readdirSync(src, { recursive: true }))) {
        const s = path.join(src, f), d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) continue;
        fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, `${d}.new`); fs.renameSync(`${d}.new`, d);
      }
  }
  // the newest release: the last v* tag on origin's main, which CI tags only once a push passed its checks
  /** @type {string | null} */
  let release = null;
  // asks origin how many commits the newest release holds that this clone does not; null when this is not a clone
  // or origin is out of reach
  const GIT_NET = ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=4'];
  async function checkLatest() {
    if ((await git('rev-parse', '--is-inside-work-tree')) !== 'true') return null;
    if ((await git(...GIT_NET, 'fetch', '-q', '--tags', 'origin', 'main')) === null) return VERSION.latest;
    release = await git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'origin/main');
    // no release yet: nothing to move to
    VERSION.behind = release ? Number(await git('rev-list', '--count', `HEAD..${release}`)) || 0 : 0;
    VERSION.latest = VERSION.behind === 0;
    return VERSION.latest;
  }
  // why a pull cannot run: the clone is on another branch or has changes of its own; '' when it can
  async function cannotUpdate() {
    const branch = await git('branch', '--show-current');
    if (branch !== 'main') return branch ? `this copy is on the branch ${branch}, not main` : 'this copy is a preview, not main';
    // only edits to tracked files block a pull: a map's own .living-map/ folder or any other new file does not
    if (await git('status', '--porcelain', '--untracked-files=no')) return 'this copy has edits that are not on main';
    return '';
  }
  // moves main forward to the newest release and refreshes the skill's copy; how many commits came in, or null
  // when it could not
  async function pull() {
    const was = await git('rev-parse', 'HEAD');
    if (!release && (await checkLatest()) === null) return null;
    if (!release || (await git('merge', '-q', '--ff-only', release)) === null) return null;
    const now = await git('rev-parse', 'HEAD'), count = now === was ? 0 : Number(await git('rev-list', '--count', `${was}..${now}`)) || 0;
    if (count) { try { refreshSkill(); } catch (e) { console.error(`[update] could not refresh the skill's installed copy: ${/** @type {any} */ (e)?.message}`); } console.log(`update: ${count} new commits pulled, starting again: ${await git('log', '-1', '--format=%s')}`); }
    return { count };
  }
  // starts this server again on the code now in the clone
  function restart() {
    server.closeAllConnections();
    server.close(() => { spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'inherit' }).unref(); process.exit(0); });
  }
  // nothing is pulled while Claude is at work: the page's files on disk would change under a running server, and
  // the restart would cut the work short. It looks again shortly, and updates once all is quiet.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let later = null;
  async function keepCurrent() {
    if (later) return;
    if ((await checkLatest()) !== false || (await cannotUpdate())) return;
    if (busy()) { later = setTimeout(() => { later = null; keepCurrent(); }, test.wait ?? 30_000); later.unref?.(); return; }
    if ((await pull())?.count) restart();
  }
  // build: how many commits the clone's history holds, so every merge moves it; a copy without git has none
  /** @type {any} */ const VERSION = { version: JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8')).version, build: 0, commit: '', at: '', latest: null, behind: 0, started: Date.now() };
  // once the server answers: record the commit it runs from, then look for updates now and every ten minutes
  async function whenListening() {
    const head = await git('rev-parse', 'HEAD');
    if (head) { VERSION.commit = head.slice(0, 7); VERSION.at = (await git('log', '-1', '--format=%cs')) || ''; VERSION.build = Number(await git('rev-list', '--count', 'HEAD')) || 0; }
    if (head) { try { fs.mkdirSync(path.dirname(REV), { recursive: true }); fs.writeFileSync(REV, `${head}\n`); } catch (e) { console.error(`[update] could not record the running revision: ${/** @type {any} */ (e)?.message}`); } }
    if (process.env.ANUR_LIVING_MAP_NO_UPDATE === '1') return;
    keepCurrent(); setInterval(keepCurrent, EVERY).unref();
  }
  return { VERSION, checkLatest, cannotUpdate, pull, restart, whenListening, keepCurrent };
}
