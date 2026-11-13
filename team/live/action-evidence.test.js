import { describe, expect, it } from 'vitest';

import { judgeRun } from './action-evidence.js';

const email = { kind: 'email', goal: 'Email Sam', target: 'sam@example.com', result: 'Sent', steps: ['Send it'], email: { to: 'Sam@Example.com', subject: 'Hi', body: 'Hello' } };
const build = { kind: 'build', goal: 'Add the form', target: 'acme/app', result: 'A PR', steps: ['Build it'] };
/** @param {Partial<ToolCall>} c @returns {ToolCall} */
const call = (c) => ({ tool: 'Bash', input: null, ok: true, output: '', ...c });

// What code can show a run did, from its tool calls alone.
describe('judging a run by its tool calls', () => {
  it('counts an email only when a send to the brief\'s recipient succeeded', () => {
    expect(judgeRun(email, [call({ tool: 'mcp__gmail__send_message', input: { to: 'sam@example.com', subject: 'Hi' } })]).evidence).toEqual(['Sent to Sam@Example.com (mcp__gmail__send_message)']);
    expect(judgeRun(email, [call({ tool: 'mcp__gmail__send_message', input: { to: 'alex@example.com' } })]).evidence).toEqual([]);
    expect(judgeRun(email, [call({ tool: 'mcp__gmail__send_message', input: { to: 'sam@example.com' }, ok: false })]).evidence).toEqual([]);
    expect(judgeRun(email, [call({ tool: 'mcp__gmail__search', input: { q: 'to:sam@example.com' } })]).evidence).toEqual([]);
    expect(judgeRun(email, undefined).evidence).toEqual([]);
  });
  it('reads the recipient from the send\'s to-field, not from anywhere in its input', () => {
    const send = (/** @type {any} */ input) => judgeRun(email, [call({ tool: 'mcp__claude_ai_Gmail__send_message', input })]).evidence;
    expect(send({ to: ['Sam <sam@example.com>'], subject: 'Hi' })).toHaveLength(1);
    expect(send({ to: 'alex@example.com', cc: ['sam@example.com'] })).toEqual([]);
    expect(send({ to: ['alex@example.com'], body: 'Copying sam@example.com' })).toEqual([]);
    expect(send({ to: ['sam@example.com'], cc: ['alex@example.com'] })).toEqual([]);
    expect(send({ to: ['sam@example.com', 'alex@example.com'] })).toEqual([]);
    expect(send({ message: 'to sam@example.com' })).toEqual([]);
  });
  it('counts the sends that went, so the Action sends no more', () => {
    const sends = judgeRun(email, [call({ tool: 'mcp__claude_ai_Gmail__send_message' }), call({ tool: 'mcp__slack__post', ok: false }), call({ tool: 'mcp__claude_ai_Gmail__search_threads' })]).sends;
    expect(sends).toBe(1);
  });
  it('offers the pull requests a build\'s successful calls returned, for the caller to confirm', () => {
    const calls = [call({ output: 'https://github.com/acme/app/pull/7\nhttps://github.com/acme/app/pull/7' }), call({ ok: false, output: 'https://github.com/acme/app/pull/8' })];
    expect(judgeRun(build, calls).pulls).toEqual(['https://github.com/acme/app/pull/7']);
    expect(judgeRun({ ...build, kind: 'other' }, calls).pulls).toEqual([]);
  });
  it('lists what the run changed, leaving out reads and failures', () => {
    const did = judgeRun(build, [
      call({ summary: 'git commit -m form' }), call({ tool: 'Edit', input: { file_path: 'a.js' } }),
      call({ tool: 'Read', reads: true }), call({ tool: 'Write', ok: false }), call({ tool: 'Edit' }),
    ]).did;
    expect(did).toEqual(['Bash: git commit -m form', 'Edit']);
  });
});
