// The PreToolUse hook of every Claude Code process the map limits (onlyTools in ./process.js). Claude Code hands
// it the call on stdin and the limits as its one argument; it answers deny with the reason, or nothing, which
// leaves the call to the person's usual permission checks.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { refusal, sendsTool } from '../../action-sends.js';

/**
 * @typedef {{ allowed: string[], reason: string, commands: string[], commandReason: string, guard?: SendGuard, once?: string }} HookLimits
 * `once`: a file that holds the id of the send this run was let through, so a second is refused and a failed
 * one can be tried again (runAction removes it when that call fails)
 */

/** Why the call is denied, or '' when it may go on. @param {HookLimits} limits @param {any} call what Claude Code hands the hook */
export function decide(limits, call) {
  const name = call?.tool_name, input = call?.tool_input;
  if (typeof name !== 'string' || !limits.allowed.includes(name)) return limits.reason;
  const command = name === 'Bash' && typeof input?.command === 'string' ? input.command : '';
  if (limits.commands.some((r) => new RegExp(r).test(command))) return limits.commandReason;
  const guard = limits.guard;
  if (!guard) return '';
  const sent = limits.once && fs.existsSync(limits.once) ? 1 : 0;
  const why = refusal(guard, name, input, sent);
  if (why || !guard.message || !sendsTool(name) || !limits.once) return why;
  // the file is made only if it is not there, so two sends at once cannot both pass
  try { fs.writeFileSync(limits.once, String(call?.tool_use_id || 'sent'), { flag: 'wx' }); return ''; }
  catch { return refusal(guard, name, input, 1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    /** @type {any} */ let call = {};
    /** @type {HookLimits} */ let limits = { allowed: [], reason: 'The map could not read the limits of this run, so it refuses every tool.', commands: [], commandReason: '' };
    try { call = JSON.parse(input); } catch { /* an unreadable call has no tool name, so it is denied */ }
    try { limits = JSON.parse(process.argv[2] || ''); } catch { /* unreadable limits keep the empty list above, which denies everything */ }
    const why = decide(limits, call);
    if (why) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }));
  });
}
