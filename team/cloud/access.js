// Who may open an online copy, and what they may do there. A copy published with Google belongs to that Google
// account (`owner`); the owner lists people by address, each able to view or edit (`people`), and may let anyone
// with the link view it (`linkView`). A copy published before Google sign-in has no owner and keeps its link's
// view or edit mode until its Mac claims it.
import crypto from 'node:crypto';

import { plainName, validEmail } from './google-id.js';

export const MAX_PEOPLE = 100;
export const SESSION_DAYS = 30;

// Cookies the cloud signs with a key of its own, derived from its publisher key, so it keeps no session store:
// a session names the Google address and name it was made for, a sign-in in progress its state and verifier.
/** @param {string} secret */
export function sealer(secret) {
  const key = crypto.createHmac('sha256', secret).update('living-map cloud cookies').digest();
  /** @param {string} s */
  const mac = (s) => crypto.createHmac('sha256', key).update(s).digest('base64url');
  return {
    /** @param {string} kind @param {object} value */
    seal: (kind, value) => { const s = Buffer.from(JSON.stringify({ ...value, kind, at: Date.now() })).toString('base64url'); return `${s}.${mac(s)}`; },
    /** @param {string} kind @param {unknown} sealed @param {number} ttl @returns {any} */
    open(kind, sealed, ttl) {
      const [s, m] = String(sealed || '').split('.');
      if (!s || !m || m.length !== 43 || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(mac(s)))) return null;
      try { const o = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); return o.kind === kind && Date.now() - o.at < ttl ? o : null; } catch { return null; }
    },
  };
}

/** @param {any} req @param {string} name */
export const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((/** @type {string} */ c) => c.split('=')).find((/** @type {string[]} */ [k]) => k === name)?.[1] || '';

/**
 * What a visitor may do on a copy: 'edit', 'view', or null, and whether they are its owner. `email` is the
 * signed-in Google address, '' for someone not signed in.
 * @param {any} v the stored record @param {string} email
 */
export function visitorRole(v, email) {
  if (v.mode === 'restricted') return { role: null, owner: false };
  if (!v.owner) return { role: ['view', 'edit'].includes(v.mode) ? v.mode : null, owner: false };
  if (email && email === v.owner.email) return { role: 'edit', owner: true };
  const listed = email ? v.people?.[email] : undefined;
  if (listed === 'edit' || listed === 'view') return { role: listed, owner: false };
  return { role: v.linkView ? 'view' : null, owner: false };
}

/** What the owner's Mac is told about a copy's access; the same shape it sends back to the Share dialog. */
/** @param {any} v */
export const accessOf = (v) => v.owner ? { owner: v.owner, people: v.people || {}, linkView: !!v.linkView } : null;

// The owner's change to who has access, checked field by field: anything from a page is untrusted.
/** @param {any} v @param {any} change @returns {string} what is wrong, or '' once applied */
export function applyAccess(v, change) {
  if (change.linkView !== undefined) {
    if (typeof change.linkView !== 'boolean') return 'Choose on or off.';
    v.linkView = change.linkView;
  }
  if (change.person !== undefined) {
    const p = change.person, email = typeof p?.email === 'string' ? p.email.trim().toLowerCase() : '';
    if (!validEmail(email)) return 'Type a whole email address, like name@example.com.';
    if (email === v.owner.email) return 'You own this map, so you already have access.';
    if (p.role !== null && p.role !== 'view' && p.role !== 'edit') return 'Choose Can view or Can edit.';
    const people = { ...v.people };
    if (p.role === null) delete people[email];
    else {
      if (!(email in people) && Object.keys(people).length >= MAX_PEOPLE) return `A map can be shared with up to ${MAX_PEOPLE} people.`;
      people[email] = p.role;
    }
    v.people = people;
  }
  return '';
}

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * The page a visitor sees instead of the map: sign in with Google, or ask the owner. No script runs on it.
 * @param {{ ownerName: string, signedInAs: string, signIn: string }} o `signIn`: this cloud's sign-in address,
 * coming back to the map
 */
export function gatePage({ ownerName, signedInAs, signIn }) {
  const owner = esc(plainName(ownerName) || 'the owner');
  return signedInAs
    ? page(`<h1>Ask ${owner} for access</h1><p>You're signed in as ${esc(signedInAs)}, which isn't on this map's list. Ask ${owner} to add this address, then open the link again.</p><a class="out" href="${esc(signIn)}">Use another Google account</a>`)
    : page(`<h1>Sign in to open this map</h1><p>${owner} shared this map with people by email. Sign in with the Google account they invited.</p><a class="go" href="${esc(signIn)}">Sign in with Google</a>`);
}
/** A plain message in the same frame, for a sign-in that went wrong. @param {string} title @param {string} text */
export const notePage = (title, text) => page(`<h1>${esc(title)}</h1><p>${esc(text)}</p>`);
/** @param {string} body */
function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Living Map</title>
<style>:root{--bg:#f5f4ed;--card:#fff;--ink:#141413;--ink-2:#5e5d59;--rule:#e0ddd3;--go:#2c6fd6;--on-go:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#1f1e1c;--card:#2a2926;--ink:#f0eee6;--ink-2:#b8b5ab;--rule:#3d3b37;--go:#7fb0ff;--on-go:#10233f}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:420px;background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:28px}
h1{font-size:20px;font-weight:500;margin:0 0 10px}p{color:var(--ink-2);margin:0 0 22px}
a{display:inline-block;border-radius:8px;padding:9px 14px;text-decoration:none;font-weight:500}
.go{background:var(--go);color:var(--on-go)}.out{border:1px solid var(--rule);color:var(--ink)}</style></head>
<body><main data-gate>${body}</main></body></html>`;
}
