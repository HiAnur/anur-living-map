// The agent the team map works with: `agent` for the map's own work, `chats` for your own chats the map follows
// and opens. Everything goes through these two objects. Each agent lives in a folder under agents/ that implements
// AgentWorker and AgentConversation (types.d.ts); to add one, add its folder and list it in AGENTS below.
//
// The map's own work runs on one agent: LIVING_MAP_AGENT (claude or pi) when set, otherwise the one whose chat
// started this server, otherwise Claude Code. Chats from every listed agent are followed at once, each by the
// agent whose transcript it is, so a Claude Code chat and a Pi chat can both open and hear the same map.
import { claudeCode, claudeCodeChats } from './agents/claude-code/index.js';
import { pi, piChats } from './agents/pi/index.js';

const AGENTS = {
  claude: { worker: claudeCode, chats: claudeCodeChats },
  pi: { worker: pi, chats: piChats },
};
/** @param {Record<string, string | undefined>} env @returns {keyof typeof AGENTS} */
export function agentName(env = process.env) {
  const named = String(env.LIVING_MAP_AGENT || '').toLowerCase();
  if (named === 'claude' || named === 'pi') return named;
  return env.PI_CODING_AGENT === 'true' || env.AI_AGENT === 'pi' ? 'pi' : 'claude';
}

/**
 * Every agent's chats behind one AgentConversation: a transcript is followed and checked by the agent that owns it,
 * a chat is looked for in each, and a new chat opens in the agent the map works with.
 * @param {AgentConversation[]} all the first is the agent the map works with
 * @returns {AgentConversation}
 */
export function allChats(all) {
  const [main] = all;
  const owner = (/** @type {string} */ file) => all.find((c) => c.owns?.(file)) || main;
  return {
    follow: (file, onChange, options) => owner(file).follow(file, onChange, options),
    owns: (file) => all.some((c) => c.owns?.(file)),
    sessionOf: (file) => owner(file).sessionOf?.(file) ?? file.split('/').pop()?.replace(/\.jsonl$/, '') ?? '',
    findChat: (session) => all.map((c) => c.findChat(session)).find(Boolean) || null,
    findNewChat: (o) => all.map((c) => c.findNewChat(o)).find(Boolean) || null,
    isChat: (file, session) => all.some((c) => c.isChat(file, session)),
    openNew: (o) => main.openNew(o),
    skillDir: (name) => main.skillDir(name),
    skillDirs: (name) => all.map((c) => c.skillDir(name)),
    connectTools: () => all.map((c) => c.connectTools()).filter(Boolean).join('\n'),
  };
}

const name = agentName();
/** @type {AgentWorker} */
export const agent = AGENTS[name].worker();
/** @type {AgentConversation} */
export const chats = allChats([AGENTS[name].chats(), ...Object.entries(AGENTS).filter(([n]) => n !== name).map(([, a]) => a.chats())]);
