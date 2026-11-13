// The Pi extension every process the map starts loads (`pi -e <this file>`). It reads the job from the file
// LIVING_MAP_PI_JOB names and gives Pi what Claude Code takes as flags: the map's own MCP servers for this run only,
// a `submit_answer` tool held to the job's schema (Pi has no --json-schema; the run ends on that call), and the
// limits a hook enforces in Claude Code: tools outside `allow` and shell commands matching `block` are refused.
import fs from 'node:fs';

import { refusal, sendsTool } from '../../action-sends.js';

export const SUBMIT = 'submit_answer';

/** @param {any} pi the ExtensionAPI */
export default function mapJob(pi) {
  const file = process.env.LIVING_MAP_PI_JOB;
  if (!file) return;
  /** @type {PiJob} */
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  // each server's listed tools are declared to the model like built-in ones; anything else it offers stays out of reach
  for (const [name, { tools, ...run }] of Object.entries(job.servers || {}))
    pi.registerMcpServer(name, { ...run, exposure: 'hidden', toolExposure: Object.fromEntries(tools.map((t) => [t, 'direct'])) });
  if (job.schema) pi.registerTool({
    name: SUBMIT, label: 'Answer',
    description: 'Return your final answer, held to this schema. Call it exactly once, as your last action; nothing you write after it is read.',
    promptSnippet: 'Return the final answer with submit_answer',
    promptGuidelines: ['End every run with one call to submit_answer holding the whole answer. Words in your reply are not read as the answer.'],
    parameters: job.schema,
    async execute(/** @type {string} */ _id, /** @type {unknown} */ params) {
      return { content: [{ type: 'text', text: 'Received.' }], details: params, terminate: true };
    },
  });
  const allow = job.allow && new Set([...job.allow, SUBMIT]);
  const block = (job.block || []).map((r) => new RegExp(r));
  // an Action run's sends are checked against the reviewed message, and counted, in this one process
  let sent = 0;
  if (allow || block.length || job.guard) pi.on('tool_call', (/** @type {any} */ e) => {
    if (allow && !allow.has(e.toolName)) return { block: true, reason: job.allowReason || 'This run cannot use that tool.' };
    if (e.toolName === 'bash' && block.some((r) => r.test(String(e.input?.command || '')))) return { block: true, reason: job.blockReason || 'This run cannot run that command.' };
    const why = refusal(job.guard, e.toolName, e.input, sent);
    if (why) return { block: true, reason: why };
    if (job.guard?.message && sendsTool(e.toolName)) sent++;
    return undefined;
  });
}
