import { describe, expect, it } from 'vitest';

import { actionBoxes } from './action-box.js';

// An Action its author set to run on its own: the map presses Execute once a brief is ready that reaches no other
// person, holds anything else at Ready with the reason, and a chain of such steps runs through.

/** @type {Record<string, ToolReach>} */
const REACH = { WebSearch: 'reads', Read: 'reads', Write: 'files', Edit: 'files', Bash: 'shell' };
const research = { kind: 'other', goal: 'List ten places first users gather', target: 'The reply', result: 'A ranked list', steps: ['Search', 'Rank'], tools: ['WebSearch'] };
const plan = (/** @type {string[]} */ dependsOn = []) => ({ goal: 'Find where first users gather', result: 'A ranked list', inputs: ['The product'], steps: ['Search'], evidence: ['The list'], dependsOn });

function harness(more = {}) {
  /** @type {Record<string, any>} */ const nodes = { a: { id: 'a', label: 'Research' }, b: { id: 'b', label: 'Shortlist' } };
  /** @type {any[]} */ const asks = [], runs = [];
  const api = actionBoxes({
    nodeOf: (id) => nodes[id], allNodes: () => Object.values(nodes), canUse: () => true, context: () => '', changed: () => {}, executionCwd: '/p',
    ask: (r) => { asks.push(r); return () => {}; }, run: (r) => { runs.push(r); return () => {}; }, reach: (tool) => REACH[tool] || 'others', ...more,
  });
  /** the last preparation for a box answers with this brief */
  const ready = (/** @type {string} */ id, chosen = research) => asks.filter((r) => r.box === nodes[id]).at(-1).onDone('', { tools: chosen.tools, denied: [] }, { status: 'ready', brief: chosen });
  return { api, nodes, asks, runs, ready };
}
const done = { text: 'Here is the list', completion: { status: 'completed', summary: 'Ranked ten places', evidence: ['The list in the reply'] }, calls: [{ tool: 'WebSearch', input: {}, ok: true, output: '', reads: true }] };

