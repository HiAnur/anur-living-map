// The agent the team map works with. Everything the map asks of it goes through this one object; to use another
// agent, add a folder beside agents/claude-code that implements AgentWorker (types.d.ts) and return it here.
import { claudeCode } from './agents/claude-code/index.js';

/** @type {AgentWorker} */
export const agent = claudeCode();
