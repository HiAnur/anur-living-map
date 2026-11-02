---
name: anur-living-map
description: Opens the team's Living Map of this repo's system (boxes and lines read from its folders, imports and settings) beside the chat, starting its server for this repo if needed. Use when the user says /anur-living-map, "open the system map", or asks what is on the team map. Not /living-map, which maps the chat.
---

# Anur Living Map: the system map of this repo

The map is drawn from the repo's own files by the server in `$LIVING_MAP_HOME/team/live` (`~/anur-living-map` unless `LIVING_MAP_HOME` says otherwise), on port 4323. Every repo it is opened from joins the list of maps at `localhost:4323` and keeps its own map at `localhost:4323/<map name>/`, the folder's name in lowercase letters, digits and dashes (acme at `/acme/`, PiTrade at `/pitrade/`, Anur Web App at `/anur-web-app/`); opening it from another repo never takes the others off.

## A new map started from a prompt

When the arguments begin with `map:<name>` (`/anur-living-map map:hiring-plan map our hiring for Q1`), the user just started a blank map called `<name>` from the prompt box on the list of maps, and this session was opened for it; the rest of the arguments is their prompt. Then, instead of steps 1 to 4:

1. Open it as step 1 says, in one message: `open-map.sh <name>` (it never restarts the server and adds no folder for a map that is not this repo's), the listener with `<name>` as the map, and the browser pane on `http://localhost:4323/<name>/`. From then on the map's Claude pane shows this chat, and what the user types there comes here.
2. Do the prompt: find what it needs with the tools this chat has (files, the web, the apps it is connected to), and draw it with `living_map_change`, `map: "<name>"`, everything for the prompt in one call where you can. The map is shared with the team, so anything private goes on it only in general words. Anything that leaves this Mac or cannot be undone still waits for the user's word.
3. Reply in two or three short lines: what you drew, what you found, what you could not reach.

## 1. Open it: one message, then straight on

**Send these together in one message, never one after another**, and skip any this chat has already done:

- **The script** (Bash): `~/.claude/skills/anur-living-map/scripts/open-map.sh`. It starts the server only when it is not answering, puts this repo on the list of maps, brings the map up in Chrome (the tab already on it comes to the front, otherwise a new tab) and links this chat to the map. Each line it prints says what it did; `already` means nothing needed doing. Another map: `open-map.sh gtm`.
- **The listener** (step 3), in the background.
- **The browser pane** on the map (step 2).

**Then go straight on.** Do not check again that the map opened, and do not read the map, the code or the database to see what is there: the script's lines say it. The test: one round of tool calls between the user's message and the work they asked for. 

Never stop the server to open another repo: other repos' maps and other chats' listeners live on it. If the script prints `could not add`, say it and stop.

Opening keeps the map as it was left: every change saves itself, and History, on the map's right rail, has every earlier version to look at or go back to. If the map does not answer, read `.living-map/server.log` in the repo. When the script prints `gitignore:`, add `.living-map/` to the repo's `.gitignore`: it holds the map's state.

## 2. Open it beside the chat too

The script already brought the map up in Chrome. If you have a browser pane (tools named `mcp__Claude_Browser__*`), open the map there as well (`http://localhost:4323/<map name>/`), in the same message as the script, so it sits beside the chat.

The map asks who you are: a browser that has not signed in lands on `localhost:4323/login`, and someone signing in for the first time chooses their password there. Never type a password for the user, and never set one with `users.js`; signing in is theirs.

## 3. Listen to the map

People answer the map's questions, press Apply on changes Claude proposed in the map's chat, and comment on boxes. What belongs to this chat should reach it without anyone typing here. Start the listener in the background (`run_in_background`, never in the foreground), unless one already runs in this conversation for that map:

```bash
node "${LIVING_MAP_HOME:-$HOME/anur-living-map}/team/live/wait.js" 4323 "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" "$CLAUDE_CODE_SESSION_ID"
```

The second argument is the map: this repo's folder name for its own map (the listener lowercases it as the server does), `gtm` for `localhost:4323/gtm/`. Start one listener for each map this chat draws on.

The script links this chat to the map, so the map's Claude pane shows this conversation, live, and what is typed there comes here. It links as the person who uses this Mac (the first word of the account's full name, or `LIVING_MAP_ME`): only their signed-in browser is shown this chat. The chat linked last is the one the pane follows.

