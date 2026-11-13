import { describe, expect, it } from 'vitest';

import { readAction } from './action-box.js';
import { kindFromTools } from './action-kinds.js';
import { addresses, mailTool, notTheMessage, refusal, sendsTool } from './action-sends.js';

const message = { to: 'Sam@Example.com', subject: 'Launch notes', body: 'Hi Sam,\n\nThe notes are attached below.\n\nThanks' };
const exact = { to: ['sam@example.com'], subject: 'Launch notes', body: 'Hi Sam,\n\nThe notes are attached below.\n\nThanks' };
const GMAIL = 'mcp__claude_ai_Gmail__send_message';

describe('which tools send', () => {
  it('reads a send, post or reply from the tool\'s own name, not its server\'s', () => {
    for (const tool of [GMAIL, 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward', 'mcp__outlook__outlook_send_mail', 'mcp__outlook__outlook_send_draft',
      'mcp__slack__slack_send_message', 'mcp__slack__post', 'mcp__teams__teams_reply_channel_message', 'mcp__linear__save_comment', 'mcp__x__sendMessage'])
      expect(sendsTool(tool), tool).toBe(true);
    for (const tool of ['Bash', 'Write', 'mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__create_draft', 'mcp__outlook__outlook_create_reply_draft',
      'mcp__postgres__query', 'mcp__send__list_things', 'mcp__claude_ai_Slack__read_channel'])
      expect(sendsTool(tool), tool).toBe(false);
  });
  it('tells mail from other sends', () => {
    expect(mailTool(GMAIL)).toBe(true);
    expect(mailTool('mcp__outlook__outlook_send_mail')).toBe(true);
    expect(mailTool('mcp__slack__slack_send_message')).toBe(false);
    expect(mailTool('mcp__claude_ai_Gmail__get_message')).toBe(false);
  });
  it('reads every address in a recipient field', () => {
    expect(addresses(['A@x.com', 'Sam <sam@example.com>'])).toEqual(['a@x.com', 'sam@example.com']);
    expect(addresses('a@x.com, b@y.com; c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
    expect(addresses([{ address: 'a@x.com' }, { email: 'b@y.com' }])).toEqual(['a@x.com', 'b@y.com']);
    expect(addresses(undefined)).toEqual([]);
  });
});

describe('a send against the reviewed email', () => {
  it('lets the reviewed message through, with whitespace a mail tool may change', () => {
    expect(notTheMessage(message, exact)).toBe('');
    expect(notTheMessage(message, { ...exact, to: 'sam@example.com', body: '  Hi Sam,\r\n\r\nThe notes are attached  below.\n\nThanks\n' })).toBe('');
    expect(notTheMessage(message, { ...exact, cc: [], bcc: [], bodyType: 'text', includeSignature: false })).toBe('');
  });
  it('refuses another recipient, anyone copied, and a changed subject or message', () => {
    expect(notTheMessage(message, { ...exact, to: ['alex@example.com'] })).toContain('alex@example.com');
    expect(notTheMessage(message, { ...exact, to: ['sam@example.com', 'alex@example.com'] })).toContain('not Sam@Example.com');
    expect(notTheMessage(message, { ...exact, to: [] })).toContain('no one');
    expect(notTheMessage(message, { ...exact, cc: ['alex@example.com'] })).toContain('copies alex@example.com');
    expect(notTheMessage(message, { ...exact, bcc: 'eve@example.com' })).toContain('copies eve@example.com');
    expect(notTheMessage(message, { ...exact, subject: 'Launch notes!' })).toContain('subject');
    expect(notTheMessage(message, { ...exact, body: 'Hi Sam, the notes are attached below. Thanks' })).toContain('message');
  });
  it('refuses anything it was not shown: a draft, a reply, an HTML body, attachments, a signature', () => {
    for (const more of [{ draftId: 'd1' }, { messageId: 'm1' }, { replyAll: true }, { htmlBody: '<p>Hi</p>' }, { attachments: [{ content: 'x' }] }, { includeSignature: true }, { bodyType: 'html' }])
      expect(notTheMessage(message, { ...exact, ...more }), JSON.stringify(more)).toMatch(/carries .*you did not review/);
    expect(notTheMessage(message, null)).toContain('no one');
  });
});

describe('what a run may do', () => {
  const guard = { message, left: 1 };
  it('allows one send of the reviewed message, and refuses any other send', () => {
    expect(refusal(guard, GMAIL, exact, 0)).toBe('');
    expect(refusal(guard, GMAIL, exact, 1)).toContain('already sent');
    expect(refusal({ message, left: 0 }, GMAIL, exact, 0)).toContain('already sent');
    expect(refusal(guard, GMAIL, { ...exact, cc: ['alex@example.com'] }, 0)).toContain('refused this send');
    expect(refusal(guard, 'mcp__slack__slack_send_message', { channel_id: 'C1', message: 'Hi' }, 0)).toContain('refused this send');
    expect(refusal(guard, 'mcp__claude_ai_Gmail__search_threads', { q: 'x' }, 5)).toBe('');
  });
  it('refuses mail when no email was reviewed, and leaves other sends to the tool list', () => {
    expect(refusal({ left: 1 }, GMAIL, exact)).toContain('no reviewed email');
    expect(refusal({ left: 1 }, 'mcp__slack__slack_send_message', { channel_id: 'C1', message: 'Hi' })).toBe('');
    expect(refusal(undefined, GMAIL, exact)).toBe('');
  });
  it('refuses writes to GitHub and the web from the shell in a run nobody started', () => {
    const alone = { left: 1, unattended: true }, bash = (/** @type {string} */ command) => refusal(alone, 'Bash', { command });
    for (const command of ['gh pr comment 7 --body ok', 'cd app && gh pr review 7 --approve', 'gh pr merge 7 --squash', 'gh issue comment 3 -b hi',
      'gh api -X POST repos/acme/app/issues/3/comments', 'gh api repos/acme/app/issues/3/comments -f body=hi', 'gh api --method=PATCH repos/acme/app/pulls/7',
      'curl -X POST https://example.com/hook', 'curl -XPUT https://example.com', 'curl -d a=b https://example.com', 'curl --data-raw x https://example.com',
      'curl --json {} https://example.com', 'wget --post-data=x https://example.com'])
      expect(bash(command), command).toContain('started on its own');
    for (const command of ['gh pr view 7 --comments', 'gh api repos/acme/app/pulls/7/comments', 'gh run list', 'curl -fsSL https://example.com',
      'curl -H "Accept: text/plain" https://example.com', 'npm test && git diff', 'git status && curl -s https://example.com | jq .'])
      expect(bash(command), command).toBe('');
    // a run someone started keeps GitHub's CLI, as in their own terminal
    expect(refusal({ left: 1 }, 'Bash', { command: 'gh pr comment 7 --body ok' })).toBe('');
  });
});

describe('the kind, from the tools a brief needs', () => {
  const ready = (/** @type {any} */ more) => readAction({ status: 'ready', brief: { kind: 'other', goal: 'Tell Sam', target: 'Sam', result: 'Sent', steps: ['Send'], ...more } });
  it('makes a step that sends mail an email, whatever preparation called it', () => {
    expect(kindFromTools('other', [GMAIL])).toBe('email');
    expect(kindFromTools('email', [GMAIL])).toBe('email');
    expect(kindFromTools('other', ['mcp__slack__slack_send_message'])).toBe('other');
    expect(kindFromTools('build', ['Edit', 'Bash'])).toBe('build');
    expect(kindFromTools('build', ['Edit', GMAIL])).toBeNull();
  });
  it('asks for the message a step labelled other would have sent unreviewed', () => {
    expect(ready({ tools: [GMAIL] })?.stage).toBe('clarify');
    expect(ready({ tools: [GMAIL], email: message })).toMatchObject({ stage: 'ready', brief: { kind: 'email', email: message, target: message.to } });
    expect(ready({ kind: 'build', tools: ['Edit', GMAIL], email: message })).toMatchObject({ stage: 'clarify', question: expect.stringContaining('its own Action') });
    expect(ready({ tools: ['mcp__slack__slack_send_message'] })).toMatchObject({ stage: 'ready', brief: { kind: 'other' } });
  });
});
