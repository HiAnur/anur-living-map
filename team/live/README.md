# Anur Living Map, the server

One small server holds the map; every open window draws the same one, and a click in one window (a Dispute, an Approve) moves them all. With `--project <repo>` the map is drawn from that repo's own files; without it, it plays the plan-first story from `seed.json`. What people decide is written to `outbox.md`, which a Claude Code chat can read back.

```bash
node server.js 4323 --project <repo>    # http://localhost:4323/<repo folder name>/
node server.js                          # the plan-first story, http://localhost:4322
```

- Open `http://localhost:4322` as yourself, and `http://localhost:4322/?as=Priyanka` in a second window as her.
- **→** / **Space** / **Next ›** moves the story forward for everyone; **←** / **Back** moves it back; the buttons on the cards (Dispute, Confirm, Approve, Flag to Sam) are real clicks that set the step and write to the outbox.
- `?rec` hides the controls; `?chat` shows a mock chat pane (off by default: the real Claude Code chat sits beside the map).
- `curl -s localhost:4322/api/outbox` is what the chat hears; `POST /api/act {"type":"reset"}` starts the story over.
- Each address is its own map: `http://localhost:4322/gtm/` is a map called `gtm`, with its API under it (`/gtm/api/state`, `/gtm/api/act`). It starts empty, keeps its state in `maps/gtm/`, and fills from the plans drawn on it.
- With `--project`, `/` is a list of every map to pick from (`/api/maps` gives the same list); the project's own map is at `/<project folder>/`, and `/api/...` still answers for it.
- Sign-in: every page asks who you are at `/login`, and a person from the map's people who has no password yet chooses one there (at least 8 characters, kept scrambled in `~/.living-map-2/users.db`, outside the repo). A signed-in browser acts only as that person. `node users.js set <name>` changes a password; `list` and `remove <name>` too. The API stays open to this Mac's own tools (Claude's plans, the listeners).
- Sign in with Google: the button sends you to Living Map login (`../login/`, on Cloud Run in the GCP project `living-map-login`), and anyone with a Google account gets in. You come back signed in as one of this map's people when your Google name matches one (full name or first name), else under your Google name; a Google address on the login's list signs in as the name kept there. The map itself stays on this Mac. `LIVING_MAP_LOGIN_URL` points at another login service; set it empty to turn Google off. A name and password kept there (for someone with no Google account) also works in the sign-in form.
- Drawing by hand: the Box tool in the dock drags out a box (a click makes one the usual width) and you name it where it sits; the Line tool drags from one box to another, then takes the words on the line; Pan drags the map from anywhere. A box's card ends in Delete this box (or press Delete on a picked box), which asks once, then takes the box and its lines off the map for everyone; History brings it back. Level − + goes down to level 0, only where the map starts, drawn in ink.
- Share ▸ Share as a file downloads the map as one Markdown file (`<map name>.md`): every box with its notes and decisions, the lines, and what still waits on an answer.
- The faces at the top right are who has this map open right now; the menu under them says who is here and who is not.
- It keeps itself current: run from a git clone on `main` with no changes of its own, the server looks at GitHub when it starts and every ten minutes, pulls what is new, refreshes the skill's copy under `~/.claude/skills` and starts itself again in its place; pages and listeners reconnect by themselves. A copy without git (`npx anur-living-map`) is left to npx.
- Any Claude Code chat on this Mac, in any folder, can read and change a map with two tools from `mcp.js`: `living_map_read` and `living_map_change` (boxes, lines, to-dos and questions for a teammate, many in one call, boxes named by id or by name). Registered once with `claude mcp add --scope user living-map -- node <path>/mcp.js`; `LIVING_MAP_URL` points it at another server.

Without `--project`, the map is the plan-first story from `seed.json`; Codex and the merge check in that story are staged.
