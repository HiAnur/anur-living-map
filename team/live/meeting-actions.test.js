import { describe, expect, it, vi } from 'vitest';

// A meeting's end on a real map: what the person recording said they will do becomes their Action draft through
// the same check as a chat's (action-items.js), and the map prepares it as them; what someone else said makes
// nothing of theirs. The agent is scripted, so nothing reaches Claude.
const jobs = vi.hoisted(() => /** @type {{ kind: string, job: any }[]} */ ([]));
vi.mock('./agent.js', async (importOriginal) => {
  const real = /** @type {any} */ (await importOriginal());
  const job = (/** @type {string} */ kind) => (/** @type {any} */ j) => { jobs.push({ kind, job: j }); return () => {}; };
  const answer = async (/** @type {any} */ j) => {
    jobs.push({ kind: 'answer', job: j });
    if (j.schema?.properties?.items) return { value: { items: [
      { quote: "I'll send Dan the pricing by Thursday", title: 'Send Dan the pricing', task: { goal: 'Send Dan the pricing', result: 'Dan has the pricing sheet', inputs: [], steps: ['Email Dan the sheet'], evidence: ['The sent email'], dependsOn: [] } },
      { quote: 'Priya will check the contract', title: 'Check the contract', task: { goal: 'Check the contract', result: 'Checked', inputs: [], steps: ['Read it'], evidence: ['Notes'], dependsOn: [] } },
    ] }, ms: 1 };
    return { value: { summary: '', ops: [] }, ms: 1 };
  };
  return { ...real, agent: { ...real.agent, name: 'Scripted', ask: job('ask'), prepare: job('prepare'), run: job('run'), converse: job('converse'), answer, reach: () => 'reads' } };
});
const { openTestMap } = await import('./map.harness.js');

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
/** @param {number} s @param {string} text @param {string} [speaker] */
const seg = (s, text, speaker = 'others') => ({ text, speaker, start: T0 + s * 1000, end: T0 + s * 1000 + 900 });

describe('the end of a meeting on a real map', () => {
  it('makes your commitments your Action drafts, prepared as you, and nothing from what others said', async () => {
    const { map, close } = openTestMap({ title: 'Untitled', people: [{ id: 'Duy', sees: 'all' }, { id: 'Priya', sees: 'all' }], nodes: [], edges: [], calls: [], threads: {}, log: [] }, 'meeting-actions');
    try {
      map.startMeeting({ title: 'Pricing sync', by: 'Duy' });
      map.meeting.add([seg(0, "Sure. I'll send Dan the pricing by Thursday.", 'you'), seg(4, 'Priya will check the contract.')]);
      map.meeting.end();
      for (let i = 0; i < 100 && !map.snapshot().meeting?.actions; i++) await wait(10);
      const s = map.snapshot();
      expect(s.meeting.actions).toEqual([
        { title: 'Send Dan the pricing', made: expect.any(String) },
        { title: 'Check the contract', refused: expect.any(String) },
      ]);
      const draft = /** @type {any} */ (s.nodes.find((/** @type {any} */ n) => n.id === s.meeting.actions[0].made));
      expect(draft.action).toMatchObject({ by: 'Duy', from: { kind: 'meeting', quote: "I'll send Dan the pricing by Thursday" } });
      await wait(10);
      // prepared as Duy, never run
      expect(jobs.filter((j) => j.kind === 'prepare')).toHaveLength(1);
      expect(jobs.filter((j) => j.kind === 'run')).toHaveLength(0);
      expect(s.threads['@Duy'].at(-1).text).toMatch(/^Made 1 Action draft from what you said/);
    } finally {
      close();
    }
  });
});
