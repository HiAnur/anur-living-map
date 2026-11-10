// What a call to living_map_change becomes: from what Claude asked for and the map as it is, the edit to send
// the map and the lines that say what was done and what was left out. No network and no clock of its own, so
// every rule about what Claude may draw can be tested here.

export const STATES = ['new', 'todo', 'assumed-gone', 'gone'];
export const KINDS = ['timeline', 'sequence', 'venn'];

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
export function planChange({ note, boxes = [], lines = [], questions = [], remember = [], remove_lines: removeLines = [], tidy = false, start } = {}, s, now = Date.now()) {
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

  for (const b of boxes.slice(0, 40)) {
    const old = b.id ? had.find((/** @type {any} */ n) => n.id === b.id) : find(b.label);
    if (!old && !b.label) { skipped.push(`a box with no name${b.id ? ` (${b.id})` : ''}`); continue; }
    if (b.state && !STATES.includes(b.state)) { skipped.push(`state "${b.state}" on ${b.label || b.id}: use ${STATES.join(', ')}`); delete b.state; }
    if (b.diagram && !KINDS.includes(b.diagram.kind)) { skipped.push(`diagram "${b.diagram.kind}" on ${b.label || b.id}: use ${KINDS.join(', ')}`); delete b.diagram; }
    let id = old?.id || (b.id && /^[a-z0-9-]{1,40}$/.test(b.id) ? b.id : slug(b.label));
    if (!old) { const base = id; for (let k = 2; taken.has(id); k++) id = `${base}-${k}`; taken.add(id); }
    // a box found by its name keeps its own spelling; given its id, a new name renames it
    const box = { id, ...(b.label && (!old || b.id) ? { label: clip(b.label, 60) } : {}), ...(b.sub !== undefined ? { sub: clip(b.sub, 80) } : {}),
      ...(b.notes !== undefined ? { desc: clip(b.notes, 1500) } : {}), ...(b.state ? { state: b.state } : {}),
      ...(b.area ? { area: clip(b.area, 30) } : {}), ...(b.diagram !== undefined ? { diagram: b.diagram } : {}), ...(old ? {} : { by: 'Claude' }) };
    nodes.push(box);
    done.push(old ? `Changed ${old.label} (${id})` : `Added ${box.label} (${id})`);
    if (box.diagram?.items?.length) done.push(`  opens into a ${box.diagram.kind} of ${box.diagram.items.length} with a double click`);
    if (b.under) {
      const up = find(b.under);
      if (up && up.id !== id) { edges.push({ from: up.id, to: id }); done.push(`  under ${up.label}`); } else skipped.push(`"${b.under}" above ${box.label || id}: no such box`);
    }
  }
  for (const l of lines.slice(0, 40)) {
    const a = find(l.from), z = find(l.to);
    if (!a || !z) { skipped.push(`line ${l.from} → ${l.to}: ${!a ? l.from : l.to} is not on the map`); continue; }
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
  if (!nodes.length && !edges.length && !calls.length && !memory.length && !unlink.length && tidy !== true && !top) throw new Error(`Nothing changed. ${skipped.join('; ')}`);
  return { edit: { note: clip(note || done[0], 200), nodes, edges, calls, memory, unlink, tidy: tidy === true, ...(top ? { start: top.id } : {}) }, done, skipped };
}
