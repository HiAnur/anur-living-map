import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { actionPrompt, actionSchema, readAction } from './action-box.js';
import { judgeRun } from './action-evidence.js';
import { ACTION_KINDS, KINDS, kindOf, kindsInWords } from './action-kinds.js';

// The table in action-kinds.js is the one list of what an Action box can do: these hold every other place to it.

const brief = (/** @type {string} */ kind, more = {}) => ({ status: 'ready', brief: { kind, goal: 'Do it', target: 'There', result: 'Done', steps: ['Do it'], tools: ['Tool'], ...more } });
const email = { to: 'ana@example.com', subject: 'Hi', body: 'Hello' };

describe('the Action kinds', () => {
  it('are the kinds preparation may answer with, and the ones its instructions name', () => {
    expect(actionSchema.properties.brief.properties.kind.enum).toEqual(KINDS);
    expect(actionPrompt).toContain(`kind (${kindsInWords()})`);
    expect(kindsInWords()).toBe('"email", "build" or "other"');
  });
  it('are the only kinds a ready brief may have', () => {
    for (const kind of KINDS) expect(readAction(brief(kind, ACTION_KINDS[kind].email ? { email } : {}))?.stage, kind).toBe('ready');
    expect(readAction(brief('payment'))).toBeNull();
    expect(kindOf({ kind: 'toString' })).toBeNull();
  });
  it('ask for the email fields exactly when the table says so', () => {
    for (const kind of KINDS) expect(readAction(brief(kind))?.stage, kind).toBe(ACTION_KINDS[kind].email ? 'clarify' : 'ready');
  });
  it('are proved done only as the table says', () => {
    const calls = /** @type {ToolCall[]} */ ([
      { tool: 'send_message', input: { to: 'ana@example.com' }, ok: true, output: 'Sent' },
      { tool: 'Bash', input: {}, ok: true, output: 'https://github.com/acme/app/pull/7' },
    ]);
    for (const kind of KINDS) {
      const run = judgeRun(/** @type {any} */ ({ kind, email }), calls);
      expect(run.evidence.length > 0, kind).toBe(ACTION_KINDS[kind].proof === 'sent');
      expect(run.pulls.length > 0, kind).toBe(ACTION_KINDS[kind].proof === 'pull');
    }
  });
  it('are named nowhere else as a list', () => {
    const named = /\bkind\s*(===|!==)\s*['"](email|build|other)['"]|\[\s*['"]email['"],\s*['"]build['"]/;
    for (const file of ['action-box.js', 'action-evidence.js', 'action-build.js', 'server.js'])
      expect(named.test(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')), file).toBe(false);
  });
});
