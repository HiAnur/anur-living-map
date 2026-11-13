---
name: adding-an-agent
description: Adds another agent (another vendor, the API, a local model) behind the team map's agent seam, and checks nothing outside it knows Claude Code. Use when wiring a new agent into Anur Living Map, changing what the map asks of an agent, or when the seam check in team/live/seam.test.js fails.
---

# Adding an agent

Anur Living Map reaches its agent through one seam. The chat map (`server/`, `skill/`) is retired and gets no new agents; its own seam check stays in `server/providers/seam.test.ts` until its code goes.

| | Where |
|---|---|
| Interfaces | `AgentWorker`, `AgentConversation`, `McpServer` in `team/live/types.d.ts` |
| Agents today | `team/live/agents/claude-code/` and `team/live/agents/pi/` |
| Picked in | `team/live/agent.js`: `AGENTS`, chosen by `LIVING_MAP_AGENT`, else the agent whose chat started the server |
| Its skill | `team/skill/anur-living-map/`, installed by `team/skill/install.js` |

## What an agent provides

`AgentWorker`, for the map's own work:

- `ask`, `prepare`, `run`, `converse`, `answer`, `signIn`, `signedOut`, `reach`. Each job carries the map's prompt, schema and MCP servers, each server listing the tools it may call. Name and allow those tools the way your agent does.
- `run` may use only `job.tools` plus a fixed read-only set: enforce that in the agent, as `runSettings` in `agents/claude-code/run.js` does, or as `agents/pi/extension.js` does for an agent with no permission hooks. Refuse any call that `refusal(job.guard, tool, input, sent)` in `team/live/action-sends.js` refuses, before it runs: what an email's run may send, and what a run nobody started may not do.
- `converse` may use only its job's `servers` (the map's own tools, pinned to that map): none of the person's settings, MCP servers or context files, and every other tool refused, as `agents/claude-code/converse.js` does.
- `ask` may also get `dirs`, more folders it may read (a system map's code), read-only like its own folder. `answer` gives one reply held to `job.schema`, with no tools.

`AgentConversation`, for your own chats: `follow` (its `readNow` reads the transcript at once, for a chat's own words), `findChat`, `findNewChat`, `isChat`, `owns`, `sessionOf`, `openNew`, `skillDir`, `connectTools`. `allChats` in `agent.js` combines every agent's, so each transcript is followed by the agent that `owns` it.

## Steps

1. Add `team/live/agents/<agent>/index.js` returning an `AgentWorker` and an `AgentConversation`, typed in JSDoc against `team/live/types.d.ts`. Keep it JavaScript with no install: the team package runs on Node 22.18 or newer (24.2 on Node 24; `team/live/node-version.js`).
2. List it in `AGENTS` in `team/live/agent.js`, and in `agentName` if `LIVING_MAP_AGENT` should name it.
3. Copy the scripted agents in `team/live/agent.test.js` into tests of your agent's own parsing and arguments, the way `agents/claude-code/*.test.js` and `agents/pi/*.test.js` test theirs.
4. If the agent keeps files outside `agents/<agent>/`, add that folder to `ADAPTERS` in `team/live/seam.test.js`.
5. Try it on an isolated server: `cd team/live && HOME=$(mktemp -d) ANUR_LIVING_MAP_NO_UPDATE=1 LIVING_MAP_AGENT=<agent> node server.js <port> --project <a temp git repo>`, on a port that is not 4323.

## Rules

- Only an agent's own folders start its process, pass its flags, read its home folder or import its modules. `team/live/seam.test.js` fails otherwise, for anything under `team/` or `e2e/`.
- What an agent returns is untrusted: the map checks it (`check` in `team/live/proposal-check.js`, `system-check.js`) before it reaches a map. Hand it over as data; never parse proposals out of prose.
- The team package ships by pattern; `team/live/package.test.js` fails when a packed file reaches one that is not packed.

## Check

```bash
cd team/live && npx vitest run
npm run check && python3 .github/agent-docs/check.py
```
