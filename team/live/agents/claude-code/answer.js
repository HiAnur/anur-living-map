import { spawn } from 'node:child_process';
import os from 'node:os';

import { childEnv } from './ask.js';
import { claudeEnv } from './process.js';

/**
 * One answer held to a JSON schema, with no tools, no MCP servers, no settings and no session kept: what drawing a
 * system map asks of the agent (the facts are in the prompt; the agent reads nothing else). Resolves with the
 * structured answer, or an error saying why there is none, and what the run cost.
 * @param {AnswerJob & { spawnProcess?: typeof spawn }} job
 * @returns {Promise<AnswerResult>}
 */
export function answer({ prompt, schema, model, timeoutMs = 300_000, signal, spawnProcess = spawn }) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--tools', '', '--no-session-persistence',
      '--setting-sources', '', '--strict-mcp-config', ...(model ? ['--model', model] : [])];
    const started = Date.now();
    const proc = spawnProcess('claude', args, { cwd: os.tmpdir(), env: claudeEnv(childEnv()), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    /** @param {AnswerResult} r */
    const finish = (r) => { if (done) return; done = true; clearTimeout(limit); signal?.removeEventListener('abort', stop); resolve(r); };
    const limit = setTimeout(() => { proc.kill(); finish({ error: 'The agent took too long to answer.', ms: Date.now() - started }); }, timeoutMs);
    const stop = () => { proc.kill(); finish({ error: 'Stopped.', stopped: true, ms: Date.now() - started }); };
    if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { err += d; });
    proc.on('error', () => finish({ error: 'Claude Code could not be started. Is it installed?', ms: Date.now() - started }));
    proc.on('close', () => {
      /** @type {any} */ let o = null;
      try { o = JSON.parse(out); } catch { /* not JSON: said below from what it printed */ }
      const cost = Number.isFinite(o?.total_cost_usd) ? { value: o.total_cost_usd, unit: 'usd' } : undefined;
      if (!o || o.is_error || !o.structured_output) {
        const said = String(o?.result || err || out).trim();
        return finish({ error: /log ?in|sign(ed)? ?(in|out)|authenticat/i.test(said) ? 'Claude Code is signed out.' : `The agent gave no answer: ${said.slice(0, 200)}`, cost, ms: Date.now() - started });
      }
      finish({ value: o.structured_output, cost, ms: o.duration_ms || Date.now() - started });
    });
    proc.stdin?.end(prompt);
  });
}
