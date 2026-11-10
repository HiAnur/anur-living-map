import { describe, expect, it } from 'vitest';

import { diagramOf, diagramSaid } from './diagram.js';

// What a box opens into, read from untrusted input, and what a change does to it in plain words.
describe('a box\'s diagram', () => {
  it('keeps only the three kinds, items with a label, and cuts long words', () => {
    expect(diagramOf(null)).toBeNull();
    expect(diagramOf({ kind: 'pie', items: [{ label: 'A' }] })).toBeNull();
    expect(diagramOf({ kind: 'timeline', items: [{ when: 'May' }] })).toBeNull();
    const d = diagramOf({ kind: 'sequence', title: 'T'.repeat(100), items: [{ label: 'L'.repeat(100), from: 'Web', to: 'API', note: 'n', extra: 1 }, null, { label: 'Two' }] });
    expect(d).toEqual({ kind: 'sequence', title: 'T'.repeat(80), items: [{ label: 'L'.repeat(80), note: 'n', from: 'Web', to: 'API' }, { label: 'Two' }] });
    expect(diagramOf({ kind: 'venn', items: [{ label: 'X', in: ['a', '', 'b', 'c', 'd'] }] })?.items[0].in).toEqual(['a', 'b', 'c']);
    expect(diagramOf({ kind: 'timeline', items: Array.from({ length: 50 }, (_, i) => ({ label: `S${i}` })) })?.items).toHaveLength(40);
  });
  it('says what a change adds and takes out', () => {
    const was = { kind: 'timeline', items: [{ label: 'A' }, { label: 'B' }] };
    expect(diagramSaid(undefined, null)).toBe('no diagram');
    expect(diagramSaid(was, null)).toBe('take its timeline away');
    expect(diagramSaid(was, { kind: 'timeline', items: [{ label: 'A' }, { label: 'C' }, { label: 'D' }] })).toBe('its timeline: 2 moments added, 1 moment taken out');
    expect(diagramSaid(was, { kind: 'sequence', items: [{ label: 'A' }] })).toBe('a sequence of 1 step');
  });
});
