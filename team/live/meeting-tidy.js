// The tidy pass when a meeting ends: one more fresh answer with no tools over the meeting's boxes and their notes
// (no talk), proposing to merge boxes that say the same thing, to fold points that settle nothing into their topic's
// notes, and to promote a note that matters later to a point. It is given a target for the meeting's points and
// must propose enough to reach it. Claude only proposes; code checks every op against the boxes and the transcript
// and turns what passes into a drawing. Only boxes Claude made are touched, never one a person wrote or changed. No
// network, no clock.

import { alike, boxLine, lineOf, MAX_POINTS, MEETING_ID, noteQuote, notesOf, noteText, pointCount, quoted, shortQuote, unsaidNames, withNotes } from './meeting-draw.js';

// what a meeting's points come down to at its end: every decision, action item and open question of the replayed
// 41-minute call (17) and room for a few facts that matter later
export const TIDY_TARGET = 20;

export const TIDY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'ops'],
  properties: {
    summary: { type: 'string', description: 'One short line: what you tidied.' },
    ops: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'id'],
        properties: {
          op: { type: 'string', enum: ['merge', 'fold', 'promote'] },
          id: { type: 'string', description: 'merge: the box that goes; fold: the point that becomes a note on its topic; promote: the box holding the note' },
          into: { type: 'string', description: 'merge: the box it goes into, at the same level (a topic into a topic, a point into a point)' },
          note: { type: 'integer', description: 'promote: the number of the note on that box' },
          title: { type: 'string', description: 'promote: the new point\'s title, under 10 words, in sentence case' },
          kind: { type: 'string', enum: ['decision', 'action', 'question', 'fact'], description: 'promote: what the new point is' },
          why: { type: 'string', description: 'a few words' },
        },
      },
    },
  },
};

/**
 * What the tidy pass is told and shown: the meeting's boxes with their numbered notes, the lines between them, and
 * how many points it has against the target.
 * @param {{ by: string, title: string, boxes: any[], lines?: { from: string, to: string, label: string }[], target?: number, retry?: string }} o
 */
