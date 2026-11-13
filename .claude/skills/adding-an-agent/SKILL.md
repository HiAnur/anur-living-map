---
name: adding-an-agent
description: Adds another agent (another vendor, the API, a local model) behind Living Map's agent seam, for the chat map, the team map or both, and checks nothing outside it knows Claude Code. Use when wiring a new agent, changing what the map asks of an agent, or when the seam check in server/providers/seam.test.ts fails.
---

# Adding an agent

Each product reaches its agent through one seam. Claude Code is the only agent today; its folders show every part.

| | Chat map | Team map |
|---|---|---|
| Interfaces | `AgentWorker`, `AgentConversation`, `Agent` in `server/providers/types.ts` | `AgentWorker`, `AgentConversation`, `McpServer` in `team/live/types.d.ts` |
| Claude Code | `server/providers/claude-code.ts`, `claude-sessions.ts`, `claude-transcript.ts` | `team/live/agents/claude-code/` |
| Picked in | `server/providers/index.ts` (`PROVIDERS`, chosen by `LIVING_MAP_PROVIDER`) | `team/live/agent.js` (`agent`, `chats`) |
| Its skill | `skill/` | `team/skill/` |

## What an agent provides

Chat map (`Agent`; every part but `readMore` is optional, and the map leaves out what is missing):

- `extract(request)`: one answer held to `request.schema`, no tools. Files a chat's turns.
- `openChat(request, on)`: a read-only chat over `request.cwd` and `request.dir`. When `request.propose` is set, offer that one tool and send each call as a `{ type: "propose", input }` event; never show it as a tool read.
- `judgmentModel(asked)`: the model for judgment work; return `""` for one too small to judge.
- `readMore(t, file)`: what was appended to a chat since `t.offset`, as the map's own `Entry` values (`ledger/transcript/entry.ts`). Put task-list changes in `Entry.tasks` as `TaskStep`s, and questions and picks in `asked` and `picked`.
- `findConversation(hint)` and `successor(file, id)`: find a chat to link, and where a resumed chat goes on.

Team map (`AgentWorker` and `AgentConversation`):

- `ask`, `prepare`, `run`, `converse`, `signIn`, `signedOut`. Each job carries the map's prompt, schema and MCP servers, each server listing the tools it may call. Name and allow those tools the way your agent does. `run` may use only `job.tools` plus a fixed read-only set; enforce that in the agent, as `runSettings` in `agents/claude-code/run.js` does, and refuse any call `refusal(job.guard, tool, input, sent)` in `team/live/action-sends.js` refuses before it runs (`agents/pi/extension.js` does it in Pi). `converse` may use only its job's `servers` (the map's own tools, pinned to that map): none of the person's settings, MCP servers or context files, and every other tool refused, as `agents/claude-code/converse.js` does. `ask` may also get `dirs`, more folders it may read (a system map's code), read-only like its own folder. `answer` gives one reply held to `job.schema`, with no tools.
- `follow`, `findChat`, `findNewChat`, `isChat`, `openNew`, `skillDir`, `connectTools` for your own chats.

## Steps

1. Chat map: add `server/providers/<agent>.ts` implementing `Agent`, and add it to `PROVIDERS` in `server/providers/index.ts`.
2. Team map: add `team/live/agents/<agent>/index.js` returning an `AgentWorker` and an `AgentConversation`, typed in JSDoc against `team/live/types.d.ts`, and return them from `team/live/agent.js`. Keep it JavaScript with no install: the team package runs on Node 22.
3. Copy the scripted agents in `ledger/agent.test.ts` and `team/live/agent.test.js` into tests of your agent's own parsing and arguments, the way `claude-code.test.ts` and `agents/claude-code/*.test.js` test Claude Code.
4. If the agent's folder is new, add it to `ADAPTERS` in `server/providers/seam.test.ts`.
5. Try it on a test server: `LIVING_MAP_HOME=<test home> PORT=<not 4317> LIVING_MAP_PROVIDER=<agent> node server/index.ts`.

## Rules

- Only an agent's own folders start its process, pass its flags, read its home folder or import its modules. `server/providers/seam.test.ts` fails otherwise.
- What an agent returns is untrusted: the map checks it (`apply.ts`, `checkProposal`, `check` in `team/live/proposal-check.js`) before it reaches a store. Hand it over as data; never parse proposals out of prose.
- The team package ships by pattern; `team/live/package.test.js` fails when a packed file reaches one that is not packed.

## Check

```bash
npm run check && npm run build && python3 .github/agent-docs/check.py
```
