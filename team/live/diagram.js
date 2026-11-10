// What a box opens into on a double click: a timeline (items with when), a sequence (items from → to),
// or a Venn (items in 1 to 3 groups); null when there is nothing to draw
/** @param {any} d */
export function diagramOf(d) {
  if (!d || !['timeline', 'sequence', 'venn'].includes(d.kind)) return null;
  const s = (/** @type {any} */ t, /** @type {any} */ n) => String(t ?? '').slice(0, n);
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 40).filter((/** @type {any} */ m) => m?.label).map((/** @type {any} */ m) => ({ label: s(m.label, 80),
    ...(m.when ? { when: s(m.when, 30) } : {}), ...(m.note ? { note: s(m.note, 120) } : {}),
    ...(m.from && m.to ? { from: s(m.from, 40), to: s(m.to, 40) } : {}),
    ...(Array.isArray(m.in) ? { in: m.in.map((/** @type {any} */ g) => s(g, 40)).filter(Boolean).slice(0, 3) } : {}) }));
  return items.length ? { kind: d.kind, ...(d.title ? { title: s(d.title, 80) } : {}), items } : null;
}
// what a change does to a box's diagram, in plain words: how many parts come and how many go
/** @param {any} was @param {any} now */
export function diagramSaid(was, now) {
  if (!now) return was ? `take its ${was.kind} away` : 'no diagram';
  const key = (/** @type {any} */ m) => JSON.stringify([m.when, m.label, m.note, m.from, m.to, (m.in || []).slice().sort()]);
  const left = (was?.kind === now.kind ? was.items : []).map(key); let added = 0;
  for (const m of now.items) { const i = left.indexOf(key(m)); if (i >= 0) left.splice(i, 1); else added++; }
  const part = /** @type {Record<string, any>} */ ({ timeline: 'moment', sequence: 'step', venn: 'item' })[now.kind], n = (/** @type {any} */ k) => `${k} ${part}${k === 1 ? '' : 's'}`;
  return was?.kind === now.kind ? `its ${now.kind}: ${n(added)} added, ${n(left.length)} taken out` : `a ${now.kind} of ${n(now.items.length)}`;
}
