import { afterEach, describe, expect, it, vi } from 'vitest';

// Preparation answers in the background, as Claude would, without starting it: one question back.
vi.mock('./ask.js', () => ({
  askAgent: (/** @type {any} */ request) => {
    const t = setTimeout(() => request.onDone('', { tools: [], denied: [] }, { status: 'clarify', question: 'Which pilots?', choices: [] }));
    return () => clearTimeout(t);
  },
}));
const { openTestMap, send } = await import('./map.harness.js');

// Who last changed a box is always on it: the person for what they did, Claude for what the map did in the
// background (an Action preparing or running), never left blank beside a fresh date.
const opened = /** @type {(() => void)[]} */ ([]);
afterEach(() => { for (const close of opened.splice(0)) close(); });
function open() {
  const { map, close } = openTestMap({
    title: 'Launch', people: [{ id: 'Duy', role: 'Admin', sees: 'all' }], calls: [], threads: {}, log: [],
    nodes: [{ id: 'web', label: 'Web', x: 0, y: 0 }], edges: [] }, 'editor');
  opened.push(close);
  const act = async (/** @type {any} */ a) => (await send(map, 'Duy', a)).status;
  const box = () => /** @type {any} */ (map.snapshot().nodes.find((/** @type {any} */ n) => n.id === 'web'));
  return { act, box };
}
const settled = () => new Promise((r) => setTimeout(r, 20));

describe('who last changed a box', () => {
  it('is the person who made it an Action box', async () => {
    const { act, box } = open();
    expect(await act({ type: 'actionbox', id: 'web' })).toBe(200);
    expect(box().action.stage).toBe('draft');
    expect(box().updatedBy).toBe('Duy');
  });
  it('is Claude once preparation answers in the background', async () => {
    const { act, box } = open();
    await act({ type: 'actionbox', id: 'web' });
    expect(await act({ type: 'actionstart', id: 'web', intent: 'Email the pilot customers' })).toBe(200);
    expect(box().updatedBy).toBe('Duy');
    await settled();
    expect(box().action.stage).toBe('clarify');
    expect(box().updatedBy).toBe('Claude');
  });
  it('is the person again for their next edit', async () => {
    const { act, box } = open();
    await act({ type: 'actionbox', id: 'web' });
    await act({ type: 'actionstart', id: 'web', intent: 'Email the pilot customers' });
    await settled();
    expect(await act({ type: 'renamebox', id: 'web', label: 'Website' })).toBe(200);
    expect(box().updatedBy).toBe('Duy');
  });
});
