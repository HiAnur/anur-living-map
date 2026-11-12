import { describe, expect, it, vi } from 'vitest';

import { agentName, allChats } from './agent.js';

// Which agent does the map's own work, and how chats from every agent reach the one that owns them.
describe('agentName', () => {
  it('is the one named, else the one whose chat started the server, else Claude Code', () => {
    expect(agentName({ LIVING_MAP_AGENT: 'pi' })).toBe('pi');
    expect(agentName({ LIVING_MAP_AGENT: 'Claude', PI_CODING_AGENT: 'true' })).toBe('claude');
    expect(agentName({ PI_CODING_AGENT: 'true' })).toBe('pi');
    expect(agentName({ AI_AGENT: 'pi' })).toBe('pi');
    expect(agentName({ LIVING_MAP_AGENT: 'other' })).toBe('claude');
    expect(agentName({})).toBe('claude');
  });
});

describe('allChats', () => {
  /** @param {string} root @param {string} name @returns {AgentConversation & { followed: string[] }} */
  const chatsAt = (root, name) => {
    /** @type {string[]} */ const followed = [];
    return { followed,
      follow: (file) => { followed.push(file); return /** @type {any} */ ({}); },
      owns: (file) => file.startsWith(root), sessionOf: (file) => `${name}:${file}`,
      findChat: (s) => (s === `${name}-chat` ? `${root}/${s}` : null), findNewChat: () => null,
      isChat: (file) => file.startsWith(root), openNew: vi.fn(), skillDir: (n) => `${root}/skills/${n}`, connectTools: () => (name === 'pi' ? 'Pi told' : '') };
  };
  it('follows each chat with the agent that owns it, finds chats in every agent, and opens new ones in the map\'s own', () => {
    const claude = chatsAt('/claude', 'claude'), pi = chatsAt('/pi', 'pi'), all = allChats([claude, pi]);
    all.follow('/pi/a.jsonl', () => {}); all.follow('/claude/b.jsonl', () => {});
    expect(pi.followed).toEqual(['/pi/a.jsonl']);
    expect(claude.followed).toEqual(['/claude/b.jsonl']);
    expect(all.findChat('pi-chat')).toBe('/pi/pi-chat');
    expect(all.isChat('/pi/x', 's')).toBe(true);
    expect(all.isChat('/elsewhere/x', 's')).toBe(false);
    expect(all.sessionOf?.('/pi/a.jsonl')).toBe('pi:/pi/a.jsonl');
    all.openNew({ prompt: 'p', folder: '/f' });
    expect(claude.openNew).toHaveBeenCalled();
    expect(pi.openNew).not.toHaveBeenCalled();
    expect(all.skillDirs?.('s')).toEqual(['/claude/skills/s', '/pi/skills/s']);
    expect(all.connectTools()).toBe('Pi told');
  });
});
