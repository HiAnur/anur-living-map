// Your own Pi chats, as the map meets them: Pi writes each chat to
// ~/.pi/agent/sessions/--<its folder, / \ and : as ->--/<time>_<chat id>.jsonl, runs in a terminal, keeps skills in
// ~/.agents/skills (the Agent Skills folder other agents read too), and reaches MCP servers registered with
// `pi mcp add`. The map hears a Pi chat through ./listener.js.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEEP = 600;

/** @param {string} home */
const agentDir = (home) => process.env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
/** @param {string} home */
const sessionsDir = (home) => process.env.PI_CODING_AGENT_SESSION_DIR || path.join(agentDir(home), 'sessions');
// a chat's id is what follows the time in its file's name
/** @param {string} file */
export const sessionOf = (file) => path.basename(file, '.jsonl').replace(/^[^_]*_/, '');

// a step Pi takes, in plain words, as the map's pane says it while Pi works
/** @param {any} b a tool call as the transcript has it */
function plainStep(b) {
  const n = String(b.name || ''), i = b.arguments || {}, file = (/** @type {unknown} */ p) => String(p || '').split('/').pop();
  if (n === 'read') return `Reading ${file(i.path)}`;
  if (n === 'grep' || n === 'find' || n === 'ls') return 'Searching files';
  if (n === 'bash') return 'Running a command';
  if (n === 'edit' || n === 'write') return `Editing ${file(i.path)}`;
  if (n === 'tool_search') return 'Loading its tools';
  if (/living_map_change$/.test(n)) return 'Drawing on the map';
  if (/living_map_read$/.test(n)) return 'Reading the map';
  const t = /** @type {string} */ (n.split('__').pop()).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The map's chat pane, synced with a Pi chat: what you typed, the pictures you attached, and what Pi wrote back.
 * Tool calls and their output, and what the map's own extension posted in your place (role custom), are left out.
 * Entries are read in the order Pi wrote them; read by byte offset once a second, whole lines only.
 * @param {string} file @param {(msgs: any[]) => void} onChange
 */
export function follow(file, onChange) {
  let offset = 0, rest = '', /** @type {any[]} */ msgs = [], busy = false, /** @type {{ id: string, effort: string | null } | null} */ model = null;
  /** @type {{ working: boolean, doing: string, at: number, since?: number }} */
  let state = { working: false, doing: '', at: 0 };
  const imgs = new Map();
  /** @param {string} who @param {string} text @param {number} at @param {string[]} [pics] */
  const add = (who, text, at, pics = []) => msgs.push({ who, text, at, ...(pics.length ? { imgs: pics } : {}) });
  /** @param {string} raw */
  function line(raw) {
    let j; try { j = JSON.parse(raw); } catch { return; }
    if (j?.type !== 'message' || !j.message) return;
    const m = j.message, at = Date.parse(j.timestamp) || m.timestamp || Date.now();
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];
    const text = blocks.filter((/** @type {any} */ b) => b?.type === 'text').map((/** @type {any} */ b) => b.text).join('\n').trim();
    if (m.role === 'user') {
      const pics = blocks.filter((/** @type {any} */ b) => b?.type === 'image' && b.data).map((/** @type {any} */ b) => {
        const id = crypto.createHash('sha1').update(b.data).digest('hex').slice(0, 16);
        imgs.set(id, { type: b.mimeType || 'image/png', data: b.data }); return id;
      });
      if (text || pics.length) add('you', text, at, pics);
      state = { working: true, doing: '', at, since: at };
    } else if (m.role === 'assistant') {
      if (m.model) model = { id: String(m.model), effort: m.thinkingLevel || null };
      if (text) add('claude', text, at);
      const step = blocks.filter((/** @type {any} */ b) => b?.type === 'toolCall').at(-1);
      state = m.stopReason === 'toolUse' ? { working: true, doing: step ? plainStep(step) : state.doing, at, since: state.working ? state.since : at }
        : { working: false, doing: '', at };
    } else if (state.working) state = { ...state, at };
  }
  function read() {
    let grew = false;
    if (busy) return; busy = true;
    try {
      const size = fs.statSync(file).size;
      if (size < offset) { offset = 0; rest = ''; msgs = []; }
      if (size > offset) {
        const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd); offset = size;
        const lines = (rest + buf.toString('utf8')).split('\n'); rest = /** @type {string} */ (lines.pop());
        for (const l of lines) if (l) line(l);
        if (msgs.length > KEEP) {
          msgs = msgs.slice(-KEEP);
          const used = new Set(msgs.flatMap((m) => m.imgs || [])); for (const id of imgs.keys()) if (!used.has(id)) imgs.delete(id);
        }
        grew = true;
      }
    } catch { /* the file is gone or not there yet: try again next second */ } finally { busy = false; }
    if (grew) onChange(msgs);
  }
  const timer = setInterval(read, 1000);
  setImmediate(read);
  return { stop: () => clearInterval(timer), msgs: () => msgs, img: (/** @type {string} */ id) => imgs.get(id), model: () => model, status: () => state };
}

