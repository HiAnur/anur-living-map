// The map's listener for Pi chats. Claude Code wakes a chat when a background command ends, so there the
// listener is wait.js run in the background; Pi has no such wake, so this extension listens instead. Loaded from
// ~/.pi/agent/extensions/anur-living-map.js (open-map.sh or connectTools adds that one-line file), it gives the chat a
// `living_map_listen` tool. Called with a map's name, it waits on that map for anything that belongs to this chat
// (an answer to its question, a change applied, words typed in the map's pane) and posts it into the chat, which
// starts a turn, then waits again, until the chat ends.

const PORT = process.env.LIVING_MAP_PORT || '4323';
// a map's address is its folder's name in lowercase letters, digits and dashes, as the server names it
const nameOf = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const pause = (/** @type {number} */ ms) => new Promise((ok) => setTimeout(ok, ms));

/** @param {any} pi the ExtensionAPI */
export default function livingMap(pi) {
  /** @type {Map<string, AbortController>} the maps this chat listens to, by name */
  const listening = new Map();

  /** @param {string} map @param {string} session @param {AbortSignal} signal */
  async function listen(map, session, signal) {
    const base = `http://localhost:${PORT}${map ? `/${map}` : ''}`;
    let down = 0;
    while (!signal.aborted) {
      try {
        const r = await fetch(`${base}/api/wait?session=${encodeURIComponent(session)}`, { signal });
        const text = (await r.text()).trim();
        down = 0;
        if (r.ok && text) pi.sendMessage({ customType: 'living-map', content: `FROM YOUR LIVING MAP (${base}/):\n${text}`, display: true },
          { triggerTurn: true, deliverAs: 'followUp' });
        else if (!r.ok) await pause(2000);
      } catch {
        if (signal.aborted) return;
        // the server restarts on its own after an update; a minute without it means it is gone
        if (++down > 30) {
          pi.sendMessage({ customType: 'living-map', content: `The Living Map server at ${base}/ is not running, so the listener stopped. Open the map again with /skill:anur-living-map.`, display: true }, { triggerTurn: false });
          listening.delete(map); return;
        }
        await pause(2000);
      }
    }
  }

  pi.registerTool({
    name: 'living_map_listen',
    label: 'Listen to the map',
    description: 'Listen to a Living Map for this chat: what people do on it that belongs to this chat (answers, applied changes, words typed in the map\'s pane) arrives as a message starting FROM YOUR LIVING MAP. Call once per map; it keeps listening until the chat ends.',
    parameters: { type: 'object', required: ['map'], properties: { map: { type: 'string', description: 'The map\'s name: this repo\'s folder name for its own map, or the name in its address (gtm for localhost:4323/gtm/).' } } },
    async execute(/** @type {string} */ _id, /** @type {{ map: string }} */ { map }, /** @type {unknown} */ _signal, /** @type {unknown} */ _update, /** @type {any} */ ctx) {
      const name = nameOf(String(map || '')), session = ctx.sessionManager.getSessionId();
      if (listening.has(name)) return { content: [{ type: 'text', text: `Already listening to ${name}.` }], details: undefined };
      const stop = new AbortController();
      listening.set(name, stop);
      listen(name, session, stop.signal);
      return { content: [{ type: 'text', text: `Listening to ${name}. What the map has for this chat arrives as a message starting FROM YOUR LIVING MAP.` }], details: undefined };
    },
  });

  pi.on('session_shutdown', () => { for (const stop of listening.values()) stop.abort(); listening.clear(); });
}
