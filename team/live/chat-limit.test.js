import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHAT_MAX, chatTooLong } from './chat-limit.js';

// A long paste reaches Claude whole: a teammate pasting a prep document into the map's chat lost all but its first
// 400 characters. The agent is scripted, so nothing reaches Claude.
const jobs = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock('./agent.js', async (importOriginal) => {
  const real = /** @type {any} */ (await importOriginal());
  return { ...real, agent: { ...real.agent, name: 'Scripted', ask: (/** @type {any} */ j) => { jobs.push(j); return () => {}; }, reach: () => 'reads' } };
});
const { openTestMap, send } = await import('./map.harness.js');
afterEach(() => { jobs.length = 0; });

const state = () => ({
  title: 'Prep', start: 'root', linkSharing: { mode: 'restricted' }, linked: [], calls: [], threads: {}, log: [],
  people: [{ id: 'Priya', sees: 'all' }], nodes: [{ id: 'root', label: 'Prep', x: 0, y: 0 }], edges: [],
});
const tick = () => new Promise((r) => setTimeout(r, 20));
const paste = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n').slice(0, n);

describe('a long message in the map\'s chat', () => {
  it('reaches Claude and the thread whole', async () => {
    const { map: m, close } = openTestMap(state(), 'long-paste');
    try {
      const text = `${paste(6000)}\nThe last line`;
      expect((await send(m, 'Priya', { type: 'ask', text })).status).toBe(200);
      for (let i = 0; i < 5 && !jobs.length; i++) await tick();
      expect(jobs[0].prompt).toContain(text);
      expect(m.snapshot().threads['@Priya'][0].text).toBe(text);
    } finally { close(); }
  });

  it('is refused whole past the limit, never cut, and the page says why', async () => {
    const { map: m, close } = openTestMap(state(), 'too-long');
    try {
      const text = paste(CHAT_MAX + 1);
      expect((await send(m, 'Priya', { type: 'ask', text })).status).not.toBe(200);
      expect(m.snapshot().threads['@Priya'] ?? []).toEqual([]);
      expect(chatTooLong(text)).toContain('20,000');
      expect(chatTooLong(paste(CHAT_MAX))).toBe('');
    } finally { close(); }
  });
});
