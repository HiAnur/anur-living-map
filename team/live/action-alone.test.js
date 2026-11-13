import { describe, expect, it } from 'vitest';

import { actionBoxes } from './action-box.js';

// An Action its author set to run on its own: the map presses Execute once a brief is ready that only looks things
// up, holds anything else at Ready with the reason, and a chain of such steps runs through.

const READS = new Set(['WebSearch', 'Read']);
const research = { kind: 'other', goal: 'List ten places first users gather', target: 'The reply', result: 'A ranked list', steps: ['Search', 'Rank'], tools: ['WebSearch'] };
const plan = (/** @type {string[]} */ dependsOn = []) => ({ goal: 'Find where first users gather', result: 'A ranked list', inputs: ['The product'], steps: ['Search'], evidence: ['The list'], dependsOn });

function harness() {
  /** @type {Record<string, any>} */ const nodes = { a: { id: 'a', label: 'Research' }, b: { id: 'b', label: 'Shortlist' } };
  /** @type {any[]} */ const asks = [], runs = [];
  const api = actionBoxes({
    nodeOf: (id) => nodes[id], allNodes: () => Object.values(nodes), canUse: () => true, context: () => '', changed: () => {}, executionCwd: '/p',
    ask: (r) => { asks.push(r); return () => {}; }, run: (r) => { runs.push(r); return () => {}; }, readsOnly: (tool) => READS.has(tool),
  });
  /** the last preparation for a box answers with this brief */
  const ready = (/** @type {string} */ id, chosen = research) => asks.filter((r) => r.box === nodes[id]).at(-1).onDone('', { tools: chosen.tools, denied: [] }, { status: 'ready', brief: chosen });
  return { api, nodes, asks, runs, ready };
}
const done = { text: 'Here is the list', completion: { status: 'completed', summary: 'Ranked ten places', evidence: ['The list in the reply'] }, calls: [{ tool: 'WebSearch', input: {}, ok: true, output: '', reads: true }] };

