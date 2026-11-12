// A drawing made again keeps each box's identity. The agent names every box's id afresh each time it draws, so one
// repo comes back as `anur`, then as `repo`; taken as new boxes, each would sit on the map beside the box it
// replaces, with that box held for review as something code no longer finds. A box drawn again takes the id of
// the box it was, looked for in this order: the same id, the same repo (a platform box), the same id but for its
// punctuation (`team-live`, `teamlive`), the same name. Each earlier box is taken once, and a box that matches
// none keeps the id the agent gave it.

/** @typedef {{ id: string, name?: string, repo?: string }} Known a box as it was drawn before */

/** An id or a name as it is compared: its letters and digits. @param {unknown} s */
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @template {{ boxes: { id: string, name?: string, repo?: string }[], lines: { from: string, to: string }[] }} D
 * @param {Known[] | null | undefined} before the boxes of the drawing this one replaces
 * @param {D} drawn @returns {D} `drawn`, its boxes and its lines' ends under the ids they had
 */
export function keepIds(before, drawn) {
  if (!before?.length) return drawn;
  const now = new Set(drawn.boxes.map((b) => b.id)), was = new Set(before.map((o) => o.id));
  // an earlier box whose id the new drawing uses is that box already; the rest are free to be taken
  const free = before.filter((o) => !now.has(o.id)), fresh = drawn.boxes.filter((b) => !was.has(b.id));
  /** @type {((b: Known, o: Known) => boolean)[]} */
  const rules = [
    (b, o) => !!b.repo && b.repo === o.repo,
    (b, o) => !!key(b.id) && key(b.id) === key(o.id),
    (b, o) => !!key(b.name) && key(b.name) === key(o.name),
  ];
  /** @type {Map<string, string>} */
  const to = new Map(), used = new Set();
  for (const same of rules) for (const b of fresh) {
    if (to.has(b.id)) continue;
    const o = free.find((x) => !used.has(x) && same(b, x));
    if (o) { to.set(b.id, o.id); used.add(o); }
  }
  if (!to.size) return drawn;
  const id = (/** @type {string} */ x) => to.get(x) || x;
  return { ...drawn, boxes: drawn.boxes.map((b) => ({ ...b, id: id(b.id) })), lines: drawn.lines.map((l) => ({ ...l, from: id(l.from), to: id(l.to) })) };
}

/** What the agent is told of the drawing it replaces, so it draws the same thing as the same box. @param {Known[] | null | undefined} before */
export const earlierBoxes = (before) => before?.length
  ? `\nThis was drawn before. Where a box you draw is the same thing as one of these, give it the same id and name; draw a thing as one box or as several the way it was drawn here: ${before.slice(0, 60).map((b) => `${b.id} (${String(b.name || b.id).slice(0, 60)})`).join('; ')}.\n`
  : '';
