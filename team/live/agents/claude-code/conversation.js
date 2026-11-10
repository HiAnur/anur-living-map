import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { follow } from './transcript.js';

// Your own Claude Code chats, as the map meets them: Claude Code writes each chat's transcript to
// ~/.claude/projects/<its folder, - for every other character>/<chat id>.jsonl, opens a new chat in the Claude
// app from a claude:// link, keeps skills in ~/.claude/skills, and reaches MCP servers registered with `claude mcp add`.
/** @param {{ home?: string, run?: typeof execFileSync, open?: typeof spawn }} [deps] */
export function claudeCodeChats({ home = os.homedir(), run = execFileSync, open = spawn } = {}) {
  const projects = path.join(home, '.claude', 'projects');
  /** @type {AgentConversation} */
  const chats = {
    follow,
    findChat(session) {
      const dir = fs.existsSync(projects) && fs.readdirSync(projects).find((d) => fs.existsSync(path.join(projects, d, `${session}.jsonl`)));
      return dir ? path.join(projects, dir, `${session}.jsonl`) : null;
    },
    findNewChat({ folder, since, holding }) {
      const dir = path.join(projects, folder.replace(/[^a-zA-Z0-9]/g, '-'));
      return (fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f))
        .find((f) => fs.statSync(f).birthtimeMs >= since && fs.readFileSync(f, 'utf8').includes(holding))) || null;
    },
    isChat: (file, session) => /^[\w-]{8,80}$/.test(session) && file.endsWith(`/${session}.jsonl`) && file.includes('/.claude/projects/') && fs.existsSync(file),
    openNew({ prompt, folder }) {
      open('open', [`claude://code/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(folder)}`]).on('error', () => {});
    },
    skillDir: (name) => path.join(home, '.claude', 'skills', name),
    // the map's MCP server, registered once for every chat as anur-living-map; this same package runs it, so the
    // path never goes stale. One registered under its old name, living-map, keeps working and is not added twice.
    connectTools() {
      const claude = (/** @type {string[]} */ ...a) => { try { run('claude', a, { stdio: 'pipe' }); return true; } catch { return false; } };
      if (claude('mcp', 'get', 'anur-living-map') || claude('mcp', 'get', 'living-map')) return '';
      return claude('mcp', 'add', '--scope', 'user', 'anur-living-map', '--', 'npx', '-y', 'anur-living-map', 'mcp')
        ? 'Claude Code can now read and change the map (anur-living-map MCP). Start a new chat to use it.'
        : 'Claude Code was not found on PATH, so the map is not registered with it yet. Later: claude mcp add --scope user anur-living-map -- npx -y anur-living-map mcp';
    },
  };
  return chats;
}