/** @param {{ home?: string, run?: typeof execFileSync, open?: typeof spawn }} [deps] */
export function piChats({ home = os.homedir(), run = execFileSync, open = spawn } = {}) {
  const sessions = () => sessionsDir(home);
  const inSessions = (/** @type {string} */ file) => path.resolve(file).startsWith(path.resolve(sessions()) + path.sep);
  /** @type {AgentConversation} */
  const chats = {
    follow,
    owns: inSessions,
    sessionOf,
    findChat(session) {
      const root = sessions();
      if (!/^[\w-]{8,80}$/.test(session) || !fs.existsSync(root)) return null;
      for (const d of fs.readdirSync(root)) {
        const dir = path.join(root, d), f = fs.statSync(dir).isDirectory() && fs.readdirSync(dir).find((n) => n.endsWith(`_${session}.jsonl`));
        if (f) return path.join(dir, f);
      }
      return null;
    },
    findNewChat({ folder, since, holding }) {
      const dir = path.join(sessions(), `--${folder.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
      return (fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f))
        .find((f) => fs.statSync(f).birthtimeMs >= since && fs.readFileSync(f, 'utf8').includes(holding))) || null;
    },
    isChat: (file, session) => /^[\w-]{8,80}$/.test(session) && inSessions(file) && sessionOf(file) === session && fs.existsSync(file),
    // Pi runs in a terminal: a new Terminal window in the folder, with Pi started on the prompt. A skill is
    // called /skill:<name> in Pi.
    openNew({ prompt, folder }) {
      const q = prompt.replace(/^\/(?!skill:)([a-z0-9-]+)/, '/skill:$1');
      const sh = (/** @type {string} */ s) => `'${s.replaceAll("'", "'\\''")}'`;
      const script = `cd ${sh(folder)} && pi ${sh(q)}`;
      open('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(script)}`, '-e', 'tell application "Terminal" to activate'], { stdio: 'ignore' }).on('error', () => {});
    },
    skillDir: (name) => path.join(home, '.agents', 'skills', name),
    // the map's MCP server and the extension that lets the map wake a Pi chat, each added once; Pi reads both when
    // a chat starts or after /reload
    connectTools() {
      // someone without Pi is told nothing about it
      try { run('pi', ['--version'], { stdio: 'pipe' }); } catch { return ''; }
      const told = [];
      /** @type {any} */ let config = {};
      try { config = JSON.parse(fs.readFileSync(path.join(agentDir(home), 'mcp.json'), 'utf8')); } catch { /* none yet */ }
      if (!config.mcpServers?.['anur-living-map'] && !config.mcpServers?.['living-map']) {
        try {
          run('pi', ['mcp', 'add', 'anur-living-map', '--', 'npx', '-y', 'anur-living-map', 'mcp'], { stdio: 'pipe' });
          // declared to the model like built-in tools, so a chat calls living_map_change directly
          const file = path.join(agentDir(home), 'mcp.json'), added = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (added.mcpServers?.['anur-living-map']) { added.mcpServers['anur-living-map'].exposure = 'direct'; fs.writeFileSync(file, `${JSON.stringify(added, null, 2)}\n`); }
          told.push('Pi can now read and change the map (anur-living-map MCP).');
        }
        catch { return 'Pi could not register the map yet. Later: pi mcp add anur-living-map -- npx -y anur-living-map mcp'; }
      }
      if (installListener(home)) told.push('Pi now hears the map in its chats.');
      return told.length ? `${told.join(' ')} Start a new Pi chat, or type /reload in one, to use it.` : '';
    },
  };
  return chats;
}

// The extension that lets the map wake a Pi chat (./listener.js); Pi loads it from a one-line file in its extensions
// folder that points here, so it follows this copy's updates. True when the file was added.
/** @param {string} home */
export function installListener(home) {
  const src = new URL('./listener.js', import.meta.url).pathname;
  const dst = path.join(agentDir(home), 'extensions', 'anur-living-map.js');
  const line = `export { default } from ${JSON.stringify(src)};\n`;
  try { if (fs.readFileSync(dst, 'utf8') === line) return false; } catch { /* not there yet */ }
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, line);
  return true;
}
