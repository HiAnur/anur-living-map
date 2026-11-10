import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { describe, expect, it } from 'vitest';

import { PROPOSE_SCHEMA, PROPOSE_SERVER } from './propose.js';

// The propose_change server as Claude Code starts it: it lists the one tool with the change's schema,
// answers a call without doing anything, and refuses anything else.
async function talk(messages) {
  const proc = spawn(PROPOSE_SERVER.command, PROPOSE_SERVER.args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = [], lines = readline.createInterface({ input: proc.stdout });
  const wanted = messages.filter((m) => m.id !== undefined).length;
  const done = new Promise((resolve) => lines.on('line', (l) => { replies.push(JSON.parse(l)); if (replies.length === wanted) resolve(undefined); }));
  for (const m of messages) proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  await done; proc.kill();
  return replies;
}

describe('propose_change server', () => {
  it('offers one tool and answers its call, doing nothing else', async () => {
    const [init, list, call, other] = await talk([
      { id: 1, method: 'initialize', params: {} },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'propose_change', arguments: { nodes: [{ id: 'a' }] } } },
      { id: 4, method: 'tools/call', params: { name: 'something_else', arguments: {} } },
    ]);
    expect(init.result.serverInfo.name).toBe('map-propose');
    expect(list.result.tools.map((t) => t.name)).toEqual(['propose_change']);
    expect(list.result.tools[0].inputSchema).toEqual(PROPOSE_SCHEMA);
    expect(call.result.content[0].text).toContain('Apply');
    expect(other.error.code).toBe(-32601);
  });
});
