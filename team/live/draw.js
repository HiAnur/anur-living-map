// What a call to living_map_change becomes: from what Claude asked for and the map as it is, the edit to send
// the map and the lines that say what was done and what was left out. No network and no clock of its own, so
// every rule about what Claude may draw can be tested here.

import { fileURLToPath } from 'node:url';

export const STATES = ['new', 'todo', 'assumed-gone', 'gone'];
export const KINDS = ['timeline', 'sequence', 'venn'];
// how long a box's name, second line and notes may be, wherever they are written
export const BOX_TEXT = { label: 80, sub: 240, desc: 1500 };

/** The person who last changed a box or made it, if a person did. @param {any} n @returns {string | null} */
export const personOf = (n) => [n?.updatedBy, n?.by].find((w) => typeof w === 'string' && w && w !== 'Claude') || null;
/**
 * Whether Claude or code made a box, as far as it records: Claude's mark, a system map's code (`origin`, a `code`
 * source), a repo's folders (`file`, `dir`), or a chat's drawing (any source but a person's `map`). A box with no
 * maker and no creation date is from before the map recorded either, when people's boxes already carried their
 * name, so Claude or code drew it; one with a date and no maker is treated as a person's.
 * @param {any} n
 */
export function drawnByClaude(n) {
  if (personOf(n)) return false;
  if (n?.by === 'Claude' || n?.origin === 'code' || n?.file || n?.dir) return true;
  if (n?.source?.kind) return n.source.kind !== 'map';
  return !(Number.isFinite(n?.createdAt) && n.createdAt > 0);
}
/**
 * Why Claude may change a box already on the map only through a proposal a person applies, or null when it may
 * change it directly: a person made or changed it, nobody recorded who made it, or the change takes off the map a
 * box Claude did not make.
 * @param {any} old the box as it is @param {any} change what Claude would set on it
 */
export function waitsForApply(old, change) {
  const who = personOf(old);
  if (who) return `${who} ${old.updatedBy === who ? 'last changed' : 'made'} it`;
  if (!drawnByClaude(old)) return 'nobody recorded who made it';
  if (change?.state === 'gone' && old?.by !== 'Claude') return 'Claude did not make it';
  return null;
}

/** @param {unknown} t */
export const slug = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'box';
/** @param {unknown} t @param {number} n */
export const clip = (t, n) => String(t ?? '').slice(0, n);

// nothing was asked for at all: said before the map is even read
/** @param {any} args */
export const asksNothing = ({ boxes = [], lines = [], questions = [], remember = [], remove_lines: removeLines = [], tidy = false, start } = {}) =>
  ![boxes, lines, questions, remember, removeLines].some((x) => Array.isArray(x) && x.length) && tidy !== true && !start;

/**
 * @param {any} args what living_map_change was called with
 * @param {any} s the map's state, as its server gives it
 * @param {number} [now]
 */
