import { spawn } from 'node:child_process';

import { childEnv } from './ask.js';

// A chat the map runs itself, headless, one turn per call: claude -p in auto mode with nobody to ask, so anything
// auto mode would stop to ask about is refused. The first turn names the session; later ones resume it by id.
/** @param {ConverseJob} job */
export function converse({ cwd, session, first, title, system, prompt, onClose }) {
  const proc = spawn('claude', ['-p', ...(first ? ['--session-id', session, '--name', title] : ['--resume', session]),
    '--permission-mode', 'auto', '--permission-prompts', 'none', '--append-system-prompt', system, '--output-format', 'json'], { cwd, env: childEnv() });
  const limit = setTimeout(() => proc.kill('SIGTERM'), 20 * 60_000);
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {}); proc.stdin.on('error', () => {});
  proc.on('error', () => {});
  proc.on('close', () => { clearTimeout(limit); onClose(); });
  proc.stdin.end(prompt);
  return () => { proc.kill('SIGTERM'); };
}
