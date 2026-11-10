import { afterEach, describe, expect, it, vi } from 'vitest';

// The map asks whatever agent agent.js picks, never Claude Code by name: a scripted agent stands in here and
// gets the map's own prompt, schema, servers and propose tool, and what it hands back reaches the map.
const calls = vi.hoisted(() => /** @type {{ kind: string, job: any }[]} */ ([]));
const script = vi.hoisted(() => /** @type {{ reply: (kind: string, job: any) => void }} */ ({ reply: () => {} }));
vi.mock('./agent.js', () => {
  const job = (/** @type {string} */ kind) => (/** @type {any} */ j) => { calls.push({ kind, job: j }); script.reply(kind, j); return () => calls.push({ kind: `stop ${kind}`, job: j }); };
  return { agent: { name: 'Scripted', signedOut: 'Signed out.', signIn: async () => true, ask: job('ask'), prepare: job('prepare'), run: job('run'), converse: job('converse') } };
});

const { askAgent } = await import('./ask.js');
const { actionSchema } = await import('./action-box.js');

afterEach(() => { calls.length = 0; script.reply = () => {}; });
const ask = (/** @type {any} */ o = {}) => new Promise((resolve) => {
  askAgent({ cwd: '/sample/project', prompt: 'Add a box for pricing', onText() {}, ...o, onDone: (/** @type {any[]} */ ...a) => resolve({ a }) });
});

describe('the map on another agent', () => {
  it('asks with the map\'s prompt and propose tool, and takes the change from the agent\'s call', async () => {
    script.reply = (kind, j) => j.onDone('Added a pricing box.', undefined, { nodes: [{ id: 'pricing', label: 'Pricing', sub: 'What we charge' }] });
    const { a } = /** @type {any} */ (await ask());
    const [{ kind, job }] = calls;
    expect(kind).toBe('ask');
    expect(job.cwd).toBe('/sample/project');
    expect(job.prompt).toBe('Add a box for pricing');
    expect(job.propose).toEqual({ server: 'map_propose', tool: 'propose_change' });
    expect(Object.keys(job.servers)).toEqual(['map_propose']);
    expect(job.servers.map_propose.tools).toEqual(['propose_change']);
    expect(a).toEqual(['Added a pricing box.', undefined, { nodes: [{ id: 'pricing', label: 'Pricing', sub: 'What we charge' }] }]);
  });
  it('prepares an Action held to the map\'s schema, and passes on what the agent could use', async () => {
    const brief = { status: 'clarify', question: 'Which list?', choices: ['Customers', 'Leads'] };
    script.reply = (kind, j) => j.onDone('', { tools: ['Read'], denied: [] }, brief);
    const { a } = /** @type {any} */ (await ask({ prepare: true, connected: true }));
    const [{ kind, job }] = calls;
    expect(kind).toBe('prepare');
    expect(job.schema).toBe(actionSchema);
    expect(job.connected).toBe(true);
    expect(job.servers).toBeUndefined();
    expect(a).toEqual(['', { tools: ['Read'], denied: [] }, brief]);
  });
  it('serves the other maps you checked to the agent, with only their reading tools', async () => {
    script.reply = (kind, j) => j.onDone('From the other map.', undefined, undefined);
    await ask({ contextMaps: () => [], who: 'Tester' });
    const { job } = calls[0];
    expect(Object.keys(job.servers)).toEqual(['map_propose', 'map_context']);
    expect(job.servers.map_context.tools).toEqual(['list_maps', 'load_map']);
    expect(job.prompt).toContain('Add a box for pricing');
  });
  it('stops the agent\'s job when the map stops asking', async () => {
    let started = /** @type {(v?: unknown) => void} */ (() => {});
    const begun = new Promise((r) => { started = r; });
    script.reply = () => started();
    const stop = askAgent({ cwd: '/p', prompt: 'q', onText() {}, onDone() {} });
    await begun;
    stop();
    expect(calls.map((c) => c.kind)).toEqual(['ask', 'stop ask']);
  });
});
