# Living Map, live demo

The plan-first story as shared, live state: a small server holds where the story is, every open window draws the same map, and a click in one window (Priyanka's Dispute, Duy's Approve) moves them all. What people decide is written to `outbox.md`, which a Claude Code chat can read back.

```bash
node server.js            # http://localhost:4322
```

- Open `http://localhost:4322` as yourself, and `http://localhost:4322/?as=Priyanka` in a second window as her.
- **→** / **Space** / **Next ›** moves the story forward for everyone; **←** / **Back** moves it back; the buttons on the cards (Dispute, Confirm, Approve, Flag to Sam) are real clicks that set the step and write to the outbox.
- `?rec` hides the controls; `?chat` shows a mock chat pane (off by default: the real Claude Code chat sits beside the map).
- `curl -s localhost:4322/api/outbox` is what the chat hears; `POST /api/act {"type":"reset"}` starts the story over.

Demo only: the system map is a seed, not read from code; Codex and the merge check are staged.
