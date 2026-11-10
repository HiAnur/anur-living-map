// The MCP server behind propose_change. The call does nothing here: the server reads its input from the
// answer's stream, checks it against the map, and shows it with Apply.
import readline from 'node:readline';

import { PROPOSE_SCHEMA } from './propose.js';

const tools = [{ name: 'propose_change', description: 'Offer one change to the map. The page shows it to the person with an Apply button; nothing changes until they press it. Call it at most once per reply, with the whole change: a later call replaces an earlier one.', inputSchema: PROPOSE_SCHEMA }];
/** @param {unknown} id @param {unknown} result */
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
for await (const raw of readline.createInterface({ input: process.stdin })) {
  let m; try { m = JSON.parse(raw); } catch { continue; }
  if (m.id === undefined) continue;
  if (m.method === 'initialize') send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'map-propose', version: '1.0.0' } });
  else if (m.method === 'ping') send(m.id, {});
  else if (m.method === 'tools/list') send(m.id, { tools });
  else if (m.method === 'tools/call' && m.params?.name === 'propose_change') send(m.id, { content: [{ type: 'text', text: 'Shown to the person with an Apply button. Say in one line what it changes; do not repeat it as JSON.' }] });
  else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
}
