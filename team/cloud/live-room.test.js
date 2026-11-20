import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';

import { liveRooms } from './live-room.js';

it('shows a stationary peer on join and ignores late positions after a move or exit', () => {
  const rooms = liveRooms();
  const join = () => {
    /** @type {any[]} */ const events = [];
    const channel = Object.assign(new EventEmitter(), {
      writeHead() {},
      write(/** @type {string} */ data) { events.push(JSON.parse(data.slice(6))); },
    });
    rooms.join('sample', channel, 'Guest');
    return { events, key: events[0].key, close: () => channel.emit('close') };
  };
  const a = join();
  const move = (/** @type {number} */ x, /** @type {number} */ sequence) => rooms.cursor('sample', a.key, { x, y: 1, view: 'system', sequence });
  move(20, 2);
  const b = join();
  try {
    expect(b.events.at(-1)).toMatchObject({ kind: 'cursor', x: 20 });
    move(10, 1);
    expect(b.events).toHaveLength(2);
    rooms.cursor('sample', a.key, { x: null, sequence: 4 });
    move(30, 3);
    expect(b.events).toHaveLength(3);
    expect(b.events.at(-1).x).toBeNull();
    expect(rooms.cursor('sample', a.key, { x: 9, y: 3, view: 'system' })).toBe(true);
    expect(b.events.at(-1).x).toBe(9);
  } finally { a.close(); b.close(); }
});