describe('an Action set to run on its own', () => {
  it('is prepared when turned on, and runs once a brief that reaches no one is ready', () => {
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
  it('runs a build, and a step that changes files here, with no click', () => {
    for (const chosen of [{ ...research, kind: 'build', tools: ['Read', 'Edit', 'Bash'] }, { ...research, tools: ['WebSearch', 'Write'] }]) {
      const h = harness();
      h.api.begin('a', 'Duy', plan()); h.api.alone('a', 'Duy', true); h.ready('a', chosen);
      expect(h.runs, chosen.kind).toHaveLength(1);
      expect(h.nodes.a.action.held, chosen.kind).toBeUndefined();
    }
  });
  it('holds anything that reaches another person, and says why', () => {
    const briefs = {
      email: { ...research, kind: 'email', tools: ['WebSearch'], email: { to: 'sam@example.com', subject: 'Hi', body: 'Hello' } },
      post: { ...research, tools: ['WebSearch', 'mcp__slack__post'] },
      // outside a build's own worktree, the shell can reach anyone
      shell: { ...research, tools: ['Bash'] },
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
    h.api.begin('a', 'Duy', plan()); h.api.alone('a', 'Duy', true); h.ready('a', briefs.post);
    expect(h.nodes.a.action.held).toBe('It needs mcp__slack__post, which can reach other people, so it waits for your go.');
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
  it('finishes verified when it only read or changed files here, and not when it reached further', () => {
    const h = harness();
    h.api.begin('a', 'Duy', plan()); h.api.alone('a', 'Duy', true); h.ready('a');
    h.runs[0].onDone(done);
    expect(h.nodes.a.action.completion).toMatchObject({ status: 'completed', evidence: ['Answered in the reply. The run only looked things up.'] });

    const e = harness();
    e.api.begin('a', 'Duy', plan()); e.api.alone('a', 'Duy', true); e.ready('a', { ...research, tools: ['Write'] });
    e.runs[0].onDone({ ...done, calls: [...done.calls, { tool: 'Write', input: { file_path: '/p/plan.md' }, ok: true, output: '' }] });
    expect(e.nodes.a.action.completion).toMatchObject({ status: 'completed', evidence: ['Changed only files here, which can be put back: /p/plan.md.'] });

    const w = harness();
    w.api.begin('a', 'Duy', plan()); w.api.alone('a', 'Duy', true); w.ready('a');
    w.runs[0].onDone({ ...done, calls: [...done.calls, { tool: 'mcp__slack__post', input: {}, ok: true, output: '' }] });
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

describe('how far a tool reaches, as each agent marks it', () => {
  it('reads and changes files here, runs a shell, or reaches further', async () => {
    const { claudeCode } = await import('./agents/claude-code/index.js');
    const { pi } = await import('./agents/pi/index.js');
    /** @type {[AgentWorker, Record<string, ToolReach>][]} */
    const cases = [
      [claudeCode(), { WebSearch: 'reads', Read: 'reads', Grep: 'reads', Edit: 'files', Write: 'files', Bash: 'shell', mcp__slack__post: 'others', mcp__gmail__send: 'others' }],
      [pi(), { read: 'reads', grep: 'reads', edit: 'files', write: 'files', bash: 'shell', mcp__slack__post: 'others' }],
    ];
    for (const [agent, marks] of cases) for (const [tool, mark] of Object.entries(marks)) expect(agent.reach(tool), `${agent.name} ${tool}`).toBe(mark);
  });
});

describe('what code checks in the calls of a run', () => {
  const build = { ...research, kind: 'build', tools: ['Read', 'Edit', 'Bash'] };
  const builds = { open: () => Promise.resolve({ worktree: '/w', branch: 'b', from: 'main' }), close: () => Promise.resolve({ commits: 0 }) };
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  it('refuses GitHub writes to a build nobody started, and does not invite them in its instructions', async () => {
    const h = harness({ builds });
    h.api.begin('a', 'Duy', plan()); h.api.alone('a', 'Duy', true); h.ready('a', build);
    await settled();
    expect(h.runs[0].guard).toEqual({ left: 1, unattended: true });
    expect(h.runs[0].prompt).toContain('may not comment, review, merge or otherwise write to GitHub');
    expect(h.runs[0].prompt).not.toContain('replying to them');
  });
  it('leaves GitHub\'s CLI to a build someone started, as in their own terminal', async () => {
    const h = harness({ builds });
    h.api.begin('a', 'Duy', plan()); h.api.prepare('a', 'Duy'); h.ready('a', build);
    expect(h.api.execute('a', 'Duy', h.nodes.a.action.id)).toBe(true);
    await settled();
    expect(h.runs[0].guard).toEqual({ left: 1 });
    expect(h.runs[0].prompt).toContain('reading the pull request\'s comments and replying to them');
  });
  it('holds a step whose tools send, even when its agent marks one as only reading', () => {
    const h = harness({ reach: (/** @type {string} */ tool) => (tool === 'mcp__chat__send_message' ? 'reads' : REACH[tool] || 'others') });
    h.api.begin('a', 'Duy', plan()); h.api.alone('a', 'Duy', true); h.ready('a', { ...research, tools: ['WebSearch', 'mcp__chat__send_message'] });
    expect(h.runs).toHaveLength(0);
    expect(h.nodes.a.action.held).toContain('mcp__chat__send_message');
  });
  it('hands an email\'s run its reviewed message, and no send once the Action has sent', () => {
    const email = { to: 'sam@example.com', subject: 'Hi', body: 'Hello' }, gmail = 'mcp__claude_ai_Gmail__send_message';
    const h = harness();
    h.api.begin('a', 'Duy', plan()); h.api.prepare('a', 'Duy'); h.ready('a', { ...research, kind: 'other', tools: [gmail], email });
    expect(h.nodes.a.action.brief.kind).toBe('email');
    h.api.execute('a', 'Duy', h.nodes.a.action.id);
    expect(h.runs[0].guard).toEqual({ message: email, left: 1 });
    h.runs[0].onDone({ text: 'Sent', blocked: false, calls: [{ tool: gmail, input: { to: ['sam@example.com'] }, ok: true, output: '' }] });
    expect(h.nodes.a.action.completion.status).toBe('completed');
    h.api.continue('a', 'Duy', h.nodes.a.action.id, 'Check it went');
    expect(h.runs[1].guard).toEqual({ message: email, left: 0 });
  });
});