describe('an Action set to run on its own', () => {
  it('is prepared when turned on, and runs once a brief that only looks things up is ready', () => {
    const h = harness();
    h.api.begin('a', 'Duy', plan());
    expect(h.api.alone('a', 'Duy', true)).toBe(true);
    expect(h.nodes.a.action.stage).toBe('gathering');
    h.ready('a');
    expect(h.runs).toHaveLength(1);
    expect(h.nodes.a.action.stage).toBe('running');
    expect(h.runs[0].prompt).toContain('set this Action to run on its own');
    expect(h.nodes.a.action.events.filter((/** @type {any} */ e) => e.what === 'executed')).toMatchObject([{ by: 'Map' }]);
  });
  it('holds anything that sends, changes code or needs a tool that writes, and says why', () => {
    const briefs = {
      email: { ...research, kind: 'email', tools: ['WebSearch'], email: { to: 'sam@example.com', subject: 'Hi', body: 'Hello' } },
      build: { ...research, kind: 'build', tools: ['Read'] },
      write: { ...research, tools: ['WebSearch', 'mcp__slack__post'] },
    };
    for (const [name, chosen] of Object.entries(briefs)) {
      const h = harness();
      h.api.begin('a', 'Duy', plan());
      h.api.alone('a', 'Duy', true);
      h.ready('a', chosen);
      expect(h.runs, name).toHaveLength(0);
      expect(h.nodes.a.action.stage, name).toBe('ready');
      expect(h.nodes.a.action.held, name).toMatch(/waits? for your go/);
      expect(h.nodes.a.action.events.at(-1).what, name).toBe('held');
      // its author's own Execute still runs it, and the reason goes
      expect(h.api.execute('a', 'Duy', h.nodes.a.action.id)).toBe(true);
      expect(h.nodes.a.action.held, name).toBeUndefined();
    }
    const h = harness();
    h.api.begin('a', 'Duy', plan()); h.api.alone('a', 'Duy', true); h.ready('a', briefs.write);
    expect(h.nodes.a.action.held).toContain('mcp__slack__post');
  });
  it('runs a ready brief at once when turned on there, and keeps the choice through a question', () => {
    const h = harness();
    h.api.begin('a', 'Duy', plan()); h.api.prepare('a', 'Duy'); h.ready('a');
    expect(h.runs).toHaveLength(0);
    h.api.alone('a', 'Duy', true);
    expect(h.runs).toHaveLength(1);

    const q = harness();
    q.api.begin('a', 'Duy', plan()); q.api.alone('a', 'Duy', true);
    q.asks[0].onDone('', undefined, { status: 'clarify', question: 'Which market?', choices: ['US'] });
    expect(q.nodes.a.action.stage).toBe('clarify');
    q.api.prepare('a', 'Duy', 'US'); q.ready('a');
    expect(q.runs).toHaveLength(1);
  });
  it('finishes verified when it only looked things up, and not when it changed something', () => {
    const h = harness();
    h.api.begin('a', 'Duy', plan()); h.api.alone('a', 'Duy', true); h.ready('a');
    h.runs[0].onDone(done);
    expect(h.nodes.a.action.completion).toMatchObject({ status: 'completed', evidence: ['Answered in the reply. The run only looked things up.'] });

    const w = harness();
    w.api.begin('a', 'Duy', plan()); w.api.alone('a', 'Duy', true); w.ready('a');
    w.runs[0].onDone({ ...done, calls: [...done.calls, { tool: 'Bash', input: {}, ok: true, output: '' }] });
    expect(w.nodes.a.action.completion.status).toBe('unverified');
  });
  it('runs a chain of such steps through once the first is started', () => {
    const h = harness();
    h.api.begin('a', 'Duy', plan()); h.api.begin('b', 'Duy', plan(['a']));
    h.api.alone('b', 'Duy', true);
    expect(h.nodes.b.action.stage).toBe('waiting');
    h.api.alone('a', 'Duy', true); h.ready('a');
    h.runs[0].onDone(done);
    // its prerequisite finished verified, so the next one is prepared and, once ready, runs with no click
    expect(h.nodes.b.action.stage).toBe('gathering');
    expect(h.asks.at(-1).prompt).toContain('What the prerequisite Actions produced');
    h.ready('b');
    expect(h.runs).toHaveLength(2);
  });
  it('is only its author\'s to choose, before it runs, and a handover turns it off', () => {
    const h = harness();
    h.api.begin('a', 'Duy', plan());
    expect(h.api.alone('a', 'Priya', true)).toBe(false);
    expect(h.api.alone('a', 'Duy', 'yes')).toBe(false);
    expect(h.nodes.a.action.auto).toBeUndefined();
    h.api.alone('a', 'Duy', true);
    h.ready('a');
    expect(h.api.alone('a', 'Duy', false)).toBe(false);
    h.runs[0].onDone(done);

    const o = harness();
    o.api.begin('a', 'Duy', plan()); o.api.alone('a', 'Duy', true);
    o.ready('a', { ...research, tools: ['mcp__slack__post'] });
    expect(o.api.handover('a', 'Admin', 'Priya')).toBe(true);
    expect(o.nodes.a.action.auto).toBeUndefined();
    expect(o.nodes.a.action.held).toBeUndefined();

    const f = harness();
    f.api.begin('a', 'Duy', plan()); f.api.alone('a', 'Duy', true);
    expect(f.api.alone('a', 'Duy', false)).toBe(true);
    f.ready('a');
    expect(f.runs).toHaveLength(0);
    expect(f.nodes.a.action.events.map((/** @type {any} */ e) => e.what)).toContain('manual');
  });
});

describe('which tools only read, as each agent marks them', () => {
  it('lets a lookup run on its own and holds a shell or an edit', async () => {
    const { claudeCode } = await import('./agents/claude-code/index.js');
    const { pi } = await import('./agents/pi/index.js');
    for (const tool of ['WebSearch', 'WebFetch', 'Read', 'Grep']) expect(claudeCode().readsOnly(tool), tool).toBe(true);
    for (const tool of ['Bash', 'Edit', 'Write', 'mcp__slack__post']) expect(claudeCode().readsOnly(tool), tool).toBe(false);
    for (const tool of ['read', 'grep']) expect(pi().readsOnly(tool), tool).toBe(true);
    for (const tool of ['bash', 'edit', 'write']) expect(pi().readsOnly(tool), tool).toBe(false);
  });
});
