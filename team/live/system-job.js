// A system map drawn in the background for one map (issue #363): its progress lives in the map's state as
// `drawing`, so every open page shows it live and a reload finds it where it was. Cancel stops the agent; Retry
// draws again, reusing each repo already drawn at the same commit. Each repo's checked drawing is kept beside the
// map (system-drawn.json) for that, and the whole report (system-report.json) for what was rejected and why. The
// folders stay in system-folders.json, never in the state: a share link or the online copy shows the map, not
// where its code sits on this Mac. Repos from GitHub are downloaded first, as whoever asks, so they draw only
// what that person may read there; a Retry downloads each one's newest commit again.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DATA } from './data-dir.js';
import { sharedGithub } from './github.js';
import { systemState } from './system-build.js';
import { repoHead } from './system-facts.js';
import { drawSystem } from './system-draw.js';
import { keepHandEdits } from './system-merge.js';
import { onGitHub, workFinder } from './system-work.js';

/** @type {ReturnType<typeof workFinder> | null} */
let finder = null;
/** This Mac's clones, found once for every map. */
const sharedWork = () => (finder ||= workFinder({ home: os.homedir(), data: DATA }));

/**
 * @param {{ home: string, getState: () => any, save: () => void, push: () => void, agent: Pick<AgentWorker, 'answer'>, draw?: typeof drawSystem,
 *   github?: () => Pick<ReturnType<typeof import('./github.js').github>, 'fetchRepo' | 'canRead' | 'headOf' | 'status'>, work?: () => Pick<ReturnType<typeof workFinder>, 'workIn'> }} deps
 */
