import { describe, expect, it } from 'vitest';

import { fileDates } from './file-dates.js';
import { FILE_SORTS, fileAge, orderFiles } from './page-file-info.js';

describe('document dates', () => {
  it('keeps creation fixed and counts content edits rather than presence or box date updates', () => {
    const state = /** @type {any} */ ({ title: 'Plan', nodes: [{ id: 'a', label: 'Audience' }], edges: [] });
    const update = fileDates(state, { created: 100, modified: 200 });
    state.people = [{ id: 'Duy' }]; state.nodes[0].updatedAt = '2026-11-19'; state.nodes[0].updatedBy = 'Duy';
    update(state, 300);
    expect([state.createdAt, state.modifiedAt]).toEqual([100, 200]);
    state.nodes[0].desc = 'A clearer plan'; update(state, 400);
    expect([state.createdAt, state.modifiedAt]).toEqual([100, 400]);
    const reopened = structuredClone(state), again = fileDates(reopened, { created: 500, modified: 600 });
    again(reopened, 700);
    expect([reopened.createdAt, reopened.modifiedAt]).toEqual([100, 400]);
    reopened.numbering = { format: 'decimal' }; again(reopened, 750);
    expect(reopened.modifiedAt).toBe(750);
    const reset = { title: 'Empty', nodes: [], edges: [] }; update(reset, 800);
    expect(reset).toMatchObject({ createdAt: 100, modifiedAt: 800 });
  });
});

describe('file orders', () => {
  const files = [{ name: 'b', title: 'Beta', at: 3, created: 1 }, { name: 'a', title: 'Alpha', at: 2, created: 3 }, { name: 'c', title: 'Gamma', at: 1, created: 2 }];
  it('offers all six orders, without changing the original list', () => {
    expect(FILE_SORTS.map(([id]) => orderFiles(files, id).map((f) => f.name).join(''))).toEqual(['abc', 'cba', 'bac', 'cab', 'acb', 'bca']);
    expect(files.map((f) => f.name)).toEqual(['b', 'a', 'c']);
  });
  it('puts unknown dates last in both directions, with names breaking ties', () => {
    const data = [...files, { name: 'missing', title: 'Missing' }];
    for (const key of ['created-asc', 'created-desc', 'modified-asc', 'modified-desc']) expect(orderFiles(data, key).at(-1)?.name).toBe('missing');
    expect(orderFiles([{ name: 'z', title: 'Note 10' }, { name: 'a', title: 'Note 2' }], 'name-asc').map((f) => f.name)).toEqual(['a', 'z']);
  });
  it('shows a readable age without negative times or an invented date', () => {
    const now = 10 * 86400000;
    expect([fileAge(now + 1000, now), fileAge(now - 120000, now), fileAge(now - 7200000, now), fileAge(now - 172800000, now), fileAge(0, now)]).toEqual(['now', '2m', '2h', '2d', '']);
  });
});
