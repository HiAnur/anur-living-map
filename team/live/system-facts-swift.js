// Facts about a Swift or Apple app, read as text with nothing built or run: a Swift package's products, targets and
// dependencies (`Package.swift`), an Xcode project's targets and bundle ids (`project.pbxproj`), what an app says
// about itself in its `Info.plist` (bundle id, name, a menu-bar app, what it asks permission for, the addresses it is
// given), what its `.entitlements` allow, and in its Swift source the addresses it names and the API paths it calls,
// which the cross-repo linker matches to the routes another repo serves. Part of drawing a system map from code: see
// system-facts.js.
import fs from 'node:fs';
import path from 'node:path';

import { blankComments, inside, parts, propOf } from './system-facts-ts.js';

/** @typedef {import('./system-facts.js').Fact} Fact */

const MAX_FILE = 2 * 1024 * 1024, MAX_SOURCES = 2000, MAX_CALLS = 150, MAX_URLS = 40, MAX_PLISTS = 10, MAX_TARGETS = 40;
const SKIP = /(^|\/)(\.build|build|DerivedData|Pods|Carthage|\.swiftpm|vendor|node_modules)\//;
/** @param {string} root @param {string} f */
const text = (root, f) => { try { const p = path.join(root, f); return fs.statSync(p).size > MAX_FILE ? '' : fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const lineAt = (/** @type {string} */ s, /** @type {number} */ i) => s.slice(0, i).split('\n').length;
const quoted = (/** @type {string} */ s) => [...s.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
// what an entitlement lets the app do, in words; others are listed by their key
const ENTITLEMENT = /** @type {Record<string, string>} */ ({
  'com.apple.security.app-sandbox': 'runs sandboxed', 'com.apple.security.device.audio-input': 'microphone', 'com.apple.security.device.microphone': 'microphone',
  'com.apple.security.device.camera': 'camera', 'com.apple.security.network.client': 'outgoing network', 'com.apple.security.network.server': 'incoming network',
  'com.apple.security.files.user-selected.read-write': 'files you pick', 'com.apple.security.files.user-selected.read-only': 'files you pick, to read',
  'com.apple.security.personal-information.location': 'location', 'com.apple.security.personal-information.addressbook': 'contacts',
  'com.apple.security.personal-information.calendars': 'calendars', 'com.apple.security.personal-information.photos-library': 'photos',
  'com.apple.security.automation.apple-events': 'controls other apps', 'com.apple.security.application-groups': 'app groups', 'keychain-access-groups': 'keychain groups',
  'aps-environment': 'push notifications', 'com.apple.developer.icloud-services': 'iCloud', 'com.apple.security.cs.allow-jit': 'JIT',
  'com.apple.security.cs.allow-unsigned-executable-memory': 'unsigned executable memory', 'com.apple.security.cs.disable-library-validation': 'unsigned libraries',
});
// addresses that name a format rather than a place the app reaches
const NOT_A_PLACE = /apple\.com\/DTDs|w3\.org|xml-namespaces|xmlns|schemas?\./;
// what an Info.plist usage description asks permission for
const USAGE = /^NS(\w+?)UsageDescription$/;

/**
 * A plist's keys and values, nested ones included, each with its line: strings, numbers and booleans; dicts and
 * arrays are walked, not kept. XML comments are dropped first.
 * @param {string} src @returns {Map<string, { value: string | boolean, line: number }>}
 */
export function plistKeys(src) {
  const s = src.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  /** @type {Map<string, { value: string | boolean, line: number }>} */
  const out = new Map();
  for (const m of s.matchAll(/<key>([^<]+)<\/key>\s*(?:<(string|integer|real|date)>([^<]*)<\/\2>|<(true|false)\s*\/>)?/g)) {
    if (out.has(m[1])) continue;
    out.set(m[1], { value: m[4] ? m[4] === 'true' : decode(m[3] ?? ''), line: lineAt(s, m.index || 0) });
  }
  return out;
}
const decode = (/** @type {string} */ v) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

/** A Swift package: one fact for the package, one per target that is not a test. @param {string} root @param {string} f @returns {Fact[]} */
function swiftPackage(root, f) {
  const s = blankComments(text(root, f));
  const at = s.search(/\bPackage\s*\(/);
  if (at < 0) return [];
  const body = inside(s, s.indexOf('(', at));
  // a top-level argument's list: `targets:` also appears inside each product
  const field = (/** @type {string} */ key) => { const v = propOf(body, key) || ''; return v.startsWith('[') ? inside(v, 0) : ''; };
  const products = parts(field('products')).map((p) => /^\.(\w+)\s*\(\s*name\s*:\s*"([^"]+)"/.exec(p)).filter((m) => !!m).map((m) => `${m[2]} (${m[1]})`);
  /** @type {string[]} */
  const names = [], sources = [];
  for (const p of parts(field('dependencies'))) {
    const url = /\b(url|path)\s*:\s*"([^"]+)"/.exec(p);
    if (!url) continue;
    names.push(url[2].replace(/\.git$/, '').split('/').filter(Boolean).pop() || url[2]);
    const version = /\b(exact|from|branch|revision)\s*:\s*"([^"]+)"/.exec(p) || /"([\d.]+)"\s*\.\.[.<]/.exec(p);
    sources.push(`${url[2]}${version ? ` ${version.length > 2 ? `${version[1]} ${version[2]}` : `from ${version[1]}`}` : ''}`);
  }
  const platforms = parts(field('platforms')).map((p) => /^\.(\w+)\s*\(\s*(?:\.v)?"?([\d_.]+)/.exec(p)).filter((m) => !!m).map((m) => `${m[1]} ${m[2].replace(/_/g, '.')}`);
  const name = /^\s*name\s*:\s*"([^"]+)"/.exec(body)?.[1] || path.basename(path.dirname(path.join(root, f)));
  /** @type {Fact[]} */
  const out = [{ id: '', kind: 'package', at: `${f}:${lineAt(s, at)}`, language: 'swift', name, ...(products.length ? { products } : {}),
    dependencies: names.slice(0, 30), ...(sources.length ? { sources: sources.slice(0, 30) } : {}), ...(platforms.length ? { platforms } : {}) }];
  const targets = field('targets'), offset = body.indexOf(targets);
  for (const m of targets.matchAll(/\.(target|executableTarget|binaryTarget|macro|plugin|systemLibrary)\s*\(/g)) {
    const args = inside(targets, (m.index || 0) + m[0].length - 1);
    const tname = /^\s*name\s*:\s*"([^"]+)"/.exec(args)?.[1];
    if (!tname || out.length > MAX_TARGETS) continue;
    const deps = /\bdependencies\s*:\s*\[/.exec(args);
    const uses = deps ? parts(inside(args, (deps.index || 0) + deps[0].length - 1)).map((d) => /name\s*:\s*"([^"]+)"/.exec(d)?.[1] || quoted(d)[0]).filter(Boolean) : [];
    out.push({ id: '', kind: 'swift_target', at: `${f}:${lineAt(s, at) + lineAt(body, offset + (m.index || 0)) - 1}`, name: tname,
      type: m[1] === 'executableTarget' ? 'executable' : m[1] === 'target' ? 'library' : m[1], ...(uses.length ? { depends_on: uses } : {}) });
  }
  return out;
}

