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
  it('changes a box only by its id, and renames it that way; a name alone changes nothing', () => {
    const byId = plan({ boxes: [{ id: 'pricing', label: 'Plans and prices', sub: 'Three plans' }] });
    expect(byId.edit.nodes).toEqual([{ id: 'pricing', label: 'Plans and prices', sub: 'Three plans' }]);
    expect(byId.done).toEqual(['Changed Pricing (pricing)']);
    expect(() => plan({ boxes: [{ label: 'pricing', sub: 'Three plans' }] })).toThrow('Nothing changed. box "pricing": Pricing is already on the map; to change it, give its id (pricing)');
  });
  it('finds a box by its name to hang it under another, and to draw lines to it', () => {
    const r = plan({ boxes: [{ label: 'Invite email', under: 'Pricing' }], lines: [{ from: 'Launch', to: 'invite email', label: 'Sends it' }] });
    expect(r.edit.nodes).toEqual([]);
    expect(r.edit.edges).toEqual([{ from: 'pricing', to: 'email' }, { from: 'launch', to: 'email', label: 'Sends it' }]);
    expect(r.done[0]).toBe('Invite email hangs under Pricing');
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

describe('what Claude must give', () => {
  it('leaves out a new box with no second line, and says how to put it right', () => {
    const r = plan({ boxes: [{ label: 'Keep', sub: 'Stays' }, { label: 'Bare' }, { label: 'Blank', sub: '   ' }] });
    expect(r.edit.nodes.map((n) => n.id)).toEqual(['keep']);
    expect(r.skipped).toEqual([
      'box "Bare": a new box needs a second line (sub) that says what it is, in a few words',
      'box "Blank": a new box needs a second line (sub) that says what it is, in a few words',
    ]);
  });
  it('still changes a box already on the map without one, by its id', () => {
    expect(plan({ boxes: [{ id: 'email', state: 'todo' }] }).edit.nodes).toEqual([{ id: 'email', state: 'todo' }]);
    expect(plan({ boxes: [{ id: 'email', label: 'Invitation' }] }).skipped).toEqual([]);
  });
  it('leaves out a line with no label, and points at "under" for a box that only belongs under another', () => {
    const r = plan({ boxes: [{ label: 'Keep', sub: 'Stays' }], lines: [{ from: 'launch', to: 'email' }, { from: 'launch', to: 'email', label: '  ' }] });
    expect(r.edit.edges).toEqual([]);
    expect(r.skipped).toEqual(Array(2).fill('line Launch → Invite email: say what happens on it (label), or set "under" on Invite email if it only belongs under Launch'));
  });
  it('hangs a box that is already on the map under another with no words, through "under"', () => {
    const r = plan({ boxes: [{ id: 'email', under: 'launch' }] });
    expect(r.edit.edges).toEqual([{ from: 'launch', to: 'email' }]);
    expect(r.skipped).toEqual([]);
  });
  it('says nothing changed when a call held only a bare box or a bare line', () => {
    expect(() => plan({ boxes: [{ label: 'Bare' }] })).toThrow('Nothing changed. box "Bare": a new box needs a second line');
    expect(() => plan({ lines: [{ from: 'launch', to: 'email' }] })).toThrow('Nothing changed. line Launch → Invite email: say what happens on it');
  });
});

describe('boxes people wrote', () => {
  // Notes is Duy's; Plan is Claude's but Priyanka changed it since; Draft is Claude's own; Launch came from the code
  const map = (linked = true) => ({ ...state(), ...(linked ? { linked: [{ session: 's1', owner: 'Duy' }] } : {}),
    nodes: [...state().nodes, { id: 'notes', label: 'Notes', by: 'Duy' }, { id: 'plan', label: 'Plan', by: 'Claude', updatedBy: 'Priyanka' }, { id: 'draft', label: 'Draft', by: 'Claude', updatedBy: 'Claude' }] });
  const on = (/** @type {any} */ args, linked = true) => planChange(args, map(linked), 1_700_000_000_000);

  it('turns a change to a box a person made or changed into a proposal, and draws the rest', () => {
    const r = on({ boxes: [{ id: 'notes', notes: 'Rewritten by Claude' }, { id: 'plan', label: 'Plan B' }, { id: 'draft', sub: 'Second try' }] });
    expect(r.edit.nodes).toEqual([{ id: 'draft', sub: 'Second try' }]);
    expect(r.edit.propose).toEqual([{ id: 'notes', desc: 'Rewritten by Claude' }, { id: 'plan', label: 'Plan B' }]);
    expect(r.done).toEqual([
      'Proposed a change to Notes (notes): Duy made it, so it waits for Apply in Duy\'s Claude pane on the map',
      'Proposed a change to Plan (plan): Priyanka last changed it, so it waits for Apply in Duy\'s Claude pane on the map',
      'Changed Draft (draft)',
    ]);
  });
  it('says the proposal waits in the pane of the chat that asked, when that chat is linked', () => {
    const s = { ...map(), linked: [{ session: 's1', owner: 'Duy' }, { session: 's2', owner: 'Priyanka' }] };
    expect(planChange({ session: 's2', boxes: [{ id: 'notes', sub: 'x' }] }, s).done[0]).toMatch(/in Priyanka's Claude pane/);
    expect(planChange({ session: 'other', boxes: [{ id: 'notes', sub: 'x' }] }, s).done[0]).toMatch(/in Duy's Claude pane/);
  });
  it('greys out only a box Claude made; any other box gone is a proposal', () => {
    const r = on({ boxes: [{ id: 'draft', state: 'gone' }, { id: 'launch', state: 'gone' }, { id: 'launch', state: 'todo' }] });
    expect(r.edit.nodes).toEqual([{ id: 'draft', state: 'gone' }, { id: 'launch', state: 'todo' }]);
    expect(r.edit.propose).toEqual([{ id: 'launch', state: 'gone' }]);
    expect(r.done[1]).toBe('Proposed a change to Launch (launch): Claude did not make it, so it waits for Apply in Duy\'s Claude pane on the map');
  });
  it('leaves a person\'s box as it is when no chat is linked to hold the proposal, and says why', () => {
    expect(() => on({ boxes: [{ id: 'notes', notes: 'x' }] }, false)).toThrow(/Nothing changed\. box Notes \(notes\): Duy made it, so Claude changes it only through a proposal/);
  });
  it('never proposes moving a person\'s box to another area, but still opens it to someone asked a question on it', () => {
    const r = on({ boxes: [{ id: 'notes', sub: 'Money notes', area: 'billing' }], questions: [{ box: 'notes', for: 'Priyanka', ask: 'Right?' }] });
    expect(r.edit.propose).toEqual([{ id: 'notes', sub: 'Money notes' }]);
    expect(r.skipped).toEqual(['area "billing" on Notes: Duy made it, so only a person moves it to another area']);
    expect(r.edit.nodes).toEqual([{ id: 'notes', area: 'billing' }]);
  });
  it('still draws lines to and under a person\'s box', () => {
    const r = on({ boxes: [{ id: 'notes', under: 'launch' }], lines: [{ from: 'draft', to: 'Notes', label: 'Feeds' }] });
    expect(r.edit.propose).toBeUndefined();
    expect(r.edit.edges).toEqual([{ from: 'launch', to: 'notes' }, { from: 'draft', to: 'notes', label: 'Feeds' }]);
  });
});
