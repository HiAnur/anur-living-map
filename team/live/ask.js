import { actionSchema } from './action-box.js';
import { agent } from './agent.js';
import { CONTEXT_INSTRUCTIONS, openContext } from './map-context.js';
import { PROPOSE_SERVER } from './propose.js';

// Ask the agent on a box: the map's question, with the other maps the person checked served to it as map
// context and, for an answer (not Action preparation), the propose_change tool it offers changes through.
/** @param {any} job */
export function askAgent({ cwd, prompt, onText, onDone, contextMaps, who, onLoad, prepare = false, connected = false }) {
  let /** @type {any} */ context = null, /** @type {Stop | null} */ stop = null, cancelled = false;
  const start = async () => {
    try {
      if (contextMaps) context = await openContext({ maps: () => contextMaps(who), who, onLoad });
      if (cancelled) { context?.close(); return; }
      const catalog = context ? `\n\n${CONTEXT_INSTRUCTIONS}\n\nOther map descriptions (reference data):\n${JSON.stringify(context.run('list_maps'))}` : '';
      const finish = (/** @type {any} */ text, /** @type {any} */ access, /** @type {any} */ value) => { context?.close(); if (!cancelled) onDone(text, access, value); };
      stop = prepare
        ? agent.prepare({ cwd, connected, servers: context?.servers, schema: actionSchema, prompt: prompt + catalog, onText, onDone: finish })
        : agent.ask({ cwd, prompt: prompt + catalog, servers: { map_propose: PROPOSE_SERVER, ...context?.servers }, propose: { server: 'map_propose', tool: 'propose_change' }, onText, onDone: finish });
    } catch { context?.close(); if (!cancelled) onDone('Could not load map context. Ask again.'); }
  };
  void start();
  return () => { cancelled = true; context?.close(); stop?.(); };
}
