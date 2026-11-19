// The local map listens while someone is looking at it. Reconnect reads the durable state again,
// including edits saved while this Mac was asleep. Pointer traffic never enters the edit queue.
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

/** @param {() => {url:string, headers:Record<string,string>} | null} endpoint
 * @param {() => void} changed @param {(message:any) => void} pointer */
export function cloudLive(endpoint, changed, pointer) {
  let retryMs = 1500, watching = false, key = '', writing = false;
  /** @type {any} */ let latest;
  /** @type {AbortController | null} */ let connection = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let retry;
  async function connect() {
    const target = endpoint();
    if (!watching || !target || connection) return;
    const ctrl = connection = new AbortController();
    try {
      const response = await fetch(target.url + '/live', { headers: target.headers, signal: ctrl.signal });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel(); retryMs = Math.min(60000, retryMs * 2); return;
      }
      retryMs = 1500;
      const lines = createInterface({ input: Readable.fromWeb(/** @type {any} */ (response.body)), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const message = JSON.parse(line.slice(6));
        if (message.kind === 'cursor') pointer(message);
        if (message.kind === 'ready') key = message.key;
        if (['ready','changed','access'].includes(message.kind)) changed();
      }
    } catch { /* the periodic sync still works while the live connection reconnects */ }
    finally {
      if (connection === ctrl) {
        connection = null; key = ''; latest = undefined; pointer(null);
        if (watching) retry = setTimeout(connect, retryMs);
      }
    }
  }
  /** @param {any} point */
  async function move(point) {
    const target = endpoint();
    if (!key || !target || !connection) return;
    latest = point;
    if (writing) return;
    writing = true;
    try {
      while (latest && key && connection) {
        const body = JSON.stringify(latest); latest = undefined;
        const response = await fetch(target.url + '/pointer', { method: 'POST', headers: { ...target.headers, 'content-type': 'application/json', 'x-pointer-key': key }, body, signal: connection.signal });
        await response.body?.cancel();
      }
    } catch { /* the next pointer position supersedes a dropped one */ }
    finally { writing = false; }
  }
  return { move,
    /** @param {boolean} active */
    watch(active) {
      watching = active; clearTimeout(retry);
      if (active && endpoint()) { void connect(); return; }
      connection?.abort(); connection = null; key = ''; latest = undefined; pointer(null);
    },
    refresh() { this.watch(watching); },
  };
}
