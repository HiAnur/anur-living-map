# Living Map

A local web app that keeps one live mind map of your Claude Code chat, beside it. Linked from a chat with `/living-map`, it follows the chat's transcript as it grows, files what is new (what waits on you, tasks, decisions, what changed in the code) with your own Claude Code, and draws it on a page you work by clicking: lenses for what is waiting, open, decided and changed; answers sent back to the chat; side chats on any box that know the whole chat.

## Stack

- Node 23.6+ runs the server's TypeScript directly (type stripping): no build step for the server.
- Server: Express 5, server-sent events, `node:sqlite`. Browser: React 19, Vite 8, Tailwind 4 (every colour and font in `web/brand.css`), React Flow 12.
- TypeScript 6, strict, one `tsconfig.json` for server, browser and shared code. Tests: Vitest. Lint: ESLint 10 flat config. Format: Prettier (defaults).

## Commands

```bash
npm install
npm start              # build, then serve http://localhost:4317 under server/launcher.ts
                       # (exit code 75 = restart after a one-click update)
npm run dev            # server with --watch, plus Vite on :5173 (?fixture=1 draws a fixture map, no server)
npm run check          # ESLint, tsc, Prettier, Vitest: the same as the pre-commit hook
npm test               # Vitest only
npm run coverage       # Vitest with coverage (report in coverage/); fails when ledger/ drops under the floor in vite.config.ts
npm run test:ui        # Playwright on the fixture map, starting its own Vite on :5199 (once: npx playwright install chromium)
npm run upgrade:check  # list dependency upgrades .ncurc.cjs allows (week-old releases, peer- and engine-compatible)
npm run upgrade        # minor and patch upgrades; npm-check-updates doctor reverts any that fail upgrade:test (rewrites package.json and the lockfile; only when asked)
npm run upgrade:latest # the same, majors included (only when asked)
npm run skill          # install both skills, living-map and anur-living-map, into ~/.claude/skills (writes outside the repo; only when asked)
npm run skill -- --hook  # also add the living-map UserPromptSubmit hook to ~/.claude/settings.json (only when asked)
node eval/read-format.ts             # can models read mermaid+ as well as one line per item (calls the model, ~$0.50; only when asked)
node eval/transcripts.ts [N]         # the transcript reader over your N largest Claude Code chats (local, no model)
node eval/changes-retro.ts [N] [out] # what changed, rebuilt from your N latest sessions (local, no model)
node eval/extract-run.ts --pick 15 [--max-usd 40] [--fresh]  # the extractor over your own chats, offline, with 5 checkpoints each (calls the model; only when asked)
node eval/extract-label.ts [--fresh] <dir>...   # Opus labels each checkpoint (calls the model; only when asked)
node eval/extract-score.ts [<dir>...]           # recall and precision against the labels, and settle.md for your marks
```

The pre-commit hook (husky, `.husky/pre-commit`) runs lint-staged, then the full checks; each check's own exit code decides.

## Verify

```bash
npm run check && npm run build && python3 .github/agent-docs/check.py
```

For a change under `web/`, also `npm run test:ui`; for one under `ledger/`, also `npm run coverage`. CI runs both.

For a UI change, also try it in the browser on a test server (below), on a linked chat.

## Layout