export function tidyPrompt({ by, title, boxes, lines = [], target = TIDY_TARGET, retry = '' }) {
  const points = pointCount(boxes);
  return [
    `The meeting "${title}" has ended and its map is drawn. Tidy it for ${by || 'the person recording'}, who will read it later: fewer boxes, nothing lost. Answer only in the given shape; code checks every op and drops what fails.`,
    `The map: the meeting box "${MEETING_ID}" → topics → at most ${MAX_POINTS} points each. Every box keeps notes; what you merge or fold moves into notes, so nothing said is lost.`,
    `It has ${points} points; the target is at most ${target}.${points > target ? ` Propose enough merges and folds to remove at least ${points - target}.` : ' It may stay as it is.'}`,
    '- merge: two boxes that say the same thing, or one that only adds to the other: "id" goes into "into" (a topic into a topic, a point into a point). Its notes and lines move with it.',
    '- fold: a point that settles nothing, assigns nothing and leaves no question open becomes a note on its topic. Decisions, action items and open questions stay boxes.',
    '- promote: a note that is itself a decision, an action item or an open question becomes a point under its topic ("id" the box holding it, "note" its number, a title and a kind), only while the topic and the meeting are under their limits.',
    'Leave boxes marked as written by a person.',
    `\nTHE MEETING'S BOXES (id · kind · title · line, then its numbered notes):\n${boxes.map((b) => boxLine(b, { numbered: true })).join('\n') || '(none)'}`,
    lines.length ? `\nLINES BETWEEN THEM:\n${lines.map((l) => `- ${l.from} ${l.label} ${l.to}`).join('\n')}` : '',
    retry ? `\nYOUR LAST ANSWER LEFT THE MAP OVER THE TARGET. These were refused; propose others:\n${retry}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Checks the tidy pass's answer against the meeting's boxes and turns what passes into a drawing: notes moved onto
 * the box that stays, labelled lines re-pointed to it, a merged topic's points moved under the topic it joined, a
 * promoted note drawn as a point, and the boxes that went removed. `boxes` are as checkMeetingOps takes them;
 * `lines` the labelled lines between them; `transcript` everything said, which a promoted note's words must be in.
 * @param {any} answer
 * @param {{ boxes: any[], lines: { from: string, to: string, label: string }[], transcript?: string, taken?: Set<string>, known?: string[], target?: number }} ctx
 * @returns {{ nodes: any[], edges: any[], remove: string[], refused: { op: any, why: string }[], merged: { id: string, into: string }[], folded: { id: string, into: string }[], promoted: { id: string, from: string }[], added: any[], points: number }}
 */
export function checkTidyOps(answer, { boxes, lines, transcript = '', taken = new Set(), known = [], target = TIDY_TARGET }) {
  /** @type {any[]} */ const nodes = [];
  /** @type {any[]} */ const edges = [];
  /** @type {any[]} */ const added = [];
  /** @type {string[]} */ const remove = [];
  /** @type {{ op: any, why: string }[]} */ const refused = [];
  /** @type {{ id: string, into: string }[]} */ const merged = [], folded = [];
  /** @type {{ id: string, from: string }[]} */ const promoted = [];
  /** @type {Map<string, any>} */ const all = new Map(boxes.map((b) => [b.id, { ...b }]));
  let links = lines.map((l) => ({ ...l }));
  const shown = new Map(boxes.map((b) => [b.id, notesOf(b.desc)]));
  /** @type {Map<string, any>} */ const drawn = new Map();
  const put = (/** @type {any} */ n) => { const had = drawn.get(n.id); if (had) Object.assign(had, n); else { drawn.set(n.id, n); nodes.push(n); } };
  const under = (/** @type {string} */ id) => [...all.values()].filter((b) => b.under === id);
  const isTopic = (/** @type {any} */ b) => b.under === MEETING_ID;
  // the box's own words first, then its notes, as lines on the box it moves into
  const carried = (/** @type {any} */ b) => {
    const quote = String(b.desc || '').split('\n').find((l) => l.startsWith('"')) || '';
    return [`- ${b.label}${b.sub ? `: ${b.sub}` : ''}${quote ? ` — "${shortQuote(quote.replace(/^"|"$/g, ''))}"` : ''}`, ...notesOf(b.desc)];
  };
  /** Moves `b` into `into`: its notes, its labelled lines, and what hangs under it; then it goes. @param {any} b @param {any} into */
  const absorb = (b, into) => {
    for (const c of under(b.id)) { c.under = into.id; edges.push({ from: into.id, to: c.id }); }
    links = links.flatMap((l) => {
      if (l.from !== b.id && l.to !== b.id) return [l];
      const moved = { ...l, from: l.from === b.id ? into.id : l.from, to: l.to === b.id ? into.id : l.to };
      if (moved.from === moved.to || links.some((x) => x.from === moved.from && x.to === moved.to)) return [];
      edges.push(moved); return [moved];
    });
    all.delete(b.id); remove.push(b.id);
  };
  const refuse = (/** @type {any} */ op, /** @type {string} */ why) => refused.push({ op, why });

  for (const op of Array.isArray(answer?.ops) ? answer.ops.slice(0, 30) : []) {
    if (!op || typeof op !== 'object') continue;
    const b = all.get(String(op.id ?? ''));
    if (!b) { refuse(op, `"${op.id}" is not one of the meeting's boxes`); continue; }
    if (b.locked) { refuse(op, `${b.label} was written by a person: the meeting leaves it`); continue; }
    if (op.op === 'merge') {
      const into = all.get(String(op.into ?? ''));
      if (!into || into.id === b.id) { refuse(op, `"${op.into}" is not another of the meeting's boxes`); continue; }
      if (into.locked) { refuse(op, `${into.label} was written by a person: the meeting leaves it`); continue; }
      if (isTopic(b) !== isTopic(into)) { refuse(op, 'a topic merges only into a topic, a point only into a point'); continue; }
      const kids = under(b.id);
      if (kids.some((c) => c.locked)) { refuse(op, `${b.label} holds a box a person wrote`); continue; }
      if (isTopic(b) && under(into.id).length + kids.length > MAX_POINTS) { refuse(op, `${into.label} would have more than ${MAX_POINTS} points: fold some first`); continue; }
      if (!isTopic(b) && kids.length) { refuse(op, `${b.label} has boxes under it`); continue; }
      const desc = withNotes(into.desc, carried(b));
      if (desc === null) { refuse(op, `${into.label}'s notes would be too long`); continue; }
      into.desc = desc; put({ id: into.id, desc });
      absorb(b, into); merged.push({ id: b.id, into: into.id });
      continue;
    }
    if (op.op === 'fold') {
      const topic = all.get(b.under);
      if (isTopic(b) || !topic) { refuse(op, 'only a point under a topic folds into its notes'); continue; }
      if (topic.locked) { refuse(op, `${topic.label} was written by a person: the meeting leaves it`); continue; }
      if (under(b.id).length) { refuse(op, `${b.label} has boxes under it`); continue; }
      if (b.kind === 'decision' || b.kind === 'action' || (b.kind === 'question' && !/^Answered\b/.test(b.sub || ''))) {
        refuse(op, `${b.label} is ${b.kind === 'decision' ? 'a decision' : b.kind === 'action' ? 'an action item' : 'an open question'}: it stays a box`); continue;
      }
      const desc = withNotes(topic.desc, carried(b));
      if (desc === null) { refuse(op, `${topic.label}'s notes would be too long`); continue; }
      topic.desc = desc; put({ id: topic.id, desc });
      absorb(b, topic); folded.push({ id: b.id, into: topic.id });
      continue;
    }
    if (op.op === 'promote') {
      // a note is named by its number in the list Claude was shown, whatever earlier ops in this answer moved
      const topic = isTopic(b) ? b : all.get(b.under), lines = notesOf(b.desc), line = shown.get(b.id)?.[Number(op.note) - 1];
      const kind = ['decision', 'action', 'question', 'fact'].includes(op.kind) ? op.kind : null, title = String(op.title || '').trim();
      if (!line) { refuse(op, `${b.label} has no note ${op.note}`); continue; }
      if (!lines.includes(line)) { refuse(op, `note ${op.note} on ${b.label} has already moved`); continue; }
      if (!kind || !title) { refuse(op, 'a promoted note needs a title and a kind'); continue; }
      if (!topic || topic.locked) { refuse(op, 'its topic is not one the meeting may change'); continue; }
      if (under(topic.id).length >= MAX_POINTS) { refuse(op, `${topic.label} already has ${MAX_POINTS} points`); continue; }
      if (pointCount(all.values()) >= target) { refuse(op, `the meeting already has ${target} points`); continue; }
      if (!quoted(noteQuote(line), transcript)) { refuse(op, 'its note\'s words are not in what was said'); continue; }
      const names = unsaidNames(title, noteQuote(line), known);
      if (names.length) { refuse(op, `${names.map((x) => `"${x}"`).join(', ')} not in its note's words`); continue; }
      const twin = under(topic.id).find((p) => alike(p.label, title) >= 0.6);
      if (twin) { refuse(op, `near copy of "${twin.label}" (${twin.id})`); continue; }
      const base = `m-${title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join('-') || 'box'}`.slice(0, 40);
      let id = base; for (let k = 2; taken.has(id) || all.has(id); k++) id = `${base}-${k}`;
      taken.add(id);
      const box = { id, kind, label: title.slice(0, 60), sub: lineOf(kind, noteText(line)), under: topic.id, desc: `"${noteQuote(line)}"` };
      all.set(id, box); added.push(box);
      put({ id, label: box.label, sub: box.sub, desc: box.desc, ...(kind === 'question' || kind === 'action' ? { state: 'todo' } : {}) });
      edges.push({ from: topic.id, to: id });
      const desc = lines.filter((l) => l !== line), kept = String(b.desc || '').split('\n').filter((l) => !l.startsWith('- '));
      b.desc = [...kept, ...desc].join('\n'); put({ id: b.id, desc: b.desc });
      promoted.push({ id, from: b.id });
      continue;
    }
    refuse(op, 'op must be merge, fold or promote');
  }
  return { nodes, edges, remove, refused, merged, folded, promoted, added, points: pointCount(all.values()) };
}
