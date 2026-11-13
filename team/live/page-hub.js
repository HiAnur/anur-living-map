// The centre of a map: its start box drawn as a small empty circle, with the boxes right under it (its main topics)
// in orange around it, so a map's main topics read at a glance. The map's name is already at the top of the page,
// so the circle carries none. project.js lays a map out with the same circle, so Tidy up and a new box's place agree
// with what the page draws. A page module (see page-modules.js).

/** How wide and how tall the circle is, in map pixels. */
export const HUB_SIZE = 28;

/**
 * Whether a box is drawn as the centre circle: the start box of a map's top level (on a system map, the centre code
 * adds for the whole system, system-centre.js). Not inside a box, where the start is one of that box's parts; and not
 * a box that holds something the circle has no room to show (boxes inside it, a diagram, an Action).
 * @param {any} n the box
 * @param {{ start: string | null | undefined, top: boolean }} map where the map starts, and whether this is its top level
 */
export function isHub(n, { start, top }) {
  return !!n && top && !!start && n.id === start && !n.proposed && !n.inside && !n.diagram && !n.action;
}

/**
 * The level a click on the circle shows: only the main topics, or, when only they show already, every box again.
 * @param {number} shown the level showing now @param {number} deepest the deepest level the map has
 */
export function hubLevel(shown, deepest) {
  return shown === 1 && deepest > 1 ? deepest : 1;
}

/**
 * What the circle says on hover, where a box would show its name: the map's start box's name, its description, and
 * what a click does.
 * @param {string} name @param {string} summary @param {boolean} topicsOnly whether only the main topics show now
 */
export function hubHint(name, summary, topicsOnly) {
  return [[name, summary].filter(Boolean).join('\n'), topicsOnly ? 'Click to show every box' : 'Click to show only the main topics'].join('\n\n');
}
