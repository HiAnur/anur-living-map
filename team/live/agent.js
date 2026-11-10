// The agent the team map works with: `agent` for the map's own work, `chats` for your own chats the map follows
// and opens. Everything goes through these two objects; to use another agent, add a folder beside
// agents/claude-code that implements AgentWorker and AgentConversation (types.d.ts) and return them here.
import { claudeCode, claudeCodeChats } from './agents/claude-code/index.js';

/** @type {AgentWorker} */
export const agent = claudeCode();
/** @type {AgentConversation} */
export const chats = claudeCodeChats();