/** An Xcode project: its targets that are not tests, and the bundle ids it builds. @param {string} root @param {string} f @returns {Fact[]} */
function xcodeProject(root, f) {
  const s = text(root, f);
  const project = path.basename(path.dirname(f)).replace(/\.xcodeproj$/, '');
  /** @type {Fact[]} */
  const out = [];
  for (const m of s.matchAll(/\/\* ([^*]+) \*\/ = \{\s*isa = PBXNativeTarget;([\s\S]*?)\n\t*\};/g)) {
    const type = /productType = "com\.apple\.product-type\.([^"]+)"/.exec(m[2])?.[1] || '';
    if (/test/.test(type) || out.length >= MAX_TARGETS) continue;
    out.push({ id: '', kind: 'swift_target', at: `${f}:${lineAt(s, m.index || 0)}`, name: m[1].trim(), type: type || 'target', project });
  }
  const ids = [...new Set([...s.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([\w.$()-]+)"?;/g)].map((m) => m[1]).filter((id) => !/\$|tests?$/i.test(id)))];
  if (out.length || ids.length) out.unshift({ id: '', kind: 'package', at: `${f}:1`, language: 'swift', name: project, dependencies: [], ...(ids.length ? { bundle_ids: ids.slice(0, 20) } : {}) });
  return out;
}

/** What an app's Info.plist says about it, or null when it names no app. @param {string} root @param {string} f @returns {Fact | null} */
function infoPlist(root, f) {
  const keys = plistKeys(text(root, f));
  const get = (/** @type {string} */ k) => { const v = keys.get(k)?.value; return typeof v === 'string' && v && !v.includes('$(') ? v : ''; };
  const name = get('CFBundleDisplayName') || get('CFBundleName') || get('CFBundleExecutable');
  const id = get('CFBundleIdentifier');
  if (!name && !id) return null;
  const asks = [...keys.keys()].map((k) => USAGE.exec(k)?.[1]).filter((k) => !!k).map((k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  /** @type {Record<string, string>} */
  const urls = {};
  for (const [k, { value }] of keys) if (typeof value === 'string' && /^https?:\/\//.test(value)) urls[k] = value.slice(0, 200);
  return { id: '', kind: 'apple_app', at: `${f}:${(keys.get('CFBundleIdentifier') || keys.get('CFBundleName'))?.line || 1}`, name: name || id,
    ...(id ? { bundle_id: id } : {}), ...(get('CFBundleExecutable') ? { executable: get('CFBundleExecutable') } : {}),
    ...(keys.get('LSUIElement')?.value === true ? { menu_bar: true } : {}), ...(get('LSMinimumSystemVersion') ? { min_os: get('LSMinimumSystemVersion') } : {}),
    ...(asks.length ? { asks_for: asks } : {}), ...(Object.keys(urls).length ? { urls } : {}),
    ...(keys.get('NSAllowsLocalNetworking')?.value === true ? { local_network: true } : {}) };
}

/** What an entitlements file allows. @param {string} root @param {string} f @returns {Fact | null} */
function entitlements(root, f) {
  const keys = [...plistKeys(text(root, f))].filter(([, { value }]) => value !== false);
  if (!keys.length) return null;
  return { id: '', kind: 'entitlements', at: `${f}:${keys[0][1].line}`, name: path.basename(f, '.entitlements'), allows: [...new Set(keys.map(([k]) => ENTITLEMENT[k] || k))] };
}

/**
 * The addresses Swift source names and the API paths it calls. A path's method is the call it is handed to
 * (`post("/api/x")`), else the `httpMethod` its function sets, else GET, as a URLRequest's is.
 * @param {string} root @param {string[]} sources @returns {Fact[]}
 */
function swiftSource(root, sources) {
  /** @type {Map<string, Fact>} */
  const calls = new Map(), urls = new Map();
  for (const f of sources) {
    const s = blankComments(text(root, f));
    for (const m of s.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
      const raw = m[1].replace(/\\\((?:[^()]|\([^()]*\))*\)/g, '{}'), i = m.index || 0, at = `${f}:${lineAt(s, i)}`;
      const fn = [...s.slice(Math.max(0, i - 4000), i).matchAll(/\bfunc\s+([A-Za-z_]\w*)/g)].pop()?.[1] || '';
      if (/^https?:\/\/[^\s{}]+/.test(raw)) {
        const url = raw.split(/[?#]/)[0].replace(/\/+$/, '');
        if (NOT_A_PLACE.test(url) || urls.has(url)) { const had = urls.get(url); if (had && (had.also_at ||= []).length < 10) had.also_at.push(at); continue; }
        const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:(\d+))?/.exec(url);
        if (urls.size < MAX_URLS) urls.set(url, { id: '', kind: 'url', at, module: f, url, ...(local ? { local: true, ...(local[3] ? { port: Number(local[3]) } : {}) } : {}) });
      } else if (/^\/(api|v\d+)\//.test(raw)) {
        const p = raw.split('?')[0];
        const named = /\b(get|post|put|patch|delete)\s*\(\s*$/i.exec(s.slice(Math.max(0, i - 40), i))?.[1];
        const body = s.slice(i, i + 1500), next = body.search(/\bfunc\s/);
        const set = /\.httpMethod\s*=\s*"([A-Z]+)"/.exec(next < 0 ? body : body.slice(0, next))?.[1];
        const method = (named || set || 'GET').toUpperCase(), key = `${method} ${p}`;
        const had = calls.get(key);
        if (had) { if ((had.also_at ||= []).length < 10) had.also_at.push(at); continue; }
        if (calls.size < MAX_CALLS) calls.set(key, { id: '', kind: 'api_call', at, module: f, method, path: p, api: 'swift', in_function: fn });
      }
    }
  }
  return [...calls.values(), ...urls.values()];
}

/**
 * Every Swift and Apple app fact in a repo, from its files (tests already left out).
 * @param {string} root @param {string[]} files @returns {Fact[]}
 */
export function swiftFacts(root, files) {
  const kept = files.filter((f) => !SKIP.test(f));
  /** @type {(Fact | null)[]} */
  const out = [];
  for (const f of kept.filter((x) => path.basename(x) === 'Package.swift')) out.push(...swiftPackage(root, f));
  for (const f of kept.filter((x) => /\.xcodeproj\/project\.pbxproj$/.test(x))) out.push(...xcodeProject(root, f));
  for (const f of kept.filter((x) => /(^|[/-])Info\.plist$/.test(x)).slice(0, MAX_PLISTS)) out.push(infoPlist(root, f));
  for (const f of kept.filter((x) => x.endsWith('.entitlements')).slice(0, MAX_PLISTS)) out.push(entitlements(root, f));
  out.push(...swiftSource(root, kept.filter((x) => x.endsWith('.swift') && path.basename(x) !== 'Package.swift').slice(0, MAX_SOURCES)));
  return /** @type {Fact[]} */ (out.filter(Boolean));
}