export function planChange({ note, boxes = [], lines = [], questions = [], remember = [], remove_lines: removeLines = [], tidy = false, start, session } = {}, s, now = Date.now()) {
  const had = s.nodes || [], people = s.people || [];
  /** @type {any[]} */
  const nodes = [], edges = [], calls = [], done = [], skipped = [];
  const taken = new Set(had.map((/** @type {any} */ n) => n.id));
  // a box named by id, or by its name on the map or in this change
  /** @param {unknown} ref */
  const find = (ref) => {
    const r = String(ref ?? '').trim(), low = r.toLowerCase();
    return nodes.find((/** @type {any} */ n) => n.id === r) || had.find((/** @type {any} */ n) => n.id === r)
      || nodes.find((/** @type {any} */ n) => n.label?.toLowerCase() === low) || had.find((/** @type {any} */ n) => n.label?.toLowerCase() === low) || null;
  };
  const label = (/** @type {string} */ id) => nodes.find((/** @type {any} */ n) => n.id === id)?.label || had.find((/** @type {any} */ n) => n.id === id)?.label || id;

  // a change to a box people wrote waits for Apply in the Claude pane of the chat that asked, when it is linked to
  // this map, else of the chat linked to it
  const linked = s.linked?.find((/** @type {any} */ l) => l.session === session) || s.linked?.[0] || null, propose = [];
  for (const b of boxes.slice(0, 40)) {
    // a name only finds a box to hang it under another; changing a box already on the map takes its exact id
    const named = !b.id && b.label ? find(b.label) : null;
    if (named) {
      const up = b.under ? find(b.under) : null;
      if (['sub', 'notes', 'state', 'diagram', 'area'].some((k) => b[k] !== undefined) || !b.under) { skipped.push(`box "${b.label}": ${named.label} is already on the map; to change it, give its id (${named.id})`); continue; }
      if (up && up.id !== named.id) { edges.push({ from: up.id, to: named.id }); done.push(`${named.label} hangs under ${up.label}`); } else skipped.push(`"${b.under}" above ${named.label}: no such box`);
      continue;
    }
    const old = b.id ? had.find((/** @type {any} */ n) => n.id === b.id) : null;
    if (!old && !b.label) { skipped.push(`a box with no name${b.id ? ` (${b.id})` : ''}`); continue; }
    // a new box says what it is under its name; a box already on the map is changed as it is
    if (!old && !String(b.sub ?? '').trim()) { skipped.push(`box "${b.label}": a new box needs a second line (sub) that says what it is, in a few words`); continue; }
    if (b.state && !STATES.includes(b.state)) { skipped.push(`state "${b.state}" on ${b.label || b.id}: use ${STATES.join(', ')}`); delete b.state; }
    if (b.diagram && !KINDS.includes(b.diagram.kind)) { skipped.push(`diagram "${b.diagram.kind}" on ${b.label || b.id}: use ${KINDS.join(', ')}`); delete b.diagram; }
    let id = old?.id || (b.id && /^[a-z0-9-]{1,40}$/.test(b.id) ? b.id : slug(b.label));
    if (!old) { const base = id; for (let k = 2; taken.has(id); k++) id = `${base}-${k}`; taken.add(id); }
    const box = { id, ...(b.label ? { label: clip(b.label, BOX_TEXT.label) } : {}), ...(b.sub !== undefined ? { sub: clip(b.sub, BOX_TEXT.sub) } : {}),
      ...(b.notes !== undefined ? { desc: clip(b.notes, BOX_TEXT.desc) } : {}), ...(b.state ? { state: b.state } : {}),
      ...(b.area ? { area: clip(b.area, 30) } : {}), ...(b.diagram !== undefined ? { diagram: b.diagram } : {}), ...(old ? {} : { by: 'Claude' }) };
    const why = old && Object.keys(box).length > 1 ? waitsForApply(old, box) : null;
    if (why && !linked) { skipped.push(`box ${old.label} (${id}): ${why}, so Claude changes it only through a proposal someone applies, and no Claude Code chat is linked to this map to hold one. Ask them to change it, or link this chat with /anur-living-map`); }
    else if (why) {
      // a proposal changes what a box says; which area it sits in is for a person to move
      if (box.area) { skipped.push(`area "${box.area}" on ${old.label}: ${why}, so only a person moves it to another area`); delete box.area; }
      if (Object.keys(box).length > 1) { propose.push(box); done.push(`Proposed a change to ${old.label} (${id}): ${why}, so it waits for Apply in ${linked.owner}'s Claude pane on the map`); }
    } else {
      nodes.push(box);
      done.push(old ? `Changed ${old.label} (${id})` : `Added ${box.label} (${id})`);
      if (box.diagram?.items?.length) done.push(`  opens into a ${box.diagram.kind} of ${box.diagram.items.length} with a double click`);
    }
    if (b.under) {
      const up = find(b.under);
      if (up && up.id !== id) { edges.push({ from: up.id, to: id }); done.push(`  under ${up.label}`); } else skipped.push(`"${b.under}" above ${box.label || old?.label || id}: no such box`);
    }
  }
  for (const l of lines.slice(0, 40)) {
    const a = find(l.from), z = find(l.to);
    if (!a || !z) { skipped.push(`line ${l.from} → ${l.to}: ${!a ? l.from : l.to} is not on the map`); continue; }
    // a line drawn here says what one box does to the other; a box that only belongs under another has `under`
    if (!String(l.label ?? '').trim()) { skipped.push(`line ${label(a.id)} → ${label(z.id)}: say what happens on it (label), or set "under" on ${label(z.id)} if it only belongs under ${label(a.id)}`); continue; }
    edges.push({ from: a.id, to: z.id, ...(l.label ? { label: clip(l.label, 40) } : {}) });
    done.push(`Line ${a.label} → ${z.label}${l.label ? ` (${l.label})` : ''}`);
  }
  for (const [i, q] of questions.slice(0, 10).entries()) {
    const on = find(q.box), who = people.find((/** @type {any} */ p) => p.id.toLowerCase() === String(q.for || '').toLowerCase());
    if (!on || !who || !q.ask) { skipped.push(`question "${q.ask || '?'}": ${!q.ask ? 'no question' : !on ? `no box "${q.box}"` : `no one called "${q.for}" (${people.map((/** @type {any} */ p) => p.id).join(', ')})`}`); continue; }
    // someone who sees only one area (the CFO sees billing) could not open a box outside it: the box joins their area
    if (who.sees && who.sees !== 'all' && on.area !== who.sees) {
      const mine = nodes.find((n) => n.id === on.id);
      if (mine) mine.area = who.sees; else nodes.push({ id: on.id, area: who.sees });
      on.area = who.sees; done.push(`  ${on.label} joins area "${who.sees}" so ${who.id} can see it`);
    }
    const options = (q.options || []).slice(0, 4).filter((/** @type {any} */ o) => o?.label).map((/** @type {any} */ o) => ({ id: slug(o.label), label: clip(o.label, 60), ...(o.means ? { means: clip(o.means, 160) } : {}) }));
    calls.push({ id: `q${now.toString(36)}${i}`, node: on.id, for: who.id, from: 'Claude', kind: on.area === 'billing' ? 'Money call' : 'Product call', status: 'open',
      ask: clip(q.ask, 160), text: clip(q.ask, 160), ...(q.why ? { plain: clip(q.why, 300) } : {}),
      ...(options.length >= 2 ? { options } : { ...(q.yes ? { yes: clip(q.yes, 160) } : {}), ...(q.no ? { no: clip(q.no, 160) } : {}) }) });
    done.push(`Question for ${who.id} on ${label(on.id)}: ${q.ask}`);
  }
  const memory = [];
  for (const r of remember.slice(0, 10)) {
    const on = r.box ? find(r.box) : null;
    if (!r.text || (r.box && !on)) { skipped.push(`remember "${r.text || '?'}": ${!r.text ? 'no words' : `no box "${r.box}"`}`); continue; }
    memory.push({ kind: r.kind === 'instruction' ? 'instruction' : 'memory', box: on?.id || null, text: clip(r.text, 300) });
    done.push(`${r.kind === 'instruction' ? 'Instruction' : 'Memory'} for ${on ? on.label : 'the whole map'}: ${r.text}`);
  }
  const unlink = [];
  for (const l of (removeLines || []).slice(0, 40)) {
    const a = find(l.from), z = find(l.to);
    if (!a || !z) { skipped.push(`remove line ${l.from} → ${l.to}: ${!a ? l.from : l.to} is not on the map`); continue; }
    unlink.push({ from: a.id, to: z.id }); done.push(`Removed the line ${a.label} → ${z.label}`);
  }
  const top = start ? find(start) : null;
  if (start && !top) skipped.push(`start from "${start}": no such box`);
  if (top) done.push(`The map starts from ${top.label}`);
  if (tidy === true) done.push('Laid out the whole map again, each box beside the box it hangs under');
  if (!nodes.length && !propose.length && !edges.length && !calls.length && !memory.length && !unlink.length && tidy !== true && !top) throw new Error(`Nothing changed. ${skipped.join('; ')}`);
  return { edit: { note: clip(note || done[0], 200), nodes, ...(propose.length ? { propose } : {}), edges, calls, memory, unlink, tidy: tidy === true, ...(top ? { start: top.id } : {}) }, done, skipped };
}

// What a chat the map runs itself may draw with: mcp.js pinned to one map (LIVING_MAP_ONLY_MAP), so its tools refuse
// any other, list only reading and changing that map, and set no instructions or memory; LIVING_MAP_SESSION names the
// chat on every change it sends, so the map knows whose change it is.
export const PINNED = 'LIVING_MAP_ONLY_MAP', SESSION = 'LIVING_MAP_SESSION';
export const DRAW_TOOLS = ['living_map_read', 'living_map_change'];
/** @param {{ url: string, map: string, session: string }} o @returns {McpServer} */
export const drawServer = ({ url, map, session }) => ({ command: process.execPath, args: [fileURLToPath(new URL('./mcp.js', import.meta.url))],
  env: { LIVING_MAP_URL: url, [PINNED]: map, [SESSION]: session }, tools: DRAW_TOOLS });
