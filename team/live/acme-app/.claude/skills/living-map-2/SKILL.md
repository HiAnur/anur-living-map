---
name: living-map-2
description: Opens this team's Living Map of acme-app (the live demo server on localhost:4322) beside the chat, starting the server if it is not running. Use when the user says /living-map-2, "open the map", "show the map", or asks what is on the map.
---

# Living Map 2 (acme-app demo)

The team's shared map of acme-app is the demo server in the folder above this one (`../server.js`); run the commands from this folder. It is not the `living-map` skill in `~/.claude/skills`; that one maps a chat. This one shows the system.

## 1. Make sure the server runs

```bash
curl -sf localhost:4322/api/state >/dev/null && echo running || (cd .. && nohup node server.js 4322 >/dev/null 2>&1 & sleep 1 && echo started)
```

## 2. Open it

```bash
open http://localhost:4322
```

If you have a browser pane (tools named `mcp__Claude_Browser__*`), open `http://localhost:4322` there instead, so the map sits beside the chat.

## 3. Reply

One line: the map is open, and it shows acme-app as it runs today. Nothing else. Do not describe the map, do not plan anything yet; wait for the user's next message (usually a ticket to plan, see CLAUDE.md).

## Reading it back

- What people decided arrives in plain words: `curl -s localhost:4322/api/outbox`
- The whole map as data: `curl -s localhost:4322/api/state`
