import { describe, expect, it } from 'vitest';

import { asksNothing, planChange } from './draw.js';

// What a living_map_change call becomes, on a small map: the edit sent to the map, what the reply says was done,
// and what it says was left out and why.
const state = () => ({
  title: 'Launch',
  people: [{ id: 'Duy', role: 'Admin', sees: 'all' }, { id: 'Priyanka', role: 'CFO', sees: 'billing' }],
  nodes: [{ id: 'launch', label: 'Launch', sub: 'Ship the pilot' }, { id: 'pricing', label: 'Pricing', area: 'billing' }, { id: 'email', label: 'Invite email' }],
  edges: [{ from: 'launch', to: 'pricing' }],
});
const plan = (args) => planChange(args, state(), 1_700_000_000_000);

describe('boxes', () => {
  it('adds a new box under another, with an id from its name, marked as Claude\'s', () => {
    const r = plan({ boxes: [{ label: 'Pilot Users', sub: 'The first twenty', notes: 'Who they are', state: 'todo', area: 'billing', under: 'Launch' }] });
    expect(r.edit.nodes).toEqual([{ id: 'pilot-users', label: 'Pilot Users', sub: 'The first twenty', desc: 'Who they are', state: 'todo', area: 'billing', by: 'Claude' }]);
    expect(r.edit.edges).toEqual([{ from: 'launch', to: 'pilot-users' }]);
    expect(r.done).toEqual(['Added Pilot Users (pilot-users)', '  under Launch']);
    expect(r.skipped).toEqual([]);
    expect(r.edit.note).toBe('Added Pilot Users (pilot-users)');
  });
  it('updates a box found by its name without renaming it, and renames one given by id', () => {
    const byName = plan({ boxes: [{ label: 'pricing', sub: 'Three plans' }] });
    expect(byName.edit.nodes).toEqual([{ id: 'pricing', sub: 'Three plans' }]);
    expect(byName.done).toEqual(['Changed Pricing (pricing)']);
    const byId = plan({ boxes: [{ id: 'pricing', label: 'Plans and prices' }] });
    expect(byId.edit.nodes).toEqual([{ id: 'pricing', label: 'Plans and prices' }]);
  });
  it('gives a second box of the same new name its own id', () => {
    const r = plan({ boxes: [{ label: 'Risk', sub: 'One' }, { id: 'launch', label: 'Launch day', sub: 'x' }, { label: 'Launch!', sub: 'Two' }] });
    expect(r.edit.nodes.map((n) => n.id)).toEqual(['risk', 'launch', 'launch-2']);
  });
  it('leaves out a box with no name, a state or diagram it does not know, and a parent that is not there', () => {
    const r = plan({ boxes: [{ sub: 'no name' }, { label: 'Odd', sub: 's', state: 'done', diagram: { kind: 'pie', items: [] }, under: 'Nowhere' }] });
    expect(r.edit.nodes).toEqual([{ id: 'odd', label: 'Odd', sub: 's', diagram: undefined, by: 'Claude' }]);
    expect(r.skipped).toEqual(['a box with no name', 'state "done" on Odd: use new, todo, assumed-gone, gone', 'diagram "pie" on Odd: use timeline, sequence, venn', '"Nowhere" above Odd: no such box']);
  });
});

describe('lines', () => {
  it('draws a line between boxes named by id or by name, in this change or on the map', () => {
    const r = plan({ boxes: [{ label: 'Stripe', sub: 'Takes the payment' }], lines: [{ from: 'Pricing', to: 'stripe', label: 'Charges the card' }] });
    expect(r.edit.edges).toEqual([{ from: 'pricing', to: 'stripe', label: 'Charges the card' }]);
    expect(r.done.at(-1)).toBe('Line Pricing → Stripe (Charges the card)');
  });
  it('leaves out a line to a box that is not on the map, and takes lines off by their ends', () => {
    const r = plan({ lines: [{ from: 'launch', to: 'nowhere', label: 'x' }], remove_lines: [{ from: 'Launch', to: 'Pricing' }, { from: 'launch', to: 'gone' }] });
    expect(r.edit.edges).toEqual([]);
    expect(r.edit.unlink).toEqual([{ from: 'launch', to: 'pricing' }]);
    expect(r.skipped).toEqual(['line launch → nowhere: nowhere is not on the map', 'remove line launch → gone: gone is not on the map']);
  });
});

describe('questions, memory and the rest', () => {
  it('asks a teammate on a box, moving the box into their area when they could not see it', () => {
    const r = plan({ questions: [{ box: 'email', for: 'priyanka', ask: 'Send it Monday?', why: 'Billing starts then', yes: 'Send', no: 'Wait' }] });
    expect(r.edit.calls).toEqual([{ id: 'qloyw3v280', node: 'email', for: 'Priyanka', from: 'Claude', kind: 'Money call', status: 'open', ask: 'Send it Monday?', text: 'Send it Monday?', plain: 'Billing starts then', yes: 'Send', no: 'Wait' }]);
    expect(r.edit.nodes).toEqual([{ id: 'email', area: 'billing' }]);
    expect(r.done).toEqual(['  Invite email joins area "billing" so Priyanka can see it', 'Question for Priyanka on Invite email: Send it Monday?']);
  });
  it('leaves out a question with no words, no such box or no such person', () => {
    const r = plan({ boxes: [{ label: 'Keep', sub: 's' }], questions: [{ box: 'email', for: 'Duy' }, { box: 'nope', for: 'Duy', ask: 'a?' }, { box: 'email', for: 'Sam', ask: 'b?' }] });
    expect(r.skipped).toEqual(['question "?": no question', 'question "a?": no box "nope"', 'question "b?": no one called "Sam" (Duy, Priyanka)']);
  });
  it('keeps a memory or an instruction, for a box or the whole map', () => {
    const r = plan({ remember: [{ kind: 'instruction', box: 'Pricing', text: 'Prices are in USD' }, { kind: 'memory', text: 'Pilot is 20 users' }, { kind: 'memory', box: 'nope', text: 'x' }, { kind: 'memory' }] });
    expect(r.edit.memory).toEqual([{ kind: 'instruction', box: 'pricing', text: 'Prices are in USD' }, { kind: 'memory', box: null, text: 'Pilot is 20 users' }]);
    expect(r.skipped).toEqual(['remember "x": no box "nope"', 'remember "?": no words']);
  });
  it('sets the box the map starts from, lays it out again, and uses the note it is given', () => {
    const r = plan({ start: 'Launch', tidy: true, note: 'Reorganized' });
    expect(r.edit).toEqual({ note: 'Reorganized', nodes: [], edges: [], calls: [], memory: [], unlink: [], tidy: true, start: 'launch' });
    expect(plan({ boxes: [{ label: 'A', sub: 's' }], start: 'nope' }).skipped).toEqual(['start from "nope": no such box']);
  });
  it('says nothing changed when everything asked for was left out, and knows a call that asks for nothing', () => {
    expect(() => plan({ lines: [{ from: 'a', to: 'b', label: 'x' }] })).toThrow('Nothing changed. line a → b: a is not on the map');
    expect(asksNothing({})).toBe(true);
    expect(asksNothing({ boxes: [], tidy: false })).toBe(true);
    for (const args of [{ boxes: [{}] }, { tidy: true }, { start: 'x' }, { remove_lines: [{}] }]) expect(asksNothing(args)).toBe(false);
  });
});
