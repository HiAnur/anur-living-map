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
export const BOX_PEOPLE = BOX_FLAGS;
export const BOX_PROGRESS = ['0', '12.5', '25', '37.5', '50', '62.5', '75', '87.5', '100'];
export const BOX_PRIORITIES = [['one-thing', 'One thing'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];

const DESIGN_FIELDS = {
  format: NUMBER_FORMATS.map(([key]) => key),
  level: NUMBER_LEVELS.map(([key]) => key),
  align: BOX_ALIGNMENTS.map(([key]) => key),
  flag: ['', ...BOX_FLAGS],
  person: ['', ...BOX_PEOPLE],
  progress: ['', ...BOX_PROGRESS],
  priority: ['', ...BOX_PRIORITIES.map(([value]) => value)],
};

/** @param {string} field @param {unknown} value @returns {value is string} */
export function validDesignValue(field, value) {
  if (field === 'person' && personEmail(value)) return true;
  return typeof value === 'string' && Object.hasOwn(DESIGN_FIELDS, field) &&
    DESIGN_FIELDS[/** @type {keyof typeof DESIGN_FIELDS} */ (field)].includes(value);
}

/** @param {unknown} value @returns {value is string} */
export function personEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value);
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

/** Read older map-wide settings alongside per-group choices.
 * @param {any} record
 * @returns {{ format?: string, level?: string, groups: Record<string, string> }}
 */
export function savedNumbering(record) {
  const saved = savedDesign(record, ['format', 'level']);
  const groups = record?.groups;
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return { ...saved, groups: {} };
  return { ...saved, groups: Object.fromEntries(Object.entries(groups).filter(([key, value]) =>
    /^[pv]:[\w.:-]{1,200}$/.test(key) && validDesignValue('format', value))) };
}

/** The numbering tree follows the same first incoming branch as the displayed map.
 * @param {{ nodes: any[], lines: any[], centre: string | null }} graph
 */
export function numberingTree({ nodes, lines, centre }) {
  const parents = new Map(), depth = new Map(), out = new Map();
  const ids = new Set(nodes.map((n) => n.id)), root = centre || nodes[0]?.id;
  if (!root) return { parents, depth };
  for (const line of lines) {
    if (!ids.has(line.from) || !ids.has(line.to) || line.from === line.to) continue;
    out.set(line.from, [...(out.get(line.from) || []), line.to]);
  }
  const queue = [root];
  depth.set(root, 0);
  for (let i = 0; i < queue.length; i++) {
    const parent = queue[i];
    for (const child of out.get(parent) || []) {
      if (depth.has(child)) continue;
      parents.set(child, parent);
      depth.set(child, depth.get(parent) + 1);
      queue.push(child);
    }
  }
  return { parents, depth };
}

/** @param {any[]} nodes @param {Map<string, string>} parents @param {string} id @param {string} view */
export function numberingGroup(nodes, parents, id, view) {
  const parent = parents.get(id);
  if (!parent) return null;
  const owner = nodes.find((n) => n.id === parent);
  const key = owner?.virtual ? `v:${view}` : `p:${parent}`;
  return { key, parent, ids: nodes.filter((n) => !n.virtual && !n.proposed && parents.get(n.id) === parent).map((n) => n.id) };
}

/** @param {any} settings @param {string} key @param {number} depth */
export function numberingFormat(settings, key, depth) {
  const saved = savedNumbering(settings);
  if (Object.hasOwn(saved.groups, key)) return saved.groups[key];
  return saved.level === 'all' || depth <= Number(saved.level || '1') ? saved.format || 'none' : 'none';
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
 * @param {any} settings @param {string} [view]
 */
export function numberTopics(nodes, depth, parents, settings, view = 'system') {
  /** @type {Map<string, any[]>} */
  const siblings = new Map();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const d = depth.get(n.id) || 0, parent = parents.get(n.id);
    if (!parent || !d || n.virtual || n.proposed || n.hiddenRepo) continue;
    if (!siblings.has(parent)) siblings.set(parent, []);
    siblings.get(parent)?.push(n);
  }
  const labels = new Map();
  for (const [parent, list] of siblings) {
    const group = numberingGroup(nodes, parents, list[0].id, view);
    const format = group && numberingFormat(settings, group.key, depth.get(list[0].id) || 0);
    if (!format || format === 'none') continue;
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

/** @param {string} color @param {string} [name] */
export function personIcon(color, name = color) {
  if (personEmail(color)) {
    const safe = color.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const title = name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const initial = ([...name.trim()][0] || color[0]).toUpperCase().replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const index = [...color.toLowerCase()].reduce((sum, c) => sum + c.charCodeAt(0), 0) % BOX_FLAGS.length;
    return `<span class="design-mark person named" data-flag="${BOX_FLAGS[index]}" role="img" aria-label="${safe}" title="${title}">${initial}</span>`;
  }
  if (!BOX_PEOPLE.includes(color)) return '';
  return `<span class="design-mark person" data-flag="${color}" role="img" aria-label="${color} person" title="${color} person"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="2.5" fill="currentColor"/><path d="M3.5 12c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5v1h-9z" fill="currentColor"/></svg></span>`;
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

/** @param {string} value */
export function priorityIcon(value) {
  const priority = BOX_PRIORITIES.find(([key]) => key === value);
  if (!priority) return '';
  const label = `${priority[1]} priority`;
  return `<span class="design-mark priority" data-priority="${value}" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg></span>`;
}
