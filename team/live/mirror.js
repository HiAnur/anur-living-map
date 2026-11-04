// The map's Claude pane, synced with a Claude Code chat: follow that chat's transcript
// (~/.claude/projects/<project>/<chat id>.jsonl) as it grows and keep what you typed, the pictures you
// attached, and what Claude wrote back, one Claude message per turn. Tool calls and their output, reminders, side
// agents and anything the app sent in your place (task notifications, messages from other chats)
// are left out. Read by byte offset once a second, whole lines only: the last one may still be
// being written.

import fs from 'node:fs';
import crypto from 'node:crypto';

const KEEP = 600;

// what a transcript entry says in words: a string, or its text blocks
const words = (c) => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
// the pictures attached to it, as they sit in the transcript: base64 with their type
const pictures = (c) => Array.isArray(c) ? c.filter((b) => b?.type === 'image' && b.source?.type === 'base64' && b.source.data) : [];

// your words without what the app wraps around them; a slash command reads as you typed it
function yours(text) {
  const cmd = text.match(/<command-name>\/?([^<]+)<\/command-name>/);
  if (cmd) { const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim(); return `/${cmd[1].trim()}${args ? ` ${args}` : ''}`; }
  const t = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  return /^<[a-z-]+>/.test(t) ? '' : t;
}

// a step Claude takes, said the way the Claude app says it while it works
function plainStep(b) {
  const n = String(b.name || ''), i = b.input || {}, file = (p) => String(p || '').split('/').pop();
  if (n === 'Read') return `Reading ${file(i.file_path)}`;
  if (n === 'Grep' || n === 'Glob') return 'Searching files';
  if (n === 'Bash') return i.description || 'Running a command';
  if (n === 'Edit' || n === 'Write' || n === 'NotebookEdit') return `Editing ${file(i.file_path || i.notebook_path)}`;
  if (n === 'WebSearch') return i.query ? `Searching the web: ${i.query}` : 'Searching the web';
  if (n === 'WebFetch') return 'Reading a web page';
  if (n === 'Skill') return `Using ${i.skill || 'a skill'}`;
  if (n === 'Agent' || n === 'Task') return i.description ? `A helper is ${i.description.replace(/^./, (c) => c.toLowerCase())}` : 'Asking a helper';
  if (n === 'ToolSearch') return 'Loading its tools';
  if (/living_map_change$/.test(n)) return 'Drawing on the map';
  if (/living_map_read$/.test(n)) return 'Reading the map';
  const t = n.split('__').pop().replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// anyUser: a chat the map started itself (claude -p) records your words without marking them as typed by a
// person, so every user entry with words counts as yours there
export function follow(file, onChange, { anyUser = false } = {}) {
  let offset = 0, rest = '', msgs = [], busy = false, model = null;
  // whether Claude is in the middle of a turn, what it is doing now, when it last did anything, and since when it works
  let state = { working: false, doing: '', at: 0 };
  // each picture you attached, once, by a hash of its bytes; a message names its pictures by that id
  const imgs = new Map();
  const keep = (c) => pictures(c).map((b) => {
    const id = crypto.createHash('sha1').update(b.source.data).digest('hex').slice(0, 16);
    imgs.set(id, { type: b.source.media_type || 'image/png', data: b.source.data }); return id;
  });
  // each piece of Claude's words keeps its own time, so what you write from the map falls between them
  // in the right place; the page draws a run of Claude's pieces as one message
  const add = (who, text, at, pics = []) => msgs.push({ who, text, at, ...(pics.length ? { imgs: pics } : {}) });
  const yourTurn = (c, at) => { const t = yours(words(c)), p = keep(c); if (t || p.length) add('you', t, at, p); };
  function line(raw) {
    let j; try { j = JSON.parse(raw); } catch { return; }
    if (j.isSidechain) return;
    const at = Date.parse(j.timestamp) || Date.now();
    if (j.type === 'user' && (j.origin?.kind === 'human' || (anyUser && !j.toolUseResult)) && !j.isMeta) {
      yourTurn(j.message?.content, at);
      state = { working: true, doing: '', at, since: at };
    } else if (j.type === 'attachment' && j.attachment?.type === 'queued_command' && j.attachment.commandMode === 'prompt' && j.attachment.origin?.kind === 'human') {
      // what you typed while Claude was still working
      yourTurn(j.attachment.prompt, at);
    } else if (j.type === 'assistant') {
      // the model and effort the chat answers with, as of its latest reply
      if (/^claude-/.test(j.message?.model || '')) model = { id: j.message.model, effort: j.effort || j.perTurnEffort || null };
      const t = (j.message?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
      if (t) add('claude', t, at);
      // still at it until a reply ends the turn; the step it is on, in plain words
      const step = (j.message?.content || []).filter((b) => b?.type === 'tool_use').at(-1);
      state = j.message?.stop_reason === 'end_turn' ? { working: false, doing: '', at } : { working: true, doing: step ? plainStep(step) : state.doing, at, since: state.working ? state.since : at };
    } else if (j.type === 'user' && state.working) state = { ...state, at };
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
        const lines = (rest + buf.toString('utf8')).split('\n'); rest = lines.pop();
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
  return { stop: () => clearInterval(timer), msgs: () => msgs, img: (id) => imgs.get(id), model: () => model, status: () => state };
}
