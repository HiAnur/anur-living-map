import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { boxObject, gaps, lineId, mapObjects, memoryObject } from './objects.js';

// A stored map read as objects that all have an id, a type, a name and dates: what each stored field becomes,
// which lines are the map's tree and which are flows, and what is reported as missing.
const topicMap = () => ({
  title: 'Launch', start: 'launch',
  nodes: [
    { id: 'launch', label: 'Launch', sub: 'Ship the pilot', desc: 'Notes on the launch', x: 0, y: 0, createdAt: 1000, updatedAt: 2000, updatedBy: 'Duy' },
    { id: 'pricing', label: 'Pricing', x: 210, y: 0, w: 180, area: 'billing', state: 'todo', createdAt: 1500, updatedAt: 1500 },
    { id: 'email', label: ' Send the invite ', boxType: 'action', task: { goal: 'Invite the pilot users' }, action: { stage: 'draft', by: 'Duy' }, x: 210, y: 85 },
    { id: 'customer', label: 'Customer', kind: 'actor' },
    { id: 'stripe', label: 'Stripe', kind: 'ext', icon: 'db' },
  ],
  edges: [
    { from: 'launch', to: 'pricing' }, { from: 'launch', to: 'email' }, { from: 'launch', to: 'customer' }, { from: 'launch', to: 'stripe' },
    { from: 'pricing', to: 'stripe', label: 'Charges the card' }, { from: 'customer', to: 'email', state: 'new' },
  ],
  memory: [
    { id: 'm1', kind: 'instruction', box: 'pricing', text: 'Prices are in USD', by: 'Duy', at: 3000 },
    { id: 'm2', kind: 'memory', box: null, text: 'The pilot is 20 users', by: 'Priyanka', at: 4000 },
  ],
});

describe('a stored box as an object', () => {
  it('has an id, one type, a name, a description, notes, dates and a place', () => {
    const [launch, pricing] = topicMap().nodes.map(boxObject);
    expect(launch).toEqual({ id: 'launch', type: 'topic', name: 'Launch', description: 'Ship the pilot', notes: 'Notes on the launch',
      createdAt: 1000, updatedAt: 2000, updatedBy: 'Duy', place: { x: 0, y: 0 } });
    expect(pricing).toEqual({ id: 'pricing', type: 'topic', name: 'Pricing', description: '', notes: '', createdAt: 1500, updatedAt: 1500,
      state: 'todo', area: 'billing', place: { x: 210, y: 0, w: 180 } });
  });
  it('takes its type from what are two fields today: an Action first, then an actor or an outside system', () => {
    expect(topicMap().nodes.map((n) => boxObject(n).type)).toEqual(['topic', 'topic', 'action', 'actor', 'external']);
    expect(boxObject({ id: 'x', label: 'X', boxType: 'action', kind: 'actor' }).type).toBe('action');
  });
  it('carries a plan and a run only when it is an Action', () => {
    const email = boxObject(topicMap().nodes[2]);
    expect(email).toMatchObject({ type: 'action', name: 'Send the invite', task: { goal: 'Invite the pilot users' }, action: { stage: 'draft', by: 'Duy' } });
    expect(boxObject({ id: 'a', label: 'A', boxType: 'action' })).not.toHaveProperty('action');
    // a topic that somehow holds Action data does not pass it on
    expect(boxObject({ id: 't', label: 'T', action: { stage: 'draft' }, task: {} })).not.toHaveProperty('action');
    expect(boxObject({ id: 't', label: 'T', action: { stage: 'draft' }, task: {} })).not.toHaveProperty('task');
  });
  it('has no place until it has been given one, and no dates when none were kept', () => {
    expect(boxObject({ id: 'n', label: 'New' })).toEqual({ id: 'n', type: 'topic', name: 'New', description: '', notes: '', createdAt: null, updatedAt: null });
    expect(boxObject({ id: 'n', label: 'New', createdAt: 0, updatedAt: 'yesterday' })).toMatchObject({ createdAt: null, updatedAt: null });
  });
  it('reads the map a box opens into the same way', () => {
    const outer = boxObject({ id: 'o', label: 'Outer', inside: { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] } });
    expect(outer.inside?.boxes.map((b) => b.id)).toEqual(['a', 'b']);
    expect(outer.inside?.lines).toEqual([{ id: 'a>b', type: 'contains', name: '', from: 'a', to: 'b', createdAt: null, updatedAt: null }]);
  });
});

describe('a stored line as an object', () => {
  it('gets an id from the two boxes it joins', () => {
    expect(lineId({ from: 'launch', to: 'pricing' })).toBe('launch>pricing');
    const ids = mapObjects(topicMap()).lines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('is "contains" when it is part of the map\'s tree, and a "flow" otherwise', () => {
    const lines = Object.fromEntries(mapObjects(topicMap()).lines.map((l) => [l.id, l]));
    for (const id of ['launch>pricing', 'launch>email', 'launch>customer', 'launch>stripe']) expect(lines[id].type).toBe('contains');
    expect(lines['pricing>stripe']).toEqual({ id: 'pricing>stripe', type: 'flow', name: 'Charges the card', from: 'pricing', to: 'stripe', createdAt: null, updatedAt: null });
    expect(lines['customer>email']).toMatchObject({ type: 'flow', name: '', state: 'new' });
  });
  it('is a flow everywhere on a map that is not one tree', () => {
    const seed = JSON.parse(fs.readFileSync(new URL('./seed.json', import.meta.url), 'utf8'));
    expect(new Set(mapObjects(seed).lines.map((l) => l.type))).toEqual(new Set(['flow']));
  });
});

describe('a stored memory as an object', () => {
  it('is named by its text, typed by its kind, and dated by when it was kept', () => {
    expect(mapObjects(topicMap()).memories).toEqual([
      { id: 'm1', type: 'instruction', name: 'Prices are in USD', box: 'pricing', createdAt: 3000, updatedAt: 3000, createdBy: 'Duy' },
      { id: 'm2', type: 'memory', name: 'The pilot is 20 users', box: null, createdAt: 4000, updatedAt: 4000, createdBy: 'Priyanka' },
    ]);
    expect(memoryObject({ id: 7, kind: 'other', text: 'x' })).toMatchObject({ id: '7', type: 'memory', box: null, createdAt: null });
  });
});

describe('what a map still lacks', () => {
  it('lists a box with no name, description or dates, a flow with no name, and never a tree line', () => {
    const found = gaps(mapObjects(topicMap())).map((g) => `${g.kind} ${g.id}: ${g.lacks}`);
    expect(found).toEqual([
      'box pricing: description',
      'box email: description', 'box email: dates',
      'box customer: description', 'box customer: dates',
      'box stripe: description', 'box stripe: dates',
      'line customer>email: name',
    ]);
  });
  it('looks inside the maps boxes open into, and at memories', () => {
    const objects = mapObjects({ nodes: [{ id: 'o', label: '', sub: 's', createdAt: 1, inside: { nodes: [{ id: 'a', label: 'A', sub: 's', createdAt: 1 }, { id: 'b', label: 'B' }], edges: [] } }], edges: [], memory: [{ id: 'm', kind: 'memory', text: '' }] });
    expect(gaps(objects).map((g) => `${g.kind} ${g.id}: ${g.lacks}`)).toEqual(['box o: name', 'box b: description', 'box b: dates', 'memory m: name', 'memory m: dates']);
  });
  it('changes nothing in the map it reads', () => {
    const state = topicMap(), before = JSON.stringify(state);
    gaps(mapObjects(state));
    expect(JSON.stringify(state)).toBe(before);
  });
});
