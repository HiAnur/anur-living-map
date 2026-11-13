// Whether an Action run did what its brief asked, judged by code from the tool calls the run actually made
// (RunResult.calls: each tool, its input, whether it succeeded and what it returned), never from the model's words.
// The model's summary and the evidence it claims are kept beside this as its account.
import { execFile } from 'node:child_process';

import { kindOf } from './action-kinds.js';
import { addresses, sendsTool } from './action-sends.js';

const PULL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

/** @param {ToolCall} call */
const succeeded = (call) => call.ok === true;
/** The fields of a call's input. @param {ToolCall} call @returns {Record<string, unknown>} */
const fields = (call) => (call.input && typeof call.input === 'object' ? /** @type {any} */ (call.input) : {});
/** Whether a send went to exactly this one address, read from its to-field, with no one copied. @param {ToolCall} call @param {string} address */
const sentTo = (call, address) => {
  const to = addresses(fields(call).to);
  return to.length === 1 && to[0] === address.trim().toLowerCase() && !addresses(fields(call).cc).length && !addresses(fields(call).bcc).length;
};

/**
 * What code can show a run did. `pulls` are pull request links a successful call returned, which the caller
 * confirms exist before they count; `did` is every successful call that changed something, for Continue.
 * @param {Brief} brief @param {ToolCall[] | undefined} calls
 */
export function judgeRun(brief, calls = []) {
  const ok = calls.filter(succeeded);
  // a call the agent marks as only reading changes nothing a Continue could repeat
  const did = ok.filter((c) => !c.reads).map((c) => `${c.tool}${c.summary ? `: ${c.summary}` : ''}`);
  /** @type {string[]} */
  const evidence = [];
  const proof = kindOf(brief)?.proof;
  if (proof === 'sent' && brief.email) {
    const to = brief.email.to;
    const sent = ok.find((c) => sendsTool(c.tool) && sentTo(c, to));
    if (sent) evidence.push(`Sent to ${brief.email.to} (${sent.tool})`);
  }
  const pulls = proof === 'pull' ? [...new Set(ok.flatMap((c) => String(c.output || '').match(PULL) || []))] : [];
  // how many sends went out, so a later run of the same Action sends no more
  const sends = ok.filter((c) => sendsTool(c.tool)).length;
  return { evidence, pulls, sends, did: [...new Set(did)].slice(0, 30) };
}

/**
 * Whether a pull request exists, asked of GitHub with the gh CLI; false when gh is missing, signed out or offline.
 * @param {string} url @param {string} cwd
 * @returns {Promise<boolean>}
 */
export const pullRequestExists = (url, cwd) => new Promise((resolve) => {
  execFile('gh', ['pr', 'view', url, '--json', 'url'], { cwd, timeout: 15_000 }, (error, out) => resolve(!error && String(out).includes('/pull/')));
});