- `ledger/`: the map of a chat.
  - `transcript.ts` holds a chat as the map's own entries and turns (compactions, queued prompts, sealing, edit patches, the question tool's questions and your picks as `turn.asked`, the agent's task-list changes as `Entry.tasks`, never other tool output): `transcript/entry.ts` is the entry, `transcript/turns.ts` turns entries into turns. The agent reads its own transcript into entries (`AgentConversation.readMore`; for Claude Code, `server/providers/claude-transcript.ts`: uuid dedupe, `logicalParentUuid`, which lines are prompts, task-list tool calls as task steps), and the ledger and side chats are handed that reader.
  - `extract.ts` files new turns as ops: `extract()` on the provider, a fresh `claude -p` with its own system prompt, no tools, no cache and a JSON schema, on Claude Code's default model unless `{"ledgerModel": …}` in `~/.living-map/settings.json` names one; the agent's `judgmentModel` refuses Haiku for judgment. `apply.ts` checks every op (quotes, server-minted ids, who may write what) before it is stored. A state change lands even when its quote fails; a wait closed that way is marked `unconfirmed` (stored, migrated in `db/schema.ts`) and listed under Waiting to check until you or a quoted change settles it.
  - `db.ts` is the store (`~/.living-map/ledger.db`, `node:sqlite`, migrated by `PRAGMA user_version` on open, after a copy to `ledger.db.before-v<N>`): a run's raw answer is saved first, then one transaction applies it and moves the read point. Its tables are the migrations in `db/schema.ts` (a change is a new entry at the end), its row types `db/rows.ts`, its side-chat queries `db/sides.ts`.
  - `follow.ts` follows every linked chat (and measures how long after a turn seals it is filed: `health.filing` and `health.lag` in the view, one log line per run) — a notice (a background task finishing, the map's listener among them) is not a prompt, so what Claude adds to a filed turn after one is filed as more of that turn, from `Conv.readExtent`. `follow/read.ts` reads the transcript, `follow/run.ts` files its turns, and both are handed the ledger's shared state (`Ctx` in `follow/follower.ts`); `view.ts` builds `LedgerView` (`shared/ledger.ts`); `tasks.ts` replays the agent's own task list from its task steps; `mermaid.ts` writes and parses mermaid+, the map's text form; `changes/` lifts file diffs into system-level change statements with no model.
  - `routes.ts` starts it all and serves `/api/ledger/view` and `/api/ledger/act`; `link.ts` answers `POST /api/link`; `outbox.ts` holds what the chat should hear (`~/.living-map/conversations/<first id>.json`); `handover.ts` rewrites each chat's handover (`~/.living-map/handover/<first id>.md`, and `handover/projects/<folder>.md` for the chat changed last in that folder) whenever its view is pushed.
  - `sides.ts` runs side chats: one open chat with the provider per side chat (`openChat`: read-only `Read,Grep,Glob`, `--restricted`, no web, the chat's project as cwd plus `~/.living-map/sides/<chat>/` holding the rendered `items.md` and `turns.md`, never a transcript; `chatArgs` in `server/providers/claude-code.ts` holds those arguments and `sides.test.ts` checks them). It proposes only by calling its one tool, `propose_change` (`PROPOSE_TOOL` in `sides/proposal.ts`, handed over as `ChatRequest.propose` and served by `server/providers/tool-mcp.ts`, so a call arrives as a `propose` chat event); that input is checked by `checkProposal` and applied only on `apply-proposal`; `sides/stream.ts` folds what the chat says into the reply.
- `server/`: `index.ts` starts the provider, the ledger and the routes (`http.ts`). Every `/api` route but `GET /api/health` needs the local token (`auth.ts`): kept in `~/.living-map/token` (0600), sent as `X-LM-Token` by the skill, hook and scripts. The page signs in once by the link `/api/link` answers (`/auth?n=<code>&conv=<chat>`, one use, 5 min), which sets a year-long HttpOnly cookie and lands on `/?conv=<chat>`; the cookie alone allows only reads, and the page gets the token for writes from `/api/session` (`web/lib/session.ts`). `POST /api/open` (the map's ⋯ → Open in your browser) mints a fresh link and opens it with `browser.ts`; `POST /auth/here` (the signed-out page's Show my maps) sets the cookie for a page on this machine, by its Origin, with no token. A Host that is not localhost, or an Origin that is another page, is refused. New routes are listed in `auth.test.ts`, which fails until they are.
- The chat hears the map two ways: `POST /api/inbox` from `skill/hook.ts` with your next message, or at once through `GET /api/inbox/wait`, where `skill/wait.ts` (a listener the chat keeps running in the background) waits for anything marked `wake`. `GET /api/outline` is the map as text (`ledger/outline.ts`: what matters now first, settled topics folded; `?lens=waiting|open|decided` gives one section).
- `server/providers/`: the agent. `types.ts` is the only seam: `AgentWorker` for the map's own work (`extract`, `openChat` for side chats, `judgmentModel`) and `AgentConversation` for your chats (`findConversation`), together `Agent`; each caller takes only the half it uses. `claude-code.ts` implements it (finding your chats and a resumed chat's new file with `claude-sessions.ts`, reading them with `claude-transcript.ts`, `childEnv` dropping the session variables of the chat that started the server); `skill/` is that agent's skill and hook, and `eval/` reads Claude Code chats with it. Nothing outside the agents' folders starts `claude` or reads `~/.claude` (`server/providers/seam.test.ts`); the `adding-an-agent` skill says how to add one. Pick another with `LIVING_MAP_PROVIDER`.
- `server/update.ts` and `server/launcher.ts`: the one-click update (compare with the latest GitHub release, pull, `npm ci`, build, restart).
- `web/`: `App.tsx` signs in; with `?conv=<chat>` it asks `GET /api/ledger/view` for that chat once (`map/probe.ts`) and lazy-loads `map/MapScreen.tsx` (the screen's state and what a click does; its camera is `map/camera.ts`, its smaller pieces `map/ScreenParts.tsx`, and the `use*.ts` hooks beside it hold the tips, the notes, the keys, what is shown and what is new); with no chat it lists every mapped chat (`Chats.tsx`, `GET /api/ledger/chats`), each opening in a new tab. `map/layout.ts` places nodes from the items alone (column = depth, rows in tree order, newest first by `order` key), so a new item never moves a node above it, and `holdView` moves the camera by what moved below so the box you are looking at stays put; `layout.test.ts` holds that over a 300-step growth. Node size follows the pane's width class (`sizeFor`: narrower than 640 px gets `NARROW`), never its exact width.
- `skill/`: the `living-map` skill for users' own Claude Code. `SKILL.md` is a template (`{{APP_DIR}}`, `{{PORT}}`), `install.ts` writes it to `~/.claude/skills/living-map/` (the server rewrites an installed copy on start and after a one-click update, never a test server) and, from `npm run skill` only, copies the team map's skill beside it, `start.ts` starts the server detached so it outlives the chat that asked.
- `e2e/`: browser tests of the map's screen on the fixture map (`playwright.config.ts`); Vitest skips this folder.
- `team/`: Anur Living Map, the team's shared map of a codebase, kept apart from the chat map above: its server (`team/live/`), the `/anur-living-map` skill (`team/skill/`, copied into `~/.claude/skills/` by hand or by `npm run skill`, and refreshed by its own `open-map.sh`), login service, landing page and story boards. The chat map's own install and use page is `docs/chat-map.md`. Its npm package lists what it ships by pattern in `team/live/package.json`, and `package.test.js` fails when a packed file reaches one that is not packed. Not linted or built here: its tests run with `vitest`, and `tsc -p team` (in `npm run check`) type-checks its JavaScript, tests included, with every strict flag on but `noImplicitAny` (`team/tsconfig.json`). `team/tsconfig.strict.json` adds that flag for everything but the tests: type a new parameter in JSDoc, with the shared shapes in `team/live/types.d.ts`. The map's own work with an agent (Ask Claude, Action preparation and runs, the headless chat) goes through `agent` in `team/live/agent.js`, an `AgentWorker` (`types.d.ts`), and your own chats (following a transcript, finding and opening a chat, the skill's folder, registering the map's MCP server) through `chats` there, an `AgentConversation`; everything that starts `claude` or reads `~/.claude` lives in `team/live/agents/claude-code/`, and another agent is a folder beside it returned from `agent.js`. The map hands each job its own prompt, schema and MCP servers. A running Action may use only the tools its reviewed brief names plus a fixed read-only set: `runSettings` in `agents/claude-code/run.js` builds a PreToolUse hook (`onlyTools` in `process.js`, also behind preparation) that denies the rest. `team/live/draw.js` holds what Claude may draw through `living_map_change` (a new box needs a name and a second line, a line needs a label) and `mcp.js` only sends it; Ask Claude and Auto plan offer a change only by calling `propose_change` (its schema in `team/live/propose.js`, served by `propose-mcp.js`; the agent's `ask` hands back the call's input), never as text in the reply; `check` in `proposal-check.js` holds those proposals to the same, where a line with no label may only be the one line into its box. `team/live/objects.js` reads a stored map as the objects it is meant to hold (`MapObject` in `types.d.ts`: every box, line and memory with an id, a type, a name and dates) and lists what each lacks; maps are not stored that way yet. Tests cut `server.js` and `index.html` by the first line of a function (`server.indexOf('    ask(a) {')`), so type a declared function in a JSDoc line above it and leave that first line as it is. Fix a type error there with a JSDoc annotation at the start of a line (after other code on the same line it is read as a trailing comment and does nothing), not a change in what runs. Its own README says how it runs.
- A test server: `LIVING_MAP_HOME=<test home> PORT=<not 4317> node server/index.ts` keeps its own store and token and leaves the installed skill alone.

## Releases

Every push to `main` that passes CI publishes a GitHub release `v0.1.<run>` (the `release` job in `.github/workflows/ci.yml`). Running copies show **New version available** and install it with one click, so `main` is always shippable.

## Conventions

- New files are TypeScript: ESLint rejects a `.js` file outside `team/`, whose JavaScript runs as it is (the browser loads some of it, and it needs no install).
- Imports carry their extension (`./follow.ts`, `./App.tsx`); Node needs it for the server, and the browser follows the same rule. ESLint orders them: external, blank line, internal. <!-- agent-docs: ignore -->
- Anything model-specific lives in a provider.
- The model's output is untrusted: check every op before it reaches the store (`apply.ts`, `checkProposal`).
- Colours come only from the roles in `web/brand.css` (`bg-canvas`, `text-ink`, `bg-primary`, `border-success-line`, …): no Tailwind palette colours or hex codes in components. Every role has a light value and a dark one (under `prefers-color-scheme: dark`); set both, with text at 4.5:1 or more on the surfaces it sits on. The logo mark is `web/lib/mark.ts`; the favicon is drawn from it at startup.
- A file holds at most 500 lines of code (ESLint `max-lines`, blank lines and comments not counted). `eslint.config.js` lists the one file still over it: add none. What several test files share (fixtures, a fake process, a scripted model) lives beside them in `<name>.harness.ts`, which is not counted as covered source.
- No `setState` inside effects: derive the value, or reset state when its key changes during render.
- One filled button per screen, marked `data-primary` (an open card or side chat owns it); everything else is outlined or behind a ⋯ (`web/components/More.tsx`). Subject matter Claude wrote (titles, quotes, answers) carries `data-content`, so interface words can be counted apart.
- Copy the user reads says "you", in plain words.

## Never

- Never use `--no-verify`, and never commit on or push to `main` (`.claude/hooks/protect-main.sh`).
- Never commit `out/`, `cache/`, `data/` or anything from `~/.living-map`: they can hold private transcripts and maps.
- Never break `npm ci`, `npm run build` or the launcher's restart: every running copy installs `main` with them.

## Skills

- `maintaining-agent-docs`: before creating or editing `AGENTS.md`, `CLAUDE.md` or a skill.
- `addressing-pr-reviews`: when a PR you opened has comments.
- `adding-an-agent`: when wiring another agent behind the seam, changing what the map asks of one, or when `server/providers/seam.test.ts` fails.
