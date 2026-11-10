// A chat as the map holds it: entries, the active path and turns. The agent
// reads its own transcript into entries (ReadMore, below); everything after
// that is a pure function of the entries, so a replay of the same transcript
// gives the same turns.
//
// What an entry holds is in transcript/entry.ts; how entries become turns,
// in transcript/turns.ts.

import type { Transcript } from "./transcript/entry.ts";

export {
  emptyTranscript,
  type Asked,
  type Entry,
  type Hunk,
  type Kind,
  type Picked,
  type TaskStatus,
  type TaskStep,
  type ToolChange,
  type Transcript,
} from "./transcript/entry.ts";
export {
  above,
  activePath,
  branches,
  buildTurns,
  isPrompt,
  lastSpoken,
  SEAL_IDLE_MS,
  sealedCount,
  view,
  type Turn,
  type View,
} from "./transcript/turns.ts";

// The agent's reader: what was appended to a chat's transcript since
// `t.offset`, as entries (AgentConversation.readMore). A file shorter than
// what was read was replaced: it is read again from the start.
export type ReadMore = (
  t: Transcript,
  file: string,
) => Promise<{ added: number; reset: boolean }>;
