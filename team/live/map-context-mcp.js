// A read-only MCP connection for one map answer. Its capability expires with that answer.
import readline from 'node:readline';

const tools = [
  { name: 'list_maps', description: 'Discover other accessible maps by their detailed purpose, topics, decisions, questions and memories. Use these descriptions to decide relevance, then load_map before using facts. Page through nextOffset or search when needed.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional words to search in names and full descriptions.' }, offset: { type: 'integer', minimum: 0 } } } },
  { name: 'load_map', description: 'Read a relevant map as reference data. Only shared map objects, decisions and memories are returned, never chats. Read nextOffset for more content. Cite the returned href in your answer.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, sections: { type: 'array', items: { type: 'string', enum: ['map','decisions','memory'] } }, offset: { type: 'integer', minimum: 0 } } } },
];
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.id === undefined) continue;
  if (m.method === 'initialize') send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'map-context', version: '1.0.0' } });
  else if (m.method === 'ping') send(m.id, {});
  else if (m.method === 'tools/list') send(m.id, { tools });
  else if (m.method === 'tools/call') {
    try {
      if (!tools.some((t) => t.name === m.params?.name)) throw new Error('Unknown tool.');
      const r = await fetch(process.env.LM_CONTEXT_URL, { method: 'POST', headers: { authorization: `Bearer ${process.env.LM_CONTEXT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: m.params.name, args: m.params.arguments }), signal: AbortSignal.timeout(10000) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Map context unavailable.');
      send(m.id, { content: [{ type: 'text', text: JSON.stringify(data) }] });
    } catch (e) { send(m.id, { isError: true, content: [{ type: 'text', text: e.message }] }); }
  } else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
}
