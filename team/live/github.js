// GitHub, for a system map drawn from repos there (issue #363): each person links their own GitHub account through
// the Anur Living Map GitHub App's device flow, which needs only the app's public client ID, so no secret ships with
// the map. Their token then sees only the repos they can see, where the app is installed: what the map draws follows
// what GitHub lets them read. Tokens stay on this Mac (one file per person, readable by this account only) and never
// reach a page. A repo is downloaded at one commit into a folder of its own, where the fact readers read it like any
// other folder; nothing in it is run.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { DATA } from './data-dir.js';

const API = 'https://api.github.com', WEB = 'https://github.com';
export const CLIENT_ID = process.env.LIVING_MAP_GITHUB_CLIENT_ID || 'Iv23liMEm7ceGhQD6lTI';

/** @typedef {{ access: string, refresh?: string, expires?: number, refreshExpires?: number, login: string }} Token */
/** @typedef {{ code: string, uri: string, until: number }} Pending */

/**
 * @param {{ dir: string, http?: typeof fetch, now?: () => number, run?: (cmd: string, args: string[]) => Promise<void>, second?: number }} deps
 *   `dir` holds the tokens and the downloaded repos; `http`, `run` and `second` stand in for the network, tar and the clock in tests
 */
export function github({ dir, http = fetch, now = Date.now, run = untar, second = 1000 }) {
  const TOKENS = path.join(dir, 'github'), REPOS = path.join(dir, 'repos');
  /** @type {Map<string, Pending>} the codes people are typing on github.com, by who */
  const pending = new Map();
  const file = (/** @type {string} */ who) => path.join(TOKENS, `${encodeURIComponent(who)}.json`);
  /** @returns {Token | null} */
  const saved = (/** @type {string} */ who) => {
    try { return JSON.parse(fs.readFileSync(file(who), 'utf8')); }
    catch { return null; } // never linked, or unlinked
  };
  const save = (/** @type {string} */ who, /** @type {Token} */ t) => {
    fs.mkdirSync(TOKENS, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file(who), JSON.stringify(t), { mode: 0o600 });
  };
  /** @param {string} url @param {Record<string, string>} form */
  const post = async (url, form) => (await http(url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(form), signal: AbortSignal.timeout(20_000) })).json();
  /** @param {any} got @param {string} login */
  const tokenOf = (got, login) => ({ access: got.access_token, login,
    ...(got.refresh_token ? { refresh: got.refresh_token } : {}),
    ...(got.expires_in ? { expires: now() + got.expires_in * 1000 } : {}),
    ...(got.refresh_token_expires_in ? { refreshExpires: now() + got.refresh_token_expires_in * 1000 } : {}) });

  /** each person's refresh under way: GitHub takes a refresh token once, so several asks at once share one refresh */
  /** @type {Map<string, Promise<string | null>>} */
  const refreshing = new Map();
  /**
   * A person's token, refreshed when it is about to run out; null when they must link again. Only GitHub refusing
   * the very refresh token still saved ends the link: a failed request leaves it, to try again.
   * @param {string} who
   */
  async function token(who) {
    const t = saved(who);
    if (!t) return null;
    if (!t.expires || t.expires - 60_000 > now()) return t.access;
    if (!t.refresh || (t.refreshExpires && t.refreshExpires < now())) { unlink(who); return null; }
    const going = refreshing.get(who);
    if (going) return going;
    const refresh = t.refresh;
    const once = (async () => {
      try {
        const got = await post(`${WEB}/login/oauth/access_token`, { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refresh });
        if (got.access_token) { save(who, tokenOf(got, t.login)); return got.access_token; }
        if (/bad_refresh_token|expired|revoked/.test(String(got.error || '')) && saved(who)?.refresh === refresh) { unlink(who); return null; }
        throw Object.assign(new Error(`GitHub did not refresh your link${got.error ? ` (${got.error})` : ''}. It tries again shortly.`), { status: 502 });
      } finally { refreshing.delete(who); }
    })();
    refreshing.set(who, once);
    return once;
  }
  /** @param {string} who @param {string} route */
  async function api(who, route, accept = 'application/vnd.github+json') {
    const access = await token(who);
    if (!access) throw Object.assign(new Error('Link your GitHub account first.'), { status: 401 });
    const r = await http(`${API}${route}`, { headers: { accept, authorization: `Bearer ${access}`, 'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(60_000) });
    if (r.status === 401) { unlink(who); throw Object.assign(new Error('GitHub no longer accepts your link. Link your GitHub account again.'), { status: 401 }); }
    if (!r.ok) throw Object.assign(new Error(`GitHub said ${r.status} for ${route.split('?')[0]}.`), { status: 502 });
    return r;
  }

  /**
   * Starts linking: GitHub gives a code to type at github.com/login/device, and the map waits for it in the
   * background. Resolves with what the person needs to see.
   * @param {string} who
   */
  async function link(who) {
    const got = await post(`${WEB}/login/device/code`, { client_id: CLIENT_ID });
    if (!got.device_code) throw Object.assign(new Error('GitHub did not start the link. Try again.'), { status: 502 });
    const until = now() + (got.expires_in || 900) * 1000;
    pending.set(who, { code: got.user_code, uri: got.verification_uri, until });
    (async () => {
      let wait = (got.interval || 5) * second;
      while (pending.get(who)?.code === got.user_code && now() < until) {
        await new Promise((r) => setTimeout(r, wait));
        /** @type {any} */ let t = {};
        try { t = await post(`${WEB}/login/oauth/access_token`, { client_id: CLIENT_ID, device_code: got.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }); }
        catch { continue; } // the network blinked: ask again at the next interval
        if (t.error === 'slow_down') wait += 5 * second;
        if (t.error && !['authorization_pending', 'slow_down'].includes(t.error)) break;
        if (!t.access_token) continue;
        const me = await (await http(`${API}/user`, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${t.access_token}` } })).json();
        save(who, tokenOf(t, String(me.login || '')));
        // what they may read is asked again at once, so a map shows their repos as soon as they link
        readable.delete(who);
        break;
      }
      if (pending.get(who)?.code === got.user_code) pending.delete(who);
    })().catch((e) => { console.error('[map] github link', e); pending.delete(who); });
    return { code: got.user_code, uri: got.verification_uri, until };
  }
  /** @param {string} who */
  function unlink(who) { pending.delete(who); fs.rmSync(file(who), { force: true }); }
  /** Who someone is on GitHub, or the code they are typing, or neither. @param {string} who */
  function status(who) {
    const t = saved(who), p = pending.get(who);
    return { linked: t ? t.login : null, pending: p && p.until > now() ? p : null };
  }

  /** Every repo the person can read where the app is installed, by account, but archived, forked and empty ones. @param {string} who */
  async function repos(who) {
    const { installations } = await (await api(who, '/user/installations?per_page=100')).json();
    /** @type {{ owner: string, name: string, private: boolean, branch: string }[]} */
    const out = [];
    for (const inst of installations || []) {
      for (let page = 1; page <= 10; page++) {
        const r = await (await api(who, `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`)).json();
        // an archived repo is no longer part of the running system, a fork is someone else's code, an empty one holds none
        for (const x of r.repositories || []) if (!x.archived && !x.disabled && !x.fork && x.size !== 0) out.push({ owner: x.owner.login, name: x.name, private: !!x.private, branch: x.default_branch,
          ...(x.language ? { language: String(x.language) } : {}), ...(x.pushed_at ? { pushed: Date.parse(x.pushed_at) } : {}),
          // its size on GitHub, in kilobytes: how long it takes to download and read
          ...(Number.isFinite(x.size) ? { size: Number(x.size) } : {}) });
        if ((r.repositories || []).length < 100) break;
      }
    }
    return { installed: (installations || []).map((/** @type {any} */ i) => i.account.login), repos: out };
  }

  /**
   * Downloads a repo at its default branch's newest commit into a folder of its own, named after the repo, and
   * returns that folder and the commit; a commit already downloaded is reused.
   * @param {string} who @param {{ owner: string, name: string }} repo
   */
  async function fetchRepo(who, { owner, name }) {
    if (![owner, name].every((x) => /^[\w.-]+$/.test(x) && !x.startsWith('.'))) throw Object.assign(new Error('Not a GitHub repo name.'), { status: 400 });
    const info = await (await api(who, `/repos/${owner}/${name}`)).json();
    const branch = info.default_branch;
    const { sha } = await (await api(who, `/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`, 'application/vnd.github.sha')).text().then((s) => ({ sha: s.trim() }));
    if (!/^[0-9a-f]{40}$/.test(sha)) throw Object.assign(new Error(`GitHub gave no commit for ${owner}/${name}.`), { status: 502 });
    const folder = path.join(REPOS, owner, sha.slice(0, 12), name);
    const isPrivate = info.private !== false;
    if (fs.existsSync(path.join(folder, '.living-map-head.json'))) return { folder, commit: sha, branch, private: isPrivate };
    const tarball = Buffer.from(await (await api(who, `/repos/${owner}/${name}/tarball/${sha}`)).arrayBuffer());
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    const archive = `${folder}.tar.gz`;
    fs.writeFileSync(archive, tarball);
    try { await run('tar', ['-xzf', archive, '-C', folder, '--strip-components=1', '--no-same-owner', '--no-same-permissions']); }
    finally { fs.rmSync(archive, { force: true }); }
    dropLinks(folder);
    fs.writeFileSync(path.join(folder, '.living-map-head.json'), JSON.stringify({ commit: sha, branch, repo: `${owner}/${name}` }));
    return { folder, commit: sha, branch, private: isPrivate };
  }
  /** The newest commit on a repo's default branch, as the person's own link sees it. @param {string} who @param {string} owner @param {string} name */
  async function headOf(who, owner, name) {
    const info = await (await api(who, `/repos/${owner}/${name}`)).json();
    return (await (await api(who, `/repos/${owner}/${name}/commits/${encodeURIComponent(info.default_branch)}`, 'application/vnd.github.sha')).text()).trim();
  }
  /** each person's readable repos, kept a few minutes so a chat does not ask GitHub every time */
  /** @type {Map<string, { at: number, names: Set<string> }>} */
  const readable = new Map();
  /** @type {Map<string, Promise<Set<string>>>} */
  const listing = new Map();
  /** Whether a person may read a repo on GitHub, as their own link says; no link, no. @param {string} who @param {string} owner @param {string} name */
  async function canRead(who, owner, name) {
    let kept = readable.get(who);
    if (!kept || now() - kept.at > 5 * 60_000) {
      // one ask of GitHub for everyone waiting on this person's repos
      let asking = listing.get(who);
      if (!asking) {
        asking = repos(who).then((got) => new Set(got.repos.map((r) => `${r.owner}/${r.name}`.toLowerCase())))
          .finally(() => listing.delete(who));
        listing.set(who, asking);
      }
      // not linked, or GitHub would not say: nothing is readable, and it asks again in a minute, not five
      try { kept = { at: now(), names: await asking }; }
      catch { kept = { at: now() - 4 * 60_000, names: new Set() }; }
      readable.set(who, kept);
    }
    return kept.names.has(`${owner}/${name}`.toLowerCase());
  }
  /** each person's write access by repo, kept a few minutes */
  /** @type {Map<string, { at: number, ok: boolean }>} */
  const pushable = new Map();
  /**
   * Why a person may not raise a pull request on owner/name, as their own GitHub link says; '' when they may.
   * @param {string} who @param {string} owner @param {string} name @returns {Promise<string>}
   */
  async function whyNoPush(who, owner, name) {
    if (!saved(who)) return `Connect your GitHub account first (New map, then System map, then Connect GitHub), so the map can check you can push to ${owner}/${name}.`;
    const key = `${who}\n${owner}/${name}`.toLowerCase(), kept = pushable.get(key);
    let ok = kept && now() - kept.at < 5 * 60_000 ? kept.ok : null;
    if (ok === null) {
      try { const r = await (await api(who, `/repos/${owner}/${name}`)).json(); ok = !!(r.permissions?.push || r.permissions?.maintain || r.permissions?.admin); }
      catch { ok = false; } // GitHub would not say, or the repo is not one this link reaches: no
      pushable.set(key, { at: now(), ok });
    }
    return ok ? '' : `You can't push to ${owner}/${name} on GitHub, so this Action can't raise its pull request there. Ask someone with write access to run it.`;
  }
  return { link, unlink, status, token, repos, fetchRepo, headOf, canRead, whyNoPush };
}

/** @type {ReturnType<typeof github> | null} */
let one = null;
/** This Mac's GitHub links and downloads, in the team map's data folder. */
export const sharedGithub = () => (one ||= github({ dir: DATA }));

/** Takes every symbolic link out of a downloaded repo, so reading it never follows one off to the rest of this Mac. @param {string} dir */
export function dropLinks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) fs.rmSync(p, { force: true });
    else if (e.isDirectory()) dropLinks(p);
  }
}

/** @param {string} cmd @param {string[]} args @returns {Promise<void>} */
function untar(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 120_000 }, (e) => (e ? reject(e) : resolve())));
}
