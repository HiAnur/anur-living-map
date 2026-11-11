// Where an Action on a system map does its work: the repo its box belongs to (the nearest box up its path that
// names one, so everything inside a repo's box inherits it), in a git clone on this Mac. An existing clone is found
// by its `origin` (a folder in ~/workspace and the like); a build with none clones the repo once, with the person's
// own git sign-in, since the map's GitHub App only reads. Who may: as for reading a system map's code
// (system-job.js `codeFor`).

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { pathTo } from './map-walk.js';

const PLACES = ['workspace', 'code', 'src', 'dev', 'projects', 'repos', 'git', 'GitHub', 'Developer', 'Documents/GitHub'];

/** The repo a box belongs to: its own, or the nearest box above it that names one. @param {any} state @param {any} box */
export function repoOf(state, box) {
  return [...pathTo(state, box.id), box].map((x) => x?.source?.repo).filter(Boolean).at(-1) || null;
}

/** The GitHub repo a clone's origin is, or null. @param {string} dir @returns {{ owner: string, name: string } | null} */
export function onGitHub(dir) {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(originOf(dir));
  return m ? { owner: m[1], name: m[2] } : null;
}

/** @param {string} dir */
const originOf = (dir) => {
  try { return execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; } // not a clone, or no origin: not this repo
};

/**
 * @param {{ home: string, data: string, also?: string[], clone?: (url: string, to: string) => Promise<string | null> }} deps
 *   `home` the person's home folder, `data` the team map's data folder, `also` more folders to look in, `clone` for tests
 */
export function workFinder({ home, data, also = [], clone = gitClone }) {
  /** @type {Map<string, { at: number, folder: string | null }>} */
  const found = new Map();
  /** An existing clone of owner/name on this Mac, by its origin, or null. @param {string} owner @param {string} name */
  function cloneOf(owner, name) {
    const key = `${owner}/${name}`.toLowerCase(), kept = found.get(key);
    if (kept && (kept.folder ? fs.existsSync(kept.folder) : Date.now() - kept.at < 60_000)) return kept.folder;
    const want = new RegExp(`github\\.com[:/]${owner.replace(/\./g, '\\.')}/${name.replace(/\./g, '\\.')}(\\.git)?/?$`, 'i');
    const dirs = [path.join(data, 'work', owner, name), ...also, ...PLACES.map((p) => path.join(home, p))];
    /** @type {string[]} every clone of it, in the order the places are looked in */
    const clones = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const here = fs.existsSync(path.join(dir, '.git')) ? [dir] : fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(dir, e.name)).filter((d) => fs.existsSync(path.join(d, '.git')));
      clones.push(...here.filter((d) => want.test(originOf(d))));
    }
    // of several clones, the one named after the repo; a build branches from origin either way, leaving the clone's files alone
    const folder = clones.find((d) => path.basename(d).toLowerCase() === name.toLowerCase()) || clones[0] || null;
    found.set(key, { at: Date.now(), folder });
    return folder;
  }
  /**
   * A clone to work in, made when there is none and a build needs one.
   * @param {string} owner @param {string} name @param {boolean} build @returns {Promise<{ cwd: string } | { error: string }>}
   */
  async function workIn(owner, name, build) {
    const have = cloneOf(owner, name);
    if (have) return { cwd: have };
    if (!build) return { error: '' };
    const to = path.join(data, 'work', owner, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const failed = await clone(`https://github.com/${owner}/${name}.git`, to);
    if (failed) return { error: `There is no clone of ${owner}/${name} on this Mac, and cloning it with your git sign-in failed: ${failed.slice(0, 200)}. Clone it into ~/workspace and try again.` };
    found.set(`${owner}/${name}`.toLowerCase(), { at: Date.now(), folder: to });
    return { cwd: to };
  }
  return { cloneOf, workIn };
}

/** Clones with this Mac's git and its sign-in; resolves with why it failed, or null. @param {string} url @param {string} to @returns {Promise<string | null>} */
function gitClone(url, to) {
  return new Promise((resolve) => execFile('git', ['clone', '-q', url, to], { timeout: 600_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (e, _out, err) => resolve(e ? String(err || e.message).trim() || 'git clone failed' : null)));
}
