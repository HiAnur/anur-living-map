#!/usr/bin/env node
// `npx anur-living-map` in a code folder: the one-line install.
//
//   anur-living-map [folder] [--port 4323] [--no-open]   start (or join) the map and open it
//   anur-living-map mcp                                   what Claude Code runs to talk to the map
//   anur-living-map reset <name> [--port 4323]            print a one-use link to choose a new password
//
// It starts the team map server for the folder if none is running, or adds the folder to
// the server already running; registers the map's MCP server with the agent once (agent.js);
// installs the /anur-living-map skill, the same copy open-map.sh and `npm run skill` make;
// and opens the folder's map in the browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NODE_NEEDED, nodeTooOld } from './node-version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The Node the map needs (node-version.js), before anything else: older Node fails later with an
// error that says nothing about Node, so say it here, with how to get it, and stop.
if (nodeTooOld(process.versions.node)) {
  console.error(
    `Living Map needs ${NODE_NEEDED}; this is Node ${process.versions.node}.\n` +
      'Install it, then run npx anur-living-map again:\n' +
      '  Homebrew (Mac):   brew install node\n' +
      '  nvm:              nvm install 24 && nvm use 24\n' +
      '  anything else:    https://nodejs.org, the LTS download',
  );
  process.exit(1);
}

const args = process.argv.slice(2);

if (args[0] === 'mcp') {
  await import('./mcp.js');
} else if (args[0] === 'reset') {
  const { cli } = await import('./users.js');
  process.exitCode = await cli(args);
} else {
  /** @param {string} name */
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1] || 'true'; };
  const port = Number(flag('--port') || process.env.LIVING_MAP_PORT || 4323);
  const folder = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') || process.cwd());
  // the map's address, until the server says it: the folder's name in lowercase letters, digits and dashes
  let name = path.basename(folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const base = `http://localhost:${port}`;
  const { DATA } = await import('./data-dir.js');
  const log = path.join(DATA, `server-${port}.log`);

  const up = async () => { try { return (await fetch(`${base}/api/maps`)).ok; } catch { return false; } };

  // the folder on the server's list (nothing changes when it is there already); the server names its map, which
  // may be the folder's title rather than its name
  const add = async () => {
    const r = await fetch(`${base}/api/projects`, { method: 'POST', body: JSON.stringify({ folder }) });
    const got = await r.json().catch(() => ({}));
    if (!r.ok) console.log(got.error || `The map at ${base} could not add ${folder}.`);
    else if (got.name) name = got.name;
  };
  if (await up()) await add();
  else {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [path.join(here, 'server.js'), String(port), '--project', folder], {
      detached: true, stdio: ['ignore', out, out], env: { ...process.env, PORT: String(port) },
    });
    child.unref();
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise((ok) => setTimeout(ok, 100));
    if (!(await up())) { console.log(`The map server did not start. Its log is ${log}.`); process.exit(1); }
    await add();
  }

  // the agent reaches the map through its MCP server, registered once
  const { chats } = await import('./agent.js');
  const told = chats.connectTools();
  if (told) console.log(told);
  // and the skill that opens it from a chat: from the clone this runs in, else the copy packed with the package
  const { copySkill } = await import('./skill-copy.js');
  const skill = [path.join(here, '..', 'skill', 'anur-living-map'), path.join(here, 'skill')].find((d) => fs.existsSync(path.join(d, 'SKILL.md')));
  const skillDir = chats.skillDir('anur-living-map');
  if (!skill) console.log('The /anur-living-map skill is not in this copy, so it was not installed.');
  else if (copySkill(skill, skillDir)) console.log(`Installed the /anur-living-map skill in ${skillDir}: type /anur-living-map in a chat in this repo.`);

  const url = `${base}/${name}/`;
  console.log(`Living Map for ${folder}: ${url}`);
  if (!args.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
  }
}
