import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const script = path.join(import.meta.dirname, 'preview.sh');

// Run the real launcher with stand-ins for processes, so a regression cannot stop anyone's map.
function preview(saved, action = 'start', node = 'node') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-'));
  const bin = path.join(root, 'bin'), data = path.join(root, '.preview');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(data, 'data'), { recursive: true });
  fs.writeFileSync(path.join(data, 'port'), `${saved}\n`);
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub('git', `case "$*" in
    *'rev-parse --show-toplevel'*) echo "$TEST_ROOT" ;;
    *'worktree list --porcelain'*) echo "worktree $TEST_ROOT" ;;
    *'branch --show-current'*) echo codex/example ;;
  esac`);
  stub('lsof', `[ ! -f "$TEST_ROOT/killed" ] || exit 1
    case "$* " in *"-iTCP:$TEST_PORT "*) echo 12001 ;; *) exit 1 ;; esac`);
  stub('ps', `case "$*" in *12001*) echo "$TEST_NODE $TEST_ROOT/team/live/server.js $TEST_PORT" ;; esac`);
  stub('curl', 'exit 0');
  // The real nohup still detaches its child; /usr/bin/true keeps this stand-in immediate.
  stub('nohup', 'exec /usr/bin/true');
  const shell = path.join(root, 'shell');
  fs.writeFileSync(shell, 'kill() { echo "$*" >> "$TEST_ROOT/killed"; }\n');
  try {
    const out = execFileSync('bash', [script, action, root], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BASH_ENV: shell, TEST_ROOT: root, TEST_PORT: String(saved), TEST_NODE: node, ANUR_LIVING_MAP_DATA: root },
    });
    return {
      out,
      port: fs.existsSync(path.join(data, 'port')) ? fs.readFileSync(path.join(data, 'port'), 'utf8').trim() : '',
      killed: fs.existsSync(path.join(root, 'killed')) ? fs.readFileSync(path.join(root, 'killed'), 'utf8').trim() : '',
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

it.each([4323, 4400, 4500, 'not-a-port'])('replaces a saved port outside the preview range: %s', (port) => {
  const result = preview(port);
  expect(result.port).toBe('4401');
  expect(result.killed).toBe('');
  expect(result.out).toContain('http://codex-example.localhost:4401');
});

it.each([4323, 4400])('never stops a reserved port even if this checkout served it: %s', (port) => {
  const result = preview(port, 'stop');
  expect(result.killed).toBe('');
});

it('recognizes an absolute Node path and restarts its own preview on the same port', () => {
  const result = preview(4405, 'start', '/opt/node/bin/node');
  expect(result.port).toBe('4405');
  expect(result.killed).toBe('12001');
});
