// The words a name is made of, as code compares two names: lower case, camelCase and snake_case split apart, a plural
// taken back to its singular, and words too short or too common to tell one thing from another left out. Auto plan
// uses them to catch a box it would add twice under another name, and system maps to hold a box's name to its facts.

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'about', 'our', 'your', 'their', 'its', 'this', 'that', 'these', 'those',
  'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'all', 'any', 'each', 'per', 'via', 'new', 'out', 'off', 'then', 'than', 'when', 'what',
  'who', 'how', 'why', 'get', 'set', 'use']);

/** @param {string} w */
const singular = (w) => w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;

/** The meaningful words in a name or any text. @param {unknown} text @returns {Set<string>} */
export function wordsOf(text) {
  const split = String(text ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase();
  /** @type {Set<string>} */
  const out = new Set();
  // a number tells things apart however short it is: "Pilot 3" is not "Pilot 4"
  for (const w of split.split(/[^a-z0-9]+/)) if ((w.length >= 3 || /^\d+$/.test(w)) && !STOP.has(w)) out.add(singular(w));
  return out;
}

/** How many words two sets share. @param {Set<string>} a @param {Set<string>} b */
export const shared = (a, b) => [...a].filter((w) => b.has(w)).length;

/**
 * Whether two names say the same thing in other words: the same words, or at least two shared that make up two
 * thirds of the shorter name ("Email Dan the pricing" and "Send Dan pricing options").
 * @param {unknown} a @param {unknown} b
 */
export function sameThing(a, b) {
  const x = wordsOf(a), y = wordsOf(b), n = shared(x, y);
  if (!n) return false;
  if (n === x.size && n === y.size) return true;
  return n >= 2 && n / Math.min(x.size, y.size) >= 2 / 3;
}
