// Claude Code as the team map's agent: every process the map starts for its own work runs `claude` with the
// flags in this folder, and nothing outside it does. Another agent implements the same AgentWorker and
// AgentConversation.
import { childEnv, claudeLogin, SIGNED_OUT, streamClaude } from './ask.js';
import { answer } from './answer.js';
import { converse } from './converse.js';
export { claudeCodeChats } from './conversation.js';
import { prepareAction } from './prepare.js';
import { runAction } from './run.js';

/** @returns {AgentWorker} */
export const claudeCode = () => ({
  name: 'Claude Code',
  signedOut: SIGNED_OUT,
  signIn: claudeLogin,
  ask: streamClaude,
  prepare: (job) => prepareAction({ env: childEnv(), ...job }),
  run: (job) => runAction({ env: childEnv(), ...job }),
  converse,
  answer: (job) => answer(job),
});
