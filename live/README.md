# Living Map, live demo

The plan-first story as shared, live state: a small server holds where the story is, every open window draws the same map, and a click in one window (Priyanka's Dispute, Duy's Approve) moves them all. What people decide is written to `outbox.md`, which a Claude Code chat can read back.

```bash
node server.js            # http://localhost:4322
```

- Open `http://localhost:4322` as yourself, and `http://localhost:4322/?as=Priyanka` in a second window as her.
- **→** / **Space** / **Next ›** moves the story forward for everyone; **←** / **Back** moves it back; the buttons on the cards (Dispute, Confirm, Approve, Flag to Sam) are real clicks that set the step and write to the outbox.
- `?rec` hides the controls; `?chat` shows a mock chat pane (off by default: the real Claude Code chat sits beside the map).
- `curl -s localhost:4322/api/outbox` is what the chat hears; `POST /api/act {"type":"reset"}` starts the story over.
- Each address is its own map: `http://localhost:4322/gtm/` is a map called `gtm`, with its API under it (`/gtm/api/state`, `/gtm/api/act`). It starts empty, keeps its state in `maps/gtm/`, and fills from the plans drawn on it.
- With `--project`, `/` is a list of every map to pick from (`/api/maps` gives the same list); the project's own map is at `/<project folder>/`, and `/api/...` still answers for it.
- Sign-in: every page asks who you are at `/login`, and a person from the map's people who has no password yet chooses one there (at least 8 characters, kept scrambled in `~/.living-map-2/users.db`, outside the repo). A signed-in browser acts only as that person. `node users.js set <name>` changes a password; `list` and `remove <name>` too. The API stays open to this Mac's own tools (Claude's plans, the listeners).
- Sign in with Google: the button sends you to Living Map login (`../login/`, on Cloud Run in the GCP project `living-map-login`), which holds the one list of Google addresses allowed in and which person each one is. You come back to this map signed in as that person. The map itself stays on this Mac. `LIVING_MAP_LOGIN_URL` points at another login service; set it empty to turn Google off.
- The faces at the top right are who has this map open right now; the menu under them says who is here and who is not.
- Any Claude Code chat on this Mac, in any folder, can read and change a map with two tools from `mcp.js`: `living_map_read` and `living_map_change` (boxes, lines, to-dos and questions for a teammate, many in one call, boxes named by id or by name). Registered once with `claude mcp add --scope user living-map -- node <path>/mcp.js`; `LIVING_MAP_URL` points it at another server.

Demo only: the system map is a seed, not read from code; Codex and the merge check are staged.
