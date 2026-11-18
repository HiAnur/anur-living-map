/** Values allowed in saved maps and shown by the Design panel. */
export const NUMBER_FORMATS = [
  ['none', 'None'], ['decimal', '1, 2, 3'], ['roman', 'I, II, III'], ['lower-roman', 'i, ii, iii'],
  ['letters', 'A, B, C'], ['lower-letters', 'a, b, c'], ['parentheses', '(1), (2), (3)'],
];
export const NUMBER_LEVELS = [
  ['1', 'Level 1'], ['2', 'Levels 1–2'], ['3', 'Levels 1–3'], ['4', 'Levels 1–4'], ['all', 'All levels'],
];
export const BOX_ALIGNMENTS = [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']];
export const BOX_FLAGS = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple'];
export const BOX_PROGRESS = ['0', '12.5', '25', '37.5', '50', '62.5', '75', '87.5', '100'];

const DESIGN_FIELDS = {
  format: NUMBER_FORMATS.map(([key]) => key),
  level: NUMBER_LEVELS.map(([key]) => key),
  align: BOX_ALIGNMENTS.map(([key]) => key),
  flag: ['', ...BOX_FLAGS],
  progress: ['', ...BOX_PROGRESS],
};

/** @param {string} field @param {unknown} value @returns {value is string} */
export function validDesignValue(field, value) {
  return typeof value === 'string' && Object.hasOwn(DESIGN_FIELDS, field) &&
    DESIGN_FIELDS[/** @type {keyof typeof DESIGN_FIELDS} */ (field)].includes(value);
}

/** @param {unknown} record @param {string[]} fields */
export function savedDesign(record, fields) {
  if (!record || typeof record !== 'object') return {};
  const values = /** @type {Record<string, unknown>} */ (record);
  return Object.fromEntries(fields.flatMap((field) => {
    const value = field === 'format' && values[field] === 'circled' ? 'decimal' : values[field];
    return validDesignValue(field, value) && value ? [[field, value]] : [];
  }));
}

/** @param {number} n @param {string} format */
export function formatTopicNumber(n, format) {
  if (format === 'parentheses') return `(${n})`;
  if (format === 'letters' || format === 'lower-letters') {
    let letters = '';
    while (n > 0) { n--; letters = String.fromCharCode(65 + n % 26) + letters; n = Math.floor(n / 26); }
    return format === 'letters' ? letters : letters.toLowerCase();
  }
  if ((format === 'roman' || format === 'lower-roman') && n < 4000) {
    let roman = '';
    for (const [value, part] of /** @type {[number, string][]} */ ([[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']])) {
      roman += part.repeat(Math.floor(n / value)); n %= value;
    }
    return format === 'roman' ? roman : roman.toLowerCase();
  }
  return String(n);
}

/** Number siblings in their canvas order before folding so the labels stay steady.
 * @param {any[]} nodes @param {Map<string, number>} depth @param {Map<string, string>} parents
 * @param {{ format?: string, level?: string }} settings
 */
export function numberTopics(nodes, depth, parents, { format = 'none', level = '1' }) {
  /** @type {Map<string, any[]>} */
  const siblings = new Map();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const d = depth.get(n.id) || 0, parent = parents.get(n.id);
    if (!parent || !d || (level !== 'all' && d > Number(level)) || n.virtual || n.proposed || n.hiddenRepo) continue;
    if (!siblings.has(parent)) siblings.set(parent, []);
    siblings.get(parent)?.push(n);
  }
  const labels = new Map();
  for (const [parent, list] of siblings) {
    const x = byId.get(parent)?.x || 0;
    list.sort((a, b) => Number(a.x < x) - Number(b.x < x) || a.y - b.y);
    const punctuation = format === 'parentheses' ? '' : '.';
    list.forEach((n, i) => labels.set(n.id, formatTopicNumber(i + 1, format) + punctuation));
  }
  return labels;
}

/** @param {string} color */
export function flagIcon(color) {
  if (!BOX_FLAGS.includes(color)) return '';
  return `<span class="design-mark flag" data-flag="${color}" role="img" aria-label="${color} flag" title="${color} flag"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 13V3m0 .5c3-2 4 2 8 0V9c-4 2-5-2-8 0" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg></span>`;
}

/** @param {string} value */
export function progressIcon(value) {
  if (!BOX_PROGRESS.includes(value)) return '';
  const label = `${value}% progress`, complete = value === '100';
  const track = `<circle cx="8" cy="8" r="7" fill="${complete ? 'currentColor' : 'var(--box)'}" stroke="currentColor" stroke-width="1.5"/>`;
  const mark = complete
    ? '<path d="m4.5 8 2.3 2.3 5-5" fill="none" stroke="var(--box)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
    : value === '0'
      ? '<path d="M6 4.5v7l5-3.5z" fill="currentColor"/>'
      : `<circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="6.4" pathLength="100" stroke-dasharray="${value} 100" transform="rotate(-90 8 8)"/>`;
  return `<span class="design-mark progress" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 16 16" aria-hidden="true">${track}${mark}</svg></span>`;
}
