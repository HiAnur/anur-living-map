// Facts about a static website, read as text with nothing run: a folder holding an `index.html` (at the top of the
// repo or below it) is a site, each HTML file under it one of its pages (with its `<title>`), and the places its pages
// and their own scripts point to: a repo on GitHub (a link, or a file it fetches from raw.githubusercontent.com or the
// GitHub API), a package on npm, or any other address, one fact per place. HTML that belongs to an app with a
// package.json is that app's, not a site. Where it is hosted comes from its deploy script (system-facts-deploy.js).
// Part of drawing a system map from code: see system-facts.js.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('./system-facts.js').Fact} Fact */

const MAX_FILE = 2 * 1024 * 1024, MAX_PAGES = 60, MAX_PLACES = 40;
const SKIP = /(^|\/)(node_modules|vendor|vendors|dist|build|out|coverage|\.next|_site|public\/build)\//;
// addresses that load a page's fonts and libraries, or name a format, not places the site points people or data to
const PLUMBING = /^(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|www\.w3\.org|w3\.org|schema\.org|ogp\.me|www\.googletagmanager\.com|www\.google-analytics\.com)$/;
/** @param {string} root @param {string} f */
const text = (root, f) => { try { const p = path.join(root, f); return fs.statSync(p).size > MAX_FILE ? '' : fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const lineAt = (/** @type {string} */ s, /** @type {number} */ i) => s.slice(0, i).split('\n').length;
const decode = (/** @type {string} */ v) => v.replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * What an address points to: a repo on GitHub, a package on npm, or a host.
 * @param {string} url @returns {{ target: string, host: string, github_repo?: string, npm_package?: string, fetches?: boolean } | null}
 */
export function placeOf(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase(), seg = u.pathname.split('/').filter(Boolean);
  const gh = host === 'github.com' && seg.length >= 2 ? seg.slice(0, 2) : host === 'raw.githubusercontent.com' && seg.length >= 2 ? seg.slice(0, 2)
    : host === 'api.github.com' && seg[0] === 'repos' && seg.length >= 3 ? seg.slice(1, 3) : null;
  if (gh) {
    const repo = `${gh[0]}/${gh[1].replace(/\.git$/, '')}`;
    return { target: `github:${repo.toLowerCase()}`, host, github_repo: repo, ...(host !== 'github.com' ? { fetches: true } : {}) };
  }
  const npm = /^(www\.)?npmjs\.(com|org)$/.test(host) && seg[0] === 'package' ? seg.slice(1, seg[1]?.startsWith('@') ? 3 : 2).join('/') : '';
  if (npm) return { target: `npm:${npm}`, host, npm_package: npm };
  return PLUMBING.test(host) ? null : { target: host, host };
}

/** A page's own path on the site: `about/index.html` is `/about/`. @param {string} site @param {string} f */
const pagePath = (site, f) => `/${path.relative(site, f).replace(/(^|\/)index\.html?$/, '$1')}`;

/**
 * Every site in a repo, from its files (tests already left out): a fact per site, per page, and per place it points to.
 * @param {string} root @param {string[]} files @returns {Fact[]}
 */
export function siteFacts(root, files) {
  const kept = files.filter((f) => !SKIP.test(f));
  // folders an app's package.json owns, with everything under them
  const apps = kept.filter((f) => path.basename(f) === 'package.json').map((f) => path.dirname(f));
  const owned = (/** @type {string} */ f) => apps.some((d) => d === '.' || f.startsWith(`${d}/`));
  const html = kept.filter((f) => /\.html?$/.test(f) && !owned(f));
  // a site is the topmost folder holding an index.html; the HTML under it is its pages
  const roots = html.filter((f) => /(^|\/)index\.html?$/.test(f)).map((f) => path.dirname(f))
    .filter((d, _, all) => !all.some((o) => o !== d && (o === '.' || d.startsWith(`${o}/`))));
  /** @type {Fact[]} */
  const out = [];
  for (const site of [...new Set(roots)].sort()) {
    const inSite = (/** @type {string} */ f) => site === '.' || f.startsWith(`${site}/`);
    const pages = html.filter(inSite).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, MAX_PAGES);
    /** @type {Fact[]} */
    const pageFacts = [];
    /** @type {Map<string, Fact>} */
    const places = new Map();
    /** @param {string} url @param {string} at @param {string} f @param {boolean} code */
    const point = (url, at, f, code) => {
      const p = placeOf(url.replace(/&amp;/g, '&'));
      if (!p) return;
      // a script naming a place reads from it; a page linking to it sends people there
      const how = p.fetches || code ? 'fetches' : 'links';
      const key = `${p.target} ${how}`, had = places.get(key), clean = url.split(/[?#]/)[0];
      if (had) { if (had.urls.length < 5 && !had.urls.includes(clean)) had.urls.push(clean); if (!had.from.includes(f) && had.from.length < 10) had.from.push(f); return; }
      if (places.size >= MAX_PLACES) return;
      const { target: _t, fetches: _f, ...said } = p;
      places.set(key, { id: '', kind: 'links_to', at, name: p.github_repo || p.npm_package || p.host, how, ...said, urls: [clean], from: [f], module: f });
    };
    for (const f of pages) {
      const src = text(root, f);
      const t = /<title[^>]*>([^<]*)<\/title>/i.exec(src);
      pageFacts.push({ id: '', kind: 'page', at: `${f}:${t ? lineAt(src, t.index) : 1}`, name: (t && decode(t[1])) || pagePath(site, f), path: pagePath(site, f), module: f });
      for (const m of src.matchAll(/\b(?:href|src|action)\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi)) point(m[1], `${f}:${lineAt(src, m.index || 0)}`, f, false);
      // addresses in the page's own inline scripts
      for (const s of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        const base = (s.index || 0) + s[0].indexOf('>') + 1;
        for (const m of s[1].matchAll(/["'`](https?:\/\/[^"'`\s$]+)/g)) point(m[1], `${f}:${lineAt(src, base + (m.index || 0))}`, f, true);
      }
    }
    // the site's own scripts (not its vendored libraries)
    for (const f of kept.filter((x) => inSite(x) && /\.m?js$/.test(x) && !owned(x))) {
      const src = text(root, f);
      for (const m of src.matchAll(/["'`](https?:\/\/[^"'`\s$]+)/g)) point(m[1], `${f}:${lineAt(src, m.index || 0)}`, f, true);
    }
    const home = pageFacts.find((p) => p.path === '/');
    out.push({ id: '', kind: 'site', at: home?.at || `${site}/`, name: home && home.name !== '/' ? home.name : site === '.' ? path.basename(root) : site, folder: site === '.' ? '' : site,
      pages: pageFacts.map((p) => p.path) }, ...pageFacts, ...places.values());
  }
  return out;
}
