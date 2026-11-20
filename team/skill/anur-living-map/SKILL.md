---
name: anur-living-map
description: Opens the team's Living Map of this repo's system (boxes and lines read from its folders, imports and settings) beside the chat, starting its server for this repo if needed. Use when the user says /anur-living-map (/skill:anur-living-map in Pi), "open the system map", or asks what is on the team map. Not /living-map, which maps the chat.
---

# Anur Living Map: the system map of this repo

This skill runs the same in a Claude Code chat and a Pi chat. Where they differ (the chat's id, how the listener runs), each step says both.

The map is drawn from the repo's own files by the server in `$ANUR_LIVING_MAP_HOME/team/live` (`~/anur-living-map` unless `ANUR_LIVING_MAP_HOME`, or the older `LIVING_MAP_HOME`, says otherwise), on port 4323. Every repo it is opened from joins the list of maps at `localhost:4323` and keeps its own map at `localhost:4323/<map name>/`, the folder's name in lowercase letters, digits and dashes (acme at `/acme/`, PiTrade at `/pitrade/`, Anur Web App at `/anur-web-app/`); opening it from another repo never takes the others off. When the Living Map app is running, its own server answers on 4323 and `open-map.sh` uses it as it is (it says `server: the Living Map app's, already running`): no clone is made, pulled or started, since the app brings its updates.

## A new map started from a prompt

When the arguments begin with `map:<name>` (`/anur-living-map map:hiring-plan map our hiring for Q1`), the user just started a blank map called `<name>` from the prompt box on the list of maps, and this session was opened for it; the rest of the arguments is their prompt. Then, instead of steps 1 to 4:

1. Open it as step 1 says, in one message: `open-map.sh <name>` (it never restarts the server and adds no folder for a map that is not this repo's), the listener with `<name>` as the map, and the browser pane on `http://localhost:4323/<name>/`. From then on the map's Claude pane shows this chat, and what the user types there comes here.
2. Do the prompt: find what it needs with the tools this chat has (files, the web, the apps it is connected to), and draw it with `living_map_change`, `map: "<name>"`, everything for the prompt in one call where you can. The map is shared with the team, so anything private goes on it only in general words. Anything that leaves this Mac or cannot be undone still waits for the user's word.
3. Reply in two or three short lines: what you drew, what you found, what you could not reach.

## 1. Open it: one message, then straight on

**Send these together in one message, never one after another**, and skip any this chat has already done:

- **The script** (Bash): `scripts/open-map.sh` in this skill's folder (`~/.claude/skills/anur-living-map/` in Claude Code, `~/.agents/skills/anur-living-map/` in Pi). It starts the server only when it is not answering, puts this repo on the list of maps, brings the map up in Chrome (the tab already on it comes to the front, otherwise a new tab) and links this chat to the map. Each line it prints says what it did; `already` means nothing needed doing. Another map: `open-map.sh gtm`.
- **The listener** (step 3): in the background in Claude Code, the `living_map_listen` tool in Pi.
- **The browser pane** on the map (step 2).

**Then go straight on.** Do not check again that the map opened, and do not read the map, the code or the database to see what is there: the script's lines say it. The test: one round of tool calls between the user's message and the work they asked for. 

When the script prints `system map: <name>`, this repo is part of a system map drawn from code: the chat is linked to that map and Chrome opens on this repo's box there (the `chrome:` line gives the address). Start a listener for `<name>` too, and point the browser pane at that address.

Never stop the server to open another repo: other repos' maps and other chats' listeners live on it. If the script prints `could not add`, say it and stop.

Opening keeps the map as it was left: every change saves itself, and History, on the map's right rail, has every earlier version to look at or go back to. If the map does not answer, read `.living-map/server.log` in the repo. When the script prints `gitignore:`, add `.living-map/` to the repo's `.gitignore`: it holds the map's state.

## 2. Open it beside the chat too

The script already brought the map up in Chrome. If you have a browser pane (tools named `mcp__Claude_Browser__*`), open the map there as well (`http://localhost:4323/<map name>/`), in the same message as the script, so it sits beside the chat.

The map needs no sign-in on this Mac: it opens straight onto the user's maps, as them. Their name and the optional **Sign in with Google** are in Settings (`localhost:4323/settings`); signing in with Google is theirs to do, never yours.

## 3. Listen to the map

People answer the map's questions, press Apply on changes Claude proposed in the map's chat, and comment on boxes. What belongs to this chat should reach it without anyone typing here.

**In Pi**, call the `living_map_listen` tool once per map with the map's name (this repo's folder name for its own map, `gtm` for `localhost:4323/gtm/`). It keeps listening until the chat ends, so it never needs starting again, and what the map has for this chat arrives as a message starting `FROM YOUR LIVING MAP`. If the tool is missing, `open-map.sh` printed `pi: added ...`: tell the user to type `/reload` once, then call it. The chat's id is `$PI_SESSION_ID` wherever the rules below say `$CLAUDE_CODE_SESSION_ID`.

**In Claude Code**, start the listener in the background (`run_in_background`, never in the foreground), unless one already runs in this conversation for that map:

```bash
node "${ANUR_LIVING_MAP_HOME:-${LIVING_MAP_HOME:-$HOME/anur-living-map}}/team/live/wait.js" 4323 "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" "$CLAUDE_CODE_SESSION_ID"
```

The second argument is the map: this repo's folder name for its own map (the listener lowercases it as the server does), `gtm` for `localhost:4323/gtm/`. Start one listener for each map this chat draws on.

The script links this chat to the map, so the map's Claude pane shows this conversation, live, and what is typed there comes here. It links to the user, the one person on this Mac, whatever name the script sends. The chat linked last is the one the pane follows.

It ends the moment the map has something for this chat, printing it after `FROM YOUR LIVING MAP`, and its ending wakes you. When the rules for answering are new to this chat, they come under it after `HOW TO ANSWER IT`, from the server itself (otherwise one line says they are unchanged since you last got them): how to say it back, how to propose a change so it waits for Apply, how to reorganize the map, what Build the plan means, how a plan is drawn. Follow them; they are always as current as the map, and they win over anything read earlier. `open-map.sh` prints the same rules when it opens the map (after `RULES FROM THE MAP`), so plans this chat draws follow them too. Then, in Claude Code, start the listener again right away, the same way (Pi's keeps listening).

While the map is open, when the user commits to doing something themselves with a checkable result ("I'll send Dan the pricing by Thursday"), call `living_map_my_action` with their exact words, without asking first: the map, not this chat, decides whether it becomes their Action draft.

## 4. Reply

**When the arguments carry a request** (`/anur-living-map, plan changing our payment provider to Stripe`), skip this reply: do the request right after step 1's message, as the repo's CLAUDE.md says. Where that CLAUDE.md already gives the plan for the request, draw it from there in the next message, without reading the code, the database or the map first. 

Otherwise, one line, from what step 1's `map:` line printed: the map is open as it was left (how many versions History holds) or new, and how many boxes it has. When it has no boxes yet, say so plainly, and that the map offers **Draw this repo**, which draws it as a system map from the code in this folder; never call an empty map a picture of the system. Do not describe the boxes and do not plan anything yet; wait for the user's next message. When it asks to build something, follow the repo's CLAUDE.md (in acme: "Before building a feature, draw the plan on the map").

## Reading it back

- What people answered on the map: `curl -s localhost:4323/<map name>/api/outbox` (on another map, `localhost:4323/gtm/api/outbox`)
- The whole map: `curl -s localhost:4323/<map name>/api/state`
