// A system map drawn in the background for one map (issue #363): its progress lives in the map's state as
// `drawing`, so every open page shows it live and a reload finds it where it was. Cancel stops the agent; Retry
// draws again, reusing each repo already drawn at the same commit. Each repo's checked drawing is kept beside the
// map (system-drawn.json) for that, and the whole report (system-report.json) for what was rejected and why. The
// folders stay in system-folders.json, never in the state: a share link or the online copy shows the map, not
// where its code sits on this Mac. Repos from GitHub are downloaded first, as whoever asks, so they draw only
// what that person may read there; a Retry downloads each one's newest commit again.

import fs from 'node:fs';
import path from 'node:path';

import { sharedGithub } from './github.js';
import { drawSystem } from './system-draw.js';

/**
 * @param {{ home: string, getState: () => any, save: () => void, push: () => void, agent: Pick<AgentWorker, 'answer'>, draw?: typeof drawSystem,
 *   github?: () => Pick<ReturnType<typeof import('./github.js').github>, 'fetchRepo'> }} deps
 */
export function systemJob({ home, getState, save, push, agent, draw = drawSystem, github = sharedGithub }) {
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
    const download = async () => {
      const got = [...folders];
      for (const r of repos) {
        if (controller.signal.aborted) break;
        tell({ repo: r.name, stage: 'downloading' });
        try { got.push((await github().fetchRepo(by, r)).folder); }
        catch (/** @type {any} */ e) { const p = { repo: r.name, stage: 'failed', error: String(e?.message || e).slice(0, 200) }; missed.push(p); tell(p); }
      }
      return got;
    };
    download().then((all) => draw({
      folders: all, agent, signal: controller.signal,
      reuse: (r) => { const k = store[r.repo]; return k && k.commit === (r.head?.commit || '') ? k.drawn : null; },
      onDrawn: (r, d) => { store[r.repo] = { commit: r.head?.commit || '', drawn: d }; fs.writeFileSync(KEPT, JSON.stringify(store)); },
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
      if (state) Object.assign(getState(), { nodes: state.nodes, edges: state.edges, start: state.start });
    }).catch((/** @type {any} */ e) => {
      console.error('[map] system drawing', e);
      Object.assign(drawing, { status: 'failed', error: `The drawing stopped: ${String(e?.message || e).slice(0, 200)}` });
    }).finally(() => { if (stop === controller) stop = null; save(); push(); });
    return true;
  }
  return {
    start,
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
