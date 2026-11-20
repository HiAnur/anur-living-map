// Facts from a repo's deploy and release scripts, read as text with nothing run: shell scripts at its top, in
// `scripts/` or `bin/`, and its GitHub workflows. Where it puts what it builds (`aws s3 cp|sync` to a bucket, a hosting
// service's API or CLI, GitHub Pages, a `CNAME`), the packages it fetches by name from npm (which the cross-repo
// linker matches to the repo publishing that name), and whether it signs and notarizes with Apple. A shell
// variable set plainly in the same file (`BUCKET=name`, `${X:-default}`) is read as its value; anything worked out
// at run time is left unread. Part of drawing a system map from code: see system-facts.js.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('./system-facts.js').Fact} Fact */

const MAX_FILE = 512 * 1024, MAX_SCRIPTS = 60, MAX_FACTS = 40;
const SCRIPT = /^([^/]+\.(sh|bash)|(scripts|bin|deploy|tools)\/[^/]+\.(sh|bash)|\.github\/workflows\/[^/]+\.ya?ml)$/;
// hosting services, by the API host or command a script uses to deploy to them
const HOSTS = /** @type {[RegExp, string][]} */ ([
  [/\bhostinger\.com\b/i, 'Hostinger'], [/\bapi\.netlify\.com\b|\bnetlify\s+deploy\b/, 'Netlify'], [/\bapi\.vercel\.com\b|\bvercel\s+(deploy|--prod)\b/, 'Vercel'],
  [/\bwrangler\s+(pages\s+)?(deploy|publish)\b|\bapi\.cloudflare\.com\b/, 'Cloudflare'], [/\bfirebase\s+deploy\b/, 'Firebase'],
  [/\bgh-pages\b|actions-gh-pages|actions\/deploy-pages\b/, 'GitHub Pages'], [/\bfly\s+deploy\b/, 'Fly.io'], [/\bheroku\s+(container:release|git:remote)\b/, 'Heroku'],
]);
// flags of `aws s3 cp|sync` that take a value, so the value is not read as a source or destination
const VALUED = new Set(['--profile', '--region', '--content-type', '--cache-control', '--acl', '--exclude', '--include', '--storage-class', '--metadata', '--expires', '--endpoint-url', '--sse', '--content-disposition']);
const DOMAIN = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i;
/** @param {string} root @param {string} f */
const text = (root, f) => { try { const p = path.join(root, f); return fs.statSync(p).size > MAX_FILE ? '' : fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const tokens = (/** @type {string} */ s) => [...s.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((m) => m[0].replace(/^["']|["']$/g, ''));

/**
 * The plain values a script gives its variables: `NAME=value` and `NAME="${OTHER:-default}"`, not those worked out at
 * run time (`$(...)`, backticks).
 * @param {string} src @returns {Map<string, string>}
 */
export function shellVars(src) {
  /** @type {Map<string, string>} */
  const vars = new Map();
  for (const m of src.matchAll(/^\s*(?:export\s+|readonly\s+|local\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"\n]*"|'[^'\n]*'|[^\s;#]*)/gm)) {
    let v = m[2].replace(/^["']|["']$/g, '');
    const fallback = /^\$\{[A-Za-z_]\w*:?-([^}]*)\}$/.exec(v);
    if (fallback) v = fallback[1];
    if (!v || /\$\(|`/.test(v) || vars.has(m[1])) continue;
    vars.set(m[1], v);
  }
  // a value built from others set plainly (`PUBLIC_BASE="https://$BUCKET.s3…"`)
  for (const [k, v] of vars) vars.set(k, expand(v, vars));
  return vars;
}
/** @param {string} s @param {Map<string, string>} vars */
const expand = (s, vars) => s.replace(/\$\{([A-Za-z_]\w*)(?::?-([^}]*))?\}|\$([A-Za-z_]\w*)/g, (all, a, def, b) => vars.get(a || b) ?? def ?? all);

/** @param {string} root @param {string} f @returns {Fact[]} */
function script(root, f) {
  const src = text(root, f);
  if (!src) return [];
  const vars = shellVars(src);
  // a command split over lines with `\` reads as one, at the line it starts on
  const lines = src.split('\n');
  /** @type {{ text: string, line: number }[]} */
  const commands = [];
  for (let i = 0; i < lines.length; i++) {
    let t = lines[i], j = i;
    while (/\\\s*$/.test(t) && j + 1 < lines.length) t = t.replace(/\\\s*$/, ' ') + lines[++j];
    commands.push({ text: t.replace(/(^|\s)#.*$/, ''), line: i + 1 });
    i = j;
  }
  /** @type {Map<string, Fact>} */
  const out = new Map();
  for (const { text: cmd, line } of commands) {
    const at = `${f}:${line}`;
    // aws s3 cp|sync|mv <from> <to>: a bucket the script writes to when it is the destination
    const s3 = /\baws\w*\s+(?:--?\S+\s+)*s3\s+(cp|sync|mv)\b(.*)$/.exec(cmd);
    if (s3) {
      const args = tokens(expand(s3[2], vars)), positional = [];
      for (let k = 0; k < args.length; k++) { if (VALUED.has(args[k])) k++; else if (!args[k].startsWith('-')) positional.push(args[k]); }
      const to = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(\/\S*)?$/.exec(positional[1] || '');
      if (to) {
        // the folder it writes into, as far as the script names it plainly
        const key = `s3:${to[1]}`, prefix = (to[2] || '/').split('$')[0].replace(/[^/]*$/, '');
        const had = out.get(key);
        if (had) { if (!had.prefixes.includes(prefix) && had.prefixes.length < 10) had.prefixes.push(prefix); }
        else out.set(key, { id: '', kind: 'deploy_target', at, service: 'S3', name: to[1], prefixes: [prefix], via: `aws s3 ${s3[1]}`, module: f });
      }
    }
    for (const [re, service] of HOSTS) if (re.test(expand(cmd, vars)) && !out.has(`host:${service}`)) {
      // the domain it deploys, when the script names one plainly
      const domain = [...vars].find(([k, v]) => /DOMAIN|SITE|HOSTNAME/.test(k) && DOMAIN.test(v))?.[1];
      out.set(`host:${service}`, { id: '', kind: 'deploy_target', at, service, name: domain || service, ...(domain ? { domain } : {}), module: f });
    }
    // npm pack|install|view <name>: a package fetched by name
    const npm = /\bnpm\s+(pack|install|i|add|view|info)\s+(.*)$/.exec(cmd);
    if (npm) {
      // its arguments up to the end of the command; `npm view` names one package, then the fields it shows
      const args = tokens(npm[2]), end = args.findIndex((t) => /^([|;&)<>]|\d?>)/.test(t));
      const named = (end < 0 ? args : args.slice(0, end)).filter((t) => !t.startsWith('-') && !/^[./]/.test(t));
      for (const t of /^(view|info)$/.test(npm[1]) ? named.slice(0, 1) : named) {
        const name = /^((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)(@\S*)?$/.exec(t)?.[1];
        if (!name || name === 'npm' || out.has(`npm:${name}`)) continue;
        out.set(`npm:${name}`, { id: '', kind: 'pulls_package', at, registry: 'npm', name, via: `npm ${npm[1]}`, module: f });
      }
    }
    if (/\bxcrun\s+notarytool\s+submit\b/.test(cmd) && !out.has('apple')) {
      out.set('apple', { id: '', kind: 'release_signing', at, service: 'Apple', name: 'Apple notarization', notarizes: true, signs: /\bcodesign\s+(--force\s+)?(-s|--sign)\b/.test(src), staples: /\bstapler\s+staple\b/.test(src), module: f });
    }
  }
  return [...out.values()];
}

/** A file that says by itself where a site is hosted. @param {string} root @param {string} f @returns {Fact | null} */
function hostingFile(root, f) {
  const src = text(root, f), base = path.basename(f);
  if (base === 'CNAME') {
    const domain = src.trim().split('\n')[0]?.trim();
    return domain && DOMAIN.test(domain) ? { id: '', kind: 'deploy_target', at: `${f}:1`, service: 'GitHub Pages', name: domain, domain, module: f } : null;
  }
  const service = { 'netlify.toml': 'Netlify', 'vercel.json': 'Vercel', 'wrangler.toml': 'Cloudflare', 'firebase.json': 'Firebase', 'fly.toml': 'Fly.io' }[base];
  if (!service) return null;
  const name = /^\s*(?:name|app)\s*=\s*["']([^"']+)["']/m.exec(src)?.[1];
  return { id: '', kind: 'deploy_target', at: `${f}:1`, service, name: name || service, module: f };
}

/**
 * Every deploy fact in a repo, from its files (tests already left out).
 * @param {string} root @param {string[]} files @returns {Fact[]}
 */
export function deployFacts(root, files) {
  /** @type {Fact[]} */
  const out = [];
  for (const f of files.filter((x) => SCRIPT.test(x)).slice(0, MAX_SCRIPTS)) out.push(...script(root, f));
  for (const f of files.filter((x) => /^(docs\/)?CNAME$|^(netlify\.toml|vercel\.json|wrangler\.toml|firebase\.json|fly\.toml)$/.test(x))) { const h = hostingFile(root, f); if (h) out.push(h); }
  // one fact per place across the repo's scripts: the first script that names it
  /** @type {Map<string, Fact>} */
  const seen = new Map();
  for (const f of out) {
    const key = `${f.kind}:${f.service || f.registry}:${f.name}`, had = seen.get(key);
    if (!had) seen.set(key, f);
    else if (had.prefixes && f.prefixes) for (const p of f.prefixes) if (!had.prefixes.includes(p)) had.prefixes.push(p);
  }
  return [...seen.values()].slice(0, MAX_FACTS);
}
