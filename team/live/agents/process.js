// What every agent process the map starts has in common, whichever agent it is: how it is stopped, and how its
// output is read line by line.

// every process still running, by the function that stops it: none outlives the server
/** @type {Set<(signal: NodeJS.Signals) => void>} */
const active = new Set();
process.once('exit', () => { for (const kill of active) kill('SIGKILL'); });

// Stops a process started detached together with whatever it started (its whole group); on Windows, or before
// it has a pid, the process alone. `done()` when it has ended, so the server stops keeping track of it.
/** @param {import('node:child_process').ChildProcess} proc */
export function killer(proc) {
  /** @param {NodeJS.Signals} signal */
  const kill = (signal) => { try { if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, signal); else proc.kill(signal); } catch { /* Already exited. */ } };
  active.add(kill);
  return { kill, done: () => { active.delete(kill); } };
}

// Reads a process's output as UTF-8, a whole line at a time: a character or a line split across two chunks is
// put back together. Output with no line break for 2 MB is dropped, so a runaway process cannot fill memory.
// Returns `flush`, for the last line when the process closes without ending it.
/** @param {import('node:child_process').ChildProcessWithoutNullStreams} proc @param {(line: string) => void} read */
export function readLines(proc, read) {
  let buffer = '';
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let nl; (nl = buffer.indexOf('\n')) >= 0;) { read(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    if (buffer.length > 2_000_000) buffer = '';
  });
  return () => { if (buffer) read(buffer); };
}
