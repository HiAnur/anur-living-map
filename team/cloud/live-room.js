// One ephemeral room per open map on the single cloud instance. Only revision notices and
// pointers travel here. Every durable read and edit still goes through the map's access checks.
import crypto from 'node:crypto';

export function liveRooms() {
  /** @type {Map<string, Set<any>>} */
  const rooms = new Map();
  /** @type {Map<string, any>} */
  const writers = new Map();
  /** @param {any} peer @param {any} value */
  function send(peer, value) {
    if (peer.res.writableEnded || peer.res.destroyed) return;
    if (peer.res.writableLength > 65536) { peer.res.destroy(); return; }
    peer.res.write('data: ' + JSON.stringify(value) + '\n\n');
  }
  /** @param {string} id @param {any} message @param {any} [except] */
  function broadcast(id, message, except) {
    for (const peer of rooms.get(id) || []) if (peer !== except) send(peer, message);
  }
  return {
    /** @param {string} id @param {any} res @param {string} name */
    join(id, res, name) {
      const room = rooms.get(id) || new Set(), key = crypto.randomBytes(24).toString('hex');
      const peer = { res, id, key, name, sequence: 0, pointer: crypto.randomUUID() };
      room.add(peer); rooms.set(id, room); writers.set(key, peer);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      send(peer, { kind: 'ready', key, orderedPointers: true });
      for (const other of room) if (other.position) send(peer, other.position);
      const expire = setTimeout(() => res.end(), 55000);
      const beat = setInterval(() => res.write(': keepalive\n\n'), 15000);
      res.once('close', () => {
        clearTimeout(expire); clearInterval(beat); writers.delete(key); room.delete(peer);
        if (!room.size && rooms.get(id) === room) rooms.delete(id);
        broadcast(id, { kind: 'cursor', pointer: peer.pointer, x: null });
      });
    },
    /** @param {string} id @param {any} key */
    hasWriter(id, key) { return writers.get(key)?.id === id; },
    /** @param {string} id @param {any} key @param {any} a */
    cursor(id, key, a) {
      const peer = writers.get(key);
      if (!peer || peer.id !== id) return false;
      if (a?.x !== null && !(Number.isFinite(a?.x) && Number.isFinite(a.y) && Math.abs(a.x) <= 1e7 && Math.abs(a.y) <= 1e7 && typeof a.view === 'string' && /^[\w:.-]{1,160}$/.test(a.view))) return false;
      // A late position, including one sent before the pointer left the canvas, must never rewind it.
      if (a.sequence !== undefined) {
        if (!Number.isSafeInteger(a.sequence) || a.sequence < 1) return false;
        if (a.sequence <= peer.sequence) return true;
        peer.sequence = a.sequence;
      }
      const anchor = typeof a.anchor === 'string' && /^[\w.@-]{1,120}$/.test(a.anchor) ? a.anchor : undefined;
      const position = { kind: 'cursor', pointer: peer.pointer, anchor, name: peer.name, x: a.x, y: a.x === null ? null : a.y, view: a.x === null ? '' : a.view };
      peer.position = a.x === null ? null : position;
      broadcast(id, position, peer);
      return true;
    },
    /** @param {string} id */
    changed(id) { broadcast(id, { kind: 'changed' }); },
    /** @param {string} id */
    revoke(id) { for (const peer of rooms.get(id) || []) { writers.delete(peer.key); send(peer, { kind: 'access' }); peer.res.end(); } },
  };
}
