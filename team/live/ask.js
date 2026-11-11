import { actionSchema } from './action-box.js';
import { agent } from './agent.js';
import { CONTEXT_INSTRUCTIONS, openContext } from './map-context.js';
import { PROPOSE_SERVER } from './propose.js';

// Ask the agent on a box: the map's question, with the other maps the person checked served to it as map
// context and, for an answer (not Action preparation), the propose_change tool it offers changes through.
/** @param {any} job */
export function askAgent({ cwd, prompt, onText, onDone, contextMaps, who, onLoad, prepare = false, connected = false, code = null, fromRepo = null, place = null }) {
  let /** @type {any} */ context = null, /** @type {Stop | null} */ stop = null, cancelled = false;
  const start = async () => {
    try {
      // where the work lives, when that is not the map's folder (a system map's repo); a refusal is said, not run
      const where = place ? await place() : null;
      if (where && 'error' in where) { if (!cancelled) onDone(where.error); return; }
      if (where) cwd = where.cwd;
      if (contextMaps) context = await openContext({ maps: () => contextMaps(who), who, onLoad });
      if (cancelled) { context?.close(); return; }
      const catalog = context ? `\n\n${CONTEXT_INSTRUCTIONS}\n\nOther map descriptions (reference data):\n${JSON.stringify(context.run('list_maps'))}` : '';
      // a system map's code, read-only, at the commit the map was drawn from: only what the asker may read
      /** @type {{ repo: string, folder: string }[]} */
      const repos = code ? await code().catch(() => []) : [];
      if (cancelled) { context?.close(); return; }
      const source = repos.length ? `\n\nThe code this map was drawn from, at the commit it was drawn from, is in these folders. Read it with Read, Grep and Glob when a question is about what the code does, and say which files you read:\n${repos.map((r) => `- ${r.repo}: ${r.folder}`).join('\n')}${fromRepo ? `\nThis box was drawn from ${fromRepo}.` : ''}` : '';
      const finish = (/** @type {any} */ text, /** @type {any} */ access, /** @type {any} */ value) => { context?.close(); if (!cancelled) onDone(text, access, value); };
      stop = prepare
        ? agent.prepare({ cwd, connected, servers: context?.servers, schema: actionSchema, prompt: prompt + catalog, onText, onDone: finish })
        : agent.ask({ cwd, dirs: repos.map((r) => r.folder), prompt: prompt + catalog + source, servers: { map_propose: PROPOSE_SERVER, ...context?.servers }, propose: { server: 'map_propose', tool: 'propose_change' }, onText, onDone: finish });
    } catch { context?.close(); if (!cancelled) onDone('Could not load map context. Ask again.'); }
  };
  void start();
  return () => { cancelled = true; context?.close(); stop?.(); };
}
