// What an Action run may send, checked by code on each tool call before it runs, from the call's own input: never
// from the tool's name alone, and never from what the model says it will do. Every agent's run hands its calls
// here (agents/claude-code/run.js through its PreToolUse hook, agents/pi/extension.js through its tool_call
// listener), so this file imports nothing and may be loaded on its own.

// Words in a tool's own name that mean it hands something to other people
const SENDS = new Set(['send', 'post', 'reply', 'forward', 'publish', 'comment', 'respond', 'broadcast', 'notify', 'invite', 'share']);
// A send of mail, as opposed to a chat message or a comment
const MAIL = /mail|outlook/i;
// The input fields a new message may carry. Anything else (a draft to send as it is, a message to reply to or
// forward, an HTML body, attachments, a signature) was not reviewed, so a call carrying it is refused.
const MESSAGE_FIELDS = new Set(['to', 'cc', 'bcc', 'subject', 'body']);
const QUIET = (/** @type {unknown} */ v) => v === undefined || v === null || v === false || v === '' || (Array.isArray(v) && !v.length);

/** The words of a tool's own name: `mcp__server__send_message` gives send and message. @param {string} tool */
const words = (tool) => String(tool).split('__').at(-1)?.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z]+/).filter(Boolean) || [];

/** Whether a tool sends, posts or replies to other people, read from its name. A draft that is only saved is not a send. @param {string} tool */
export function sendsTool(tool) {
  const w = words(tool);
  if (w.includes('draft') && !w.includes('send')) return false;
  return w.some((x) => SENDS.has(x));
}
/** Whether a tool sends mail. @param {string} tool */
export const mailTool = (tool) => sendsTool(tool) && MAIL.test(String(tool));

/** The addresses in a recipient field: a list, or one string split at commas or semicolons, each `Name <addr>` read as addr. @param {unknown} field @returns {string[]} */
export function addresses(field) {
  const list = Array.isArray(field) ? field : typeof field === 'string' ? field.split(/[,;]/) : [];
  return list.map((a) => (typeof a === 'string' ? a : typeof a?.address === 'string' ? a.address : typeof a?.email === 'string' ? a.email : ''))
    .map((a) => (/<([^<>]+)>\s*$/.exec(a)?.[1] ?? a).trim().toLowerCase()).filter(Boolean);
}
/** Text compared without the whitespace a mail tool may add or drop. @param {unknown} s */
const same = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : null);

/**
 * Why a send call is not the reviewed message, or '' when it is: to the one reviewed recipient, no one copied,
 * the reviewed subject and body, and nothing else.
 * @param {{ to: string, subject: string, body: string }} message @param {unknown} input
 */
export function notTheMessage(message, input) {
  const i = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const extra = Object.keys(i).filter((k) => !MESSAGE_FIELDS.has(k) && !(k === 'bodyType' && i[k] === 'text') && !QUIET(i[k]));
  if (extra.length) return `It carries ${extra.join(', ')}, which you did not review.`;
  const to = addresses(i.to);
  if (to.length !== 1 || to[0] !== message.to.trim().toLowerCase()) return `It goes to ${to.join(', ') || 'no one'}, not ${message.to}.`;
  const copied = [...addresses(i.cc), ...addresses(i.bcc)];
  if (copied.length) return `It copies ${copied.join(', ')}, who you did not review.`;
  if (same(i.subject) !== same(message.subject)) return 'Its subject is not the one you reviewed.';
  if (same(i.body) !== same(message.body)) return 'Its message is not the one you reviewed.';
  return '';
}

// Writes to GitHub or the web from the shell, refused in a run nobody clicked: what it makes stays on its branch
// until a person reviews it, and these reach people at once.
const WRITE = "['\"]?(POST|PUT|PATCH|DELETE|post|put|patch|delete)\\b";
const UNATTENDED = [
  /\bgh\s+pr\s+(comment|review|merge|close|reopen|edit|ready|lock|unlock)\b/,
  /\bgh\s+issue\s+(comment|create|close|reopen|edit|delete|transfer|lock|unlock|pin|unpin)\b/,
  new RegExp(`\\bgh\\s+api\\b[^;&|]*(\\s(-X|--method)[\\s=]*${WRITE}|\\s(-f|-F|--field|--raw-field|--input)\\b)`),
  new RegExp(`\\bcurl\\b[^;&|]*(\\s(-X|--request)[\\s=]*${WRITE}|\\s(-d|-F|-T|--data[\\w-]*|--form[\\w-]*|--json|--upload-file)\\b)`),
  /\bwget\b[^;&|]*\s--(post|body|method)/,
];

/**
 * Why an Action run may not make this call, or '' when nothing here stops it (its tool must still be one the
 * reviewed brief names, which the agent checks). `sent` is how many sends this run has already been let through.
 * @param {SendGuard | undefined} guard @param {string} tool @param {unknown} input @param {number} [sent]
 */
export function refusal(guard, tool, input, sent = 0) {
  if (!guard) return '';
  const command = /** @type {any} */ (input)?.command;
  if (guard.unattended && typeof command === 'string' && UNATTENDED.some((re) => re.test(command)))
    return 'This run started on its own, so it may not comment, review, merge or write to GitHub or the web. Leave that for a run the person starts, and finish the rest.';
  if (!sendsTool(tool)) return '';
  if (guard.message) {
    if (sent >= guard.left) return 'This Action already sent its one reviewed message. Do not send it again; report what was sent.';
    const why = notTheMessage(guard.message, input);
    return why ? `The map refused this send: ${why} Send exactly the reviewed recipient, subject and message, with no one else copied, or report that you cannot.` : '';
  }
  if (mailTool(tool)) return 'This Action has no reviewed email, so it may not send one.';
  return '';
}
