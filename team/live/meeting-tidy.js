// The tidy pass when a meeting ends: one more fresh answer with no tools over the meeting's boxes and their notes
// (no talk), proposing to merge boxes that say the same thing and to fold points that settle nothing into their
// topic's notes. Claude only proposes; code checks every op and turns what passes into a drawing. Only boxes Claude
// made are touched, never one a person wrote or changed. No network, no clock.

import { boxLine, MAX_POINTS, MEETING_ID, notesOf, withNotes } from './meeting-draw.js';

export const TIDY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'ops'],
  properties: {
    summary: { type: 'string', description: 'One short line: what you tidied, for the person recording.' },
    ops: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'id'],
        properties: {
          op: { type: 'string', enum: ['merge', 'fold'] },
          id: { type: 'string', description: 'merge: the box that goes; fold: the point that becomes a note on its topic' },
          into: { type: 'string', description: 'merge: the box it goes into, at the same level (a topic into a topic, a point into a point)' },
          why: { type: 'string', description: 'a few words' },
        },
      },
    },
  },
};

/**
 * What the tidy pass is told and shown: the meeting's boxes with their notes, and the lines between them.
 * @param {{ by: string, title: string, boxes: any[], lines?: { from: string, to: string, label: string }[] }} o
 */
export function tidyPrompt({ by, title, boxes, lines = [] }) {
  return [
    `The meeting "${title}" has ended and its map is drawn. Tidy it for ${by || 'the person recording'}, who will read it later: fewer boxes, nothing lost. Answer only in the given shape; code checks every op and drops what fails.`,
    `The map: the meeting box "${MEETING_ID}" → topics → at most ${MAX_POINTS} points each. Every box keeps notes; what you merge or fold moves into notes, so nothing said is lost.`,
    '- merge: two boxes that say the same thing, or one that only adds to the other: "id" goes into "into" (a topic into a topic, a point into a point). Its notes and lines move with it.',
    '- fold: a point that settles nothing, assigns nothing and leaves no question open becomes a note on its topic. Decisions, action items and open questions stay boxes.',
    'Leave boxes marked as written by a person. Most maps need only a few ops; none is a fine answer.',
    `\nTHE MEETING'S BOXES (id · kind · title · line, then its notes):\n${boxes.map(boxLine).join('\n') || '(none)'}`,
    lines.length ? `\nLINES BETWEEN THEM:\n${lines.map((l) => `- ${l.from} ${l.label} ${l.to}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Checks the tidy pass's answer against the meeting's boxes and turns what passes into a drawing: notes moved onto
 * the box that stays, labelled lines re-pointed to it, a merged topic's points moved under the topic it joined, and
 * the box that went removed. `boxes` are as checkMeetingOps takes them; `lines` the labelled lines between them.
 * @param {any} answer @param {{ boxes: any[], lines: { from: string, to: string, label: string }[] }} ctx
 * @returns {{ nodes: any[], edges: any[], remove: string[], refused: { op: any, why: string }[], merged: { id: string, into: string }[], folded: { id: string, into: string }[] }}
 */
export function checkTidyOps(answer, { boxes, lines }) {
  /** @type {any[]} */ const nodes = [];
  /** @type {any[]} */ const edges = [];
  /** @type {string[]} */ const remove = [];
  /** @type {{ op: any, why: string }[]} */ const refused = [];
  /** @type {{ id: string, into: string }[]} */ const merged = [], folded = [];
  /** @type {Map<string, any>} */ const all = new Map(boxes.map((b) => [b.id, { ...b }]));
  let links = lines.map((l) => ({ ...l }));
  /** @type {Map<string, any>} */ const drawn = new Map();
  const put = (/** @type {any} */ n) => { const had = drawn.get(n.id); if (had) Object.assign(had, n); else { drawn.set(n.id, n); nodes.push(n); } };
  const under = (/** @type {string} */ id) => [...all.values()].filter((b) => b.under === id);
  const isTopic = (/** @type {any} */ b) => b.under === MEETING_ID;
  // the box's own words first, then its notes, as lines on the box it moves into
  const carried = (/** @type {any} */ b) => {
    const quote = String(b.desc || '').split('\n').find((l) => l.startsWith('"')) || '';
    return [`- ${b.label}${b.sub ? `: ${b.sub}` : ''}${quote ? ` — ${quote}` : ''}`, ...notesOf(b.desc)];
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

  for (const op of Array.isArray(answer?.ops) ? answer.ops.slice(0, 30) : []) {
    if (!op || typeof op !== 'object') continue;
    const b = all.get(String(op.id ?? ''));
    if (!b) { refused.push({ op, why: `"${op.id}" is not one of the meeting's boxes` }); continue; }
    if (b.locked) { refused.push({ op, why: `${b.label} was written by a person: the meeting leaves it` }); continue; }
    if (op.op === 'merge') {
      const into = all.get(String(op.into ?? ''));
      if (!into || into.id === b.id) { refused.push({ op, why: `"${op.into}" is not another of the meeting's boxes` }); continue; }
      if (into.locked) { refused.push({ op, why: `${into.label} was written by a person: the meeting leaves it` }); continue; }
      if (isTopic(b) !== isTopic(into)) { refused.push({ op, why: 'a topic merges only into a topic, a point only into a point' }); continue; }
      const kids = under(b.id);
      if (kids.some((c) => c.locked)) { refused.push({ op, why: `${b.label} holds a box a person wrote` }); continue; }
      if (isTopic(b) && under(into.id).length + kids.length > MAX_POINTS) { refused.push({ op, why: `${into.label} would have more than ${MAX_POINTS} points: fold some first` }); continue; }
      if (!isTopic(b) && kids.length) { refused.push({ op, why: `${b.label} has boxes under it` }); continue; }
      const desc = withNotes(into.desc, carried(b));
      if (desc === null) { refused.push({ op, why: `${into.label}'s notes would be too long` }); continue; }
      into.desc = desc; put({ id: into.id, desc });
      absorb(b, into); merged.push({ id: b.id, into: into.id });
      continue;
    }
    if (op.op === 'fold') {
      const topic = all.get(b.under);
      if (isTopic(b) || !topic) { refused.push({ op, why: 'only a point under a topic folds into its notes' }); continue; }
      if (topic.locked) { refused.push({ op, why: `${topic.label} was written by a person: the meeting leaves it` }); continue; }
      if (under(b.id).length) { refused.push({ op, why: `${b.label} has boxes under it` }); continue; }
      if (b.kind === 'decision' || b.kind === 'action' || (b.kind === 'question' && /^Open\b/.test(b.sub || ''))) {
        refused.push({ op, why: `${b.label} is ${b.kind === 'decision' ? 'a decision' : b.kind === 'action' ? 'an action item' : 'an open question'}: it stays a box` }); continue;
      }
      const desc = withNotes(topic.desc, carried(b));
      if (desc === null) { refused.push({ op, why: `${topic.label}'s notes would be too long` }); continue; }
      topic.desc = desc; put({ id: topic.id, desc });
      absorb(b, topic); folded.push({ id: b.id, into: topic.id });
      continue;
    }
    refused.push({ op, why: 'op must be merge or fold' });
  }
  return { nodes, edges, remove, refused, merged, folded };
}