It ends the moment the map has something for this chat, printing it after `FROM YOUR LIVING MAP`, and its ending wakes you. Then:

- Open your reply with one line saying it back, starting "From your map:" (for example: From your map: a teammate answered "Charge $60 an engineer?" with Yes). What the listener prints is not in the chat's transcript; your reply is.
- `<Name> wrote in the map's chat: "…"` is the user typing to you from the map's Claude pane: answer it as if they typed it here. Your reply shows in that pane. When it ends `(attached <path>, …)`, they sent pictures with it: Read each file before you answer.
- When a request from the pane asks to change the map, propose the change rather than drawing it, so it shows blue on the map until they press Apply (the same box shape as a plan; `remove` lists box ids to take away):

  ```bash
  curl -s -X POST localhost:4323/gtm/api/act -H 'content-type: application/json' --data-binary @- <<JSON
  {"type":"propose","session":"$CLAUDE_CODE_SESSION_ID","note":"one line","nodes":[{"id":"pilot-4","label":"Pilot 4","sub":"name to come"}],"edges":[{"from":"test","to":"pilot-4"}],"remove":[]}
  JSON
  ```

  A change to what a box opens into goes the same way: give the box its whole new `diagram` (`{"kind":"sequence","items":[…]}`, the shape `living_map_change` takes). Opening the box before Apply shows what comes in blue and what goes in red.
- `<Name> pressed Execute: …` is the user's go to build the plan: follow the repo's CLAUDE.md; by default build on a branch from `main`, and post the branch with its checks back to the map.
- Act on it the way the repo's CLAUDE.md says: an answer to a question is that person's answer, and building still waits for the user's go. Anything that leaves this machine or cannot be undone waits for the user's word here.
- Start the listener again right away, the same way.

**Every part a plan or proposal affects gets a line to it, labeled with what happens to it** in a few plain words ("Sends the link", "Sets the new password"). The test: someone reading only the lines knows every part the change touches and what changes there. 

**A box's `warn` is the one short line under it on the map: what to do and what breaks if not** ("Move the cards first, or 50 renewals stop"); the reason goes in `why`, which shows only on the box's card. The test: it fits under the box in two lines, and every word has one meaning. 

**A change that happens in steps over time (a migration, a cutover, data moving between services) gets a sequence on the box it is about** (`diagram: {kind: "sequence", title, items: [{from, to, label}]}`, one step per item, labels under 80 characters). The test: someone who opens that box sees who does what, in what order, without this chat. 

**A box's notes carry every rule already set for what it stands for.** Before drawing or proposing a box, look for what is already decided about it: this chat, the map's own chats and answers, the repo's and the user's `CLAUDE.md` and rules, memory, and the skills that cover it. Each one goes in the box's `desc` as a `- ` line naming where it comes from. The test: someone who opens only that box knows every rule that governs it, without this chat. 

**Every plan this chat posts carries `"session"`, this chat's id** (`echo $CLAUDE_CODE_SESSION_ID`). That is how the map knows which chat drew which boxes and questions, so what people do to them comes back here and not to another chat.

## 4. Reply

**When the arguments carry a request** (`/anur-living-map, plan changing our payment provider to Stripe`), skip this reply: do the request right after step 1's message, as the repo's CLAUDE.md says. Where that CLAUDE.md already gives the plan for the request, draw it from there in the next message, without reading the code, the database or the map first. 

Otherwise, one line, from what step 1 printed: the map is open as it was left (how many versions History holds), or fresh, showing the system as it runs today. If the page landed on the sign-in screen (its address is `/login`), say so instead: sign in beside the chat to see the map, and someone new chooses their password there. Do not describe the boxes and do not plan anything yet; wait for the user's next message. When it asks to build something, follow the repo's CLAUDE.md (in acme: "Before building a feature, draw the plan on the map").

## Reading it back

- What people answered on the map: `curl -s localhost:4323/<map name>/api/outbox` (on another map, `localhost:4323/gtm/api/outbox`)
- The whole map: `curl -s localhost:4323/<map name>/api/state`
