#!/usr/bin/env node
// `npx anur-living-map` in a code folder: the one-line install.
//
//   anur-living-map [folder] [--port 4323] [--no-open]   start (or join) the map and open it
//   anur-living-map mcp                                   what Claude Code runs to talk to the map
//
// It starts the team map server for the folder if none is running, or adds the folder to
// the server already running; registers the map's MCP server with the agent once (agent.js);
// and opens the folder's map in the browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Node 22 or newer, before anything else: older Node fails later with an error that says
// nothing about Node, so say it here, with how to get it, and stop.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  console.error(
    `Living Map needs Node 22 or newer; this is Node ${process.versions.node}.\n` +
      'Install it, then run npx anur-living-map again:\n' +
      '  Homebrew (Mac):   brew install node\n' +
      '  nvm:              nvm install 22 && nvm use 22\n' +
      '  anything else:    https://nodejs.org, the LTS download',
  );
  process.exit(1);
}

const args = process.argv.slice(2);

if (args[0] === 'mcp') {
  await import('./mcp.js');
} else {
  /** @param {string} name */
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1] || 'true'; };
  const port = Number(flag('--port') || process.env.LIVING_MAP_PORT || 4323);
  const folder = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') || process.cwd());
  // the map's address is the folder's name in lowercase letters, digits and dashes, as the server names it
  const name = path.basename(folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const base = `http://localhost:${port}`;
  const log = path.join(os.homedir(), '.living-map-2', `server-${port}.log`);

  const up = async () => { try { return (await fetch(`${base}/api/maps`)).ok; } catch { return false; } };

  if (await up()) {
    // a server is already running: add this folder to it
    const r = await fetch(`${base}/api/projects`, { method: 'POST', body: JSON.stringify({ folder }) });
    if (!r.ok) console.log((await r.json()).error || `The map at ${base} could not add ${folder}.`);
  } else {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [path.join(here, 'server.js'), String(port), '--project', folder], {
      detached: true, stdio: ['ignore', out, out], env: { ...process.env, PORT: String(port) },
    });
    child.unref();
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise((ok) => setTimeout(ok, 100));
    if (!(await up())) { console.log(`The map server did not start. Its log is ${log}.`); process.exit(1); }
  }

  // the agent reaches the map through its MCP server, registered once
  const { chats } = await import('./agent.js');
  const told = chats.connectTools();
  if (told) console.log(told);

  const url = `${base}/${name}/`;
  console.log(`Living Map for ${folder}: ${url}`);
  if (!args.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
  }
}
