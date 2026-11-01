// The map's Claude pane, synced with a Claude Code chat: follow that chat's transcript
// (~/.claude/projects/<project>/<chat id>.jsonl) as it grows and keep what you typed and what
// Claude wrote back, one Claude message per turn. Tool calls and their output, reminders, side
// agents and anything the app sent in your place (task notifications, messages from other chats)
// are left out. Read by byte offset once a second, whole lines only: the last one may still be
// being written.

import fs from 'node:fs';

const KEEP = 600;

// what a transcript entry says in words: a string, or text blocks; an image is a marker
const words = (c) => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((b) => b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '').filter(Boolean).join('\n') : '';

// your words without what the app wraps around them; a slash command reads as you typed it
function yours(text) {
  const cmd = text.match(/<command-name>\/?([^<]+)<\/command-name>/);
  if (cmd) { const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim(); return `/${cmd[1].trim()}${args ? ` ${args}` : ''}`; }
  const t = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  return /^<[a-z-]+>/.test(t) ? '' : t;
}

export function follow(file, onChange) {
  let offset = 0, rest = '', msgs = [], busy = false;
  // each piece of Claude's words keeps its own time, so what you write from the map falls between them
  // in the right place; the page draws a run of Claude's pieces as one message
  const add = (who, text, at) => msgs.push({ who, text, at });
  function line(raw) {
    let j; try { j = JSON.parse(raw); } catch { return; }
    if (j.isSidechain) return;
    const at = Date.parse(j.timestamp) || Date.now();
    if (j.type === 'user' && j.origin?.kind === 'human' && !j.isMeta) {
      const t = yours(words(j.message?.content)); if (t) add('you', t, at);
    } else if (j.type === 'attachment' && j.attachment?.type === 'queued_command' && j.attachment.commandMode === 'prompt' && j.attachment.origin?.kind === 'human') {
      // what you typed while Claude was still working
      const t = yours(words(j.attachment.prompt)); if (t) add('you', t, at);
    } else if (j.type === 'assistant') {
      const t = (j.message?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
      if (t) add('claude', t, at);
    }
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
        if (msgs.length > KEEP) msgs = msgs.slice(-KEEP);
        grew = true;
      }
    } catch { /* the file is gone or not there yet: try again next second */ } finally { busy = false; }
    if (grew) onChange(msgs);
  }
  const timer = setInterval(read, 1000);
  setImmediate(read);
  return { stop: () => clearInterval(timer), msgs: () => msgs };
}