export function systemJob({ home, getState, save, push, agent, draw = drawSystem, github = sharedGithub, work = sharedWork }) {
  const KEPT = path.join(home, 'system-drawn.json'), REPORT = path.join(home, 'system-report.json'), FOLDERS = path.join(home, 'system-folders.json');
  /** @type {AbortController | null} */
  let stop = null;
  // a drawing the server was in the middle of when it stopped is shown as stopped, ready to draw again
  const was = getState().drawing;
  if (was?.status === 'running') {
    was.status = 'stopped'; was.error = 'The drawing stopped when Living Map restarted.';
    for (const p of was.progress || []) if (!['done', 'failed'].includes(p.stage)) p.stage = 'cancelled';
    save();
  }
  /** What a drawing of a repo rests on: its commit and the facts read from it, so a better reader draws it again. @param {{ head: { commit: string } | null, facts?: unknown[] }} r */
  const basis = (r) => `${r.head?.commit || ''}:${crypto.createHash('sha1').update(JSON.stringify(r.facts || [])).digest('hex').slice(0, 16)}`;
  /** @returns {Record<string, { commit: string, drawn: any }>} */
  const kept = () => {
    try { return JSON.parse(fs.readFileSync(KEPT, 'utf8')); }
    catch { return {}; } // nothing drawn yet, or a file from an older drawing that no longer reads: draw every repo
  };

  /**
   * @param {{ folders?: string[], repos?: { owner: string, name: string }[], by: string, again?: boolean }} job folders on this Mac, repos on GitHub, or both
   * @returns {boolean} whether it started
   */
  function start({ folders = [], repos = [], by, again = false }) {
    if (stop) return false;
    const controller = new AbortController();
    stop = controller;
    const store = again ? kept() : {};
    if (!again) { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(KEPT, '{}'); fs.writeFileSync(FOLDERS, JSON.stringify({ folders, repos })); }
    const drawing = { by, at: Date.now(), repos: folders.length + repos.length, status: 'running', progress: /** @type {any[]} */ ([]) };
    // a new map shows each repo as soon as it is drawn, so it can be read before the rest are done; a map drawn
    // again keeps what it has until the whole drawing is ready
    const fresh = !(getState().nodes || []).length;
    /** @type {Map<string, { reading: any, drawn: any }>} */
    const sofar = new Map();
    /** @param {any} r @param {any} d */
    const showSoFar = (r, d) => {
      if (!fresh) return;
      sofar.set(r.repo, { reading: r, drawn: d });
      const boxes = [...sofar.values()].map(({ reading }) => ({ id: reading.repo, name: reading.repo, kind: 'library', description: (reading.kinds || []).join(', '), facts: [`repo:${reading.repo}`], repo: reading.repo }));
      const partial = systemState({ boxes, lines: [] }, new Map(), [...sofar.values()]);
      Object.assign(getState(), { nodes: partial.nodes, edges: [], start: partial.start });
    };
    getState().drawing = drawing;
    save(); push();
    /** @param {any} p */
    const tell = (p) => {
      const i = drawing.progress.findIndex((x) => x.repo === p.repo);
      if (i < 0) drawing.progress.push({ ...p }); else drawing.progress[i] = { ...p };
      save(); push();
    };
    /** repos GitHub would not give: they stay on the panel as failed, with why */
    const missed = /** @type {any[]} */ ([]);
    // four at a time; each says when it is down, then waits its turn to be read
    const download = async () => {
      const got = [...folders];
      for (const r of repos) tell({ repo: r.name, stage: 'downloading' });
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, repos.length) }, async () => {
        while (next < repos.length && !controller.signal.aborted) {
          const r = repos[next++];
          try { const f = await github().fetchRepo(by, r); got.push(f.folder); /** @type {any} */ (r).private = f.private !== false; tell({ repo: r.name, stage: 'downloaded' }); }
          catch (/** @type {any} */ e) { const p = { repo: r.name, stage: 'failed', error: String(e?.message || e).slice(0, 200) }; missed.push(p); tell(p); }
        }
      }));
      // whether each repo is private, as GitHub said on download: who may see it on the map follows from it
      if (repos.length) fs.writeFileSync(FOLDERS, JSON.stringify({ folders, repos }));
      return got;
    };
    download().then((all) => draw({
      folders: all, agent, signal: controller.signal,
      reuse: (r) => { const k = store[r.repo]; return k && k.commit === basis(r) ? k.drawn : null; },
      onDrawn: (r, d) => { store[r.repo] = { commit: basis(r), drawn: d }; fs.writeFileSync(KEPT, JSON.stringify(store)); showSoFar(r, d); },
      onProgress: tell,
    })).then(({ state, report, cancelled }) => {
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
      Object.assign(drawing, {
        progress: [...missed, ...report.progress], ms: report.ms, rejected: report.rejected.length, leftOut: report.leftOut,
        cost: { value: report.costs.reduce((n, c) => n + c.value, 0), unit: report.costs[0]?.unit || 'usd' },
        unread: report.repos.filter((r) => r.unread.length).map((r) => ({ repo: r.repo, why: r.unread[0] })),
      });
      const failed = drawing.progress.filter((/** @type {any} */ p) => p.stage === 'failed');
      drawing.status = cancelled ? 'cancelled' : failed.length ? 'failed' : 'done';
      // drawn again: what people did to the map stays (system-merge.js)
      if (state) { const drawn = fresh ? state : keepHandEdits(getState(), state); Object.assign(getState(), { nodes: drawn.nodes, edges: drawn.edges, start: drawn.start }); }
    }).catch((/** @type {any} */ e) => {
      console.error('[map] system drawing', e);
      Object.assign(drawing, { status: 'failed', error: `The drawing stopped: ${String(e?.message || e).slice(0, 200)}` });
    }).finally(() => { if (stop === controller) stop = null; save(); push(); });
    return true;
  }
  /**
   * The code behind the map that a person may read, at the commit it was drawn from: a repo from GitHub if
   * GitHub lets them read it, a folder on this Mac only for whoever drew the map.
   * @param {string} who @returns {Promise<{ repo: string, folder: string }[]>}
   */
  async function codeFor(who) {
    const d = getState().drawing;
    if (!d || !fs.existsSync(REPORT) || !fs.existsSync(FOLDERS)) return [];
    const report = JSON.parse(fs.readFileSync(REPORT, 'utf8')), was = JSON.parse(fs.readFileSync(FOLDERS, 'utf8'));
    const { folders = [], repos = [] } = Array.isArray(was) ? { folders: was } : was;
    /** @type {{ repo: string, folder: string }[]} */
    const out = [];
    for (const r of report.repos || []) {
      if (!r.root || !fs.existsSync(r.root)) continue;
      const local = folders.includes(r.root), gh = repos.find((/** @type {any} */ x) => x.name === r.repo);
      const may = local ? who === d.by : gh ? await github().canRead(who, gh.owner, gh.name) : false;
      if (may) out.push({ repo: r.repo, folder: r.root });
    }
    return out;
  }
  /**
   * Where work on a repo of this map happens, for someone: a clone on this Mac (made for a build when there is
   * none), or for anything but a build the code the map was drawn from. Who may, as for `codeFor`.
   * @param {string} repo @param {string} who @param {boolean} build @returns {Promise<{ cwd: string } | { error: string }>}
   */
  async function workFor(repo, who, build) {
    const d = getState().drawing;
    if (!d || !fs.existsSync(REPORT) || !fs.existsSync(FOLDERS)) return { error: 'This map has not been drawn from code yet.' };
    const report = JSON.parse(fs.readFileSync(REPORT, 'utf8')), was = JSON.parse(fs.readFileSync(FOLDERS, 'utf8'));
    const { folders = [], repos = [] } = Array.isArray(was) ? { folders: was } : was;
    const r = (report.repos || []).find((/** @type {any} */ x) => x.repo === repo);
    if (!r) return { error: `${repo} is not one of this map's repos.` };
    if (folders.includes(r.root)) return who === d.by ? { cwd: r.root } : { error: `${repo} was drawn from a folder on ${d.by}'s Mac, so only ${d.by} can run Actions in it.` };
    const gh = repos.find((/** @type {any} */ x) => x.name === repo);
    if (!gh || !(await github().canRead(who, gh.owner, gh.name))) return { error: `GitHub does not let you read ${gh ? `${gh.owner}/${gh.name}` : repo}, so you can't run Actions in it.` };
    const w = await work().workIn(gh.owner, gh.name, build);
    if ('cwd' in w) return w;
    return build || !fs.existsSync(r.root) ? w : { cwd: r.root };
  }
  /**
   * The repos on GitHub this map was drawn from, by name, with whether each is private (unknown counts as private);
   * a folder on this Mac counts by its clone's GitHub origin, and one not on GitHub is not listed.
   * @returns {{ repo: string, owner: string, name: string, private: boolean }[]}
   */
  function onGitHubRepos() {
    const d = getState().drawing;
    if (!d || !fs.existsSync(FOLDERS) || !fs.existsSync(REPORT)) return [];
    const had = listed;
    if (had && had.at === d.at && had.status === d.status) return had.list;
    const was = JSON.parse(fs.readFileSync(FOLDERS, 'utf8')), report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    const { folders = [], repos = [] } = Array.isArray(was) ? { folders: was } : was;
    /** @type {{ repo: string, owner: string, name: string, private: boolean }[]} */
    const list = [];
    for (const r of report.repos || []) {
      const gh = repos.find((/** @type {any} */ x) => x.name === r.repo), local = folders.includes(r.root) ? onGitHub(r.root) : null;
      if (gh) list.push({ repo: r.repo, owner: gh.owner, name: gh.name, private: gh.private !== false });
      else if (local) list.push({ repo: r.repo, ...local, private: true });
    }
    listed = { at: d.at, status: d.status, list };
    return list;
  }
  /** @type {{ at: number, status: string, list: { repo: string, owner: string, name: string, private: boolean }[] } | null} */
  let listed = null;
  /** what each viewer may read, as GitHub last said, by who @type {Map<string, { at: number, readable: Set<string>, asking: boolean }>} */
  const reads = new Map();
  /**
   * The repos, by name, a viewer may not read on GitHub, so the map leaves them out of what they receive. Someone
   * not signed in reads only public repos; a signed-in viewer's own GitHub link is asked in the background (kept
   * five minutes), and until it answers every private repo stays hidden. `onChange` hears when an answer changes it.
   * @param {string | null} who @param {() => void} [onChange] @returns {Set<string>}
   */
  function hiddenFor(who, onChange = () => {}) {
    const list = onGitHubRepos().filter((r) => r.private);
    if (!list.length) return new Set();
    if (!who) return new Set(list.map((r) => r.repo));
    const kept = reads.get(who);
    if ((!kept || Date.now() - kept.at > 5 * 60_000) && !kept?.asking) {
      reads.set(who, { at: kept?.at || 0, readable: kept?.readable || new Set(), asking: true });
      Promise.all(list.map(async (r) => (await github().canRead(who, r.owner, r.name).catch(() => false)) ? r.repo : null)).then((ok) => {
        const readable = new Set(/** @type {string[]} */ (ok.filter(Boolean)));
        const changed = [...readable].sort().join() !== [...(kept?.readable || [])].sort().join();
        reads.set(who, { at: Date.now(), readable, asking: false });
        if (changed) onChange();
      });
    }
    const readable = reads.get(who)?.readable || new Set();
    return new Set(list.filter((r) => !readable.has(r.repo)).map((r) => r.repo));
  }
  /** Where a repo of this map came from: GitHub's owner and name, or a folder on this Mac. @param {string} repo */
  function sourceOf(repo) {
    if (!fs.existsSync(FOLDERS) || !fs.existsSync(REPORT)) return null;
    const was = JSON.parse(fs.readFileSync(FOLDERS, 'utf8')), report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    const { folders = [], repos = [] } = Array.isArray(was) ? { folders: was } : was;
    const gh = repos.find((/** @type {any} */ x) => x.name === repo);
    if (gh) return { owner: String(gh.owner), name: String(gh.name) };
    const root = (report.repos || []).find((/** @type {any} */ x) => x.repo === repo)?.root;
    return root && folders.includes(root) ? { folder: String(root) } : null;
  }
  /** what changed since the drawing, by who @type {Map<string, { at: number, drawn: number, repos: string[] }>} */
  const changes = new Map();
  /**
   * The repos with newer commits than the drawing read, among those this person may read: one downloaded from GitHub
   * asked with their own GitHub link (none: not asked), a folder on this Mac by its clone's commit. Kept five minutes.
   * @param {string} who @returns {Promise<string[]>}
   */
  async function changed(who) {
    const d = getState().drawing;
    if (!d || d.status === 'running' || !fs.existsSync(REPORT) || !fs.existsSync(FOLDERS)) return [];
    const kept = changes.get(who);
    if (kept && kept.drawn === d.at && Date.now() - kept.at < 5 * 60_000) return kept.repos;
    const was = JSON.parse(fs.readFileSync(FOLDERS, 'utf8')), report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    const { folders = [], repos = [] } = Array.isArray(was) ? { folders: was } : was;
    const hidden = hiddenFor(who), linked = !!github().status(who).linked;
    const found = await Promise.all((report.repos || []).map(async (/** @type {any} */ r) => {
      if (hidden.has(r.repo) || !r.head?.commit) return null;
      const gh = repos.find((/** @type {any} */ x) => x.name === r.repo);
      try {
        const now = gh ? (linked ? await github().headOf(who, gh.owner, gh.name) : null) : folders.includes(r.root) ? repoHead(r.root)?.commit : null;
        return now && now !== r.head.commit ? String(r.repo) : null;
      } catch { return null; } // GitHub would not say: it is not counted as changed
    }));
    const list = /** @type {string[]} */ (found.filter(Boolean));
    changes.set(who, { at: Date.now(), drawn: d.at, repos: list });
    return list;
  }
  return {
    start, codeFor, workFor, sourceOf, hiddenFor, changed,
    /** whether any repo of this map is private on GitHub, or may be */
    holdsPrivate: () => onGitHubRepos().some((r) => r.private),
    /** @returns {boolean} whether a drawing was running */
    cancel: () => { if (!stop) return false; stop.abort(); return true; },
    /** Draws again from the same folders, reusing what is still current. @param {string} by */
    retry: (by) => {
      const d = getState().drawing;
      if (!d || d.status === 'running' || !fs.existsSync(FOLDERS)) return false;
      const was = JSON.parse(fs.readFileSync(FOLDERS, 'utf8'));
      return start({ ...(Array.isArray(was) ? { folders: was } : was), by, again: true });
    },
    running: () => !!stop,
  };
}
