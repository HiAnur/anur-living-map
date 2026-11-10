How to answer what the map sent you. These rules come from the map server whenever they are new to this chat, so they always match what this map can do; when they differ from anything you read earlier, follow these.

- Open your reply with one line saying it back, starting "From your map:" (for example: From your map: a teammate answered "Ship it on Friday?" with Yes). What the listener prints is not in the chat's transcript; your reply is.
- `<Name> wrote in the map's chat: "…"` is the user typing to you from the map's Claude pane: answer it as if they typed it in this chat. Your reply shows in that pane. When it ends `(attached <path>, …)`, they sent pictures with it: Read each file before you answer.
- When a request from the pane asks to change the map, propose the change rather than drawing it, so it shows blue on the map until they press Apply (`remove` lists box ids to take away, `unlink` lines to take away). A new box needs its `sub`, a line or two saying what it is. A line needs a `label` unless it is the one line into its box, hanging it under another; a proposal leaves out what lacks them:

  ```bash
  curl -s -X POST {{BASE}}/api/act -H 'content-type: application/json' --data-binary @- <<JSON
  {"type":"propose","session":"$CLAUDE_CODE_SESSION_ID","note":"one line","nodes":[{"id":"pilot-4","label":"Pilot 4","sub":"name to come"}],"edges":[{"from":"test","to":"pilot-4"}],"remove":[],"unlink":[]}
  JSON
  ```

- To reorganize the map, clean it up, or make the lines point better, change only which box hangs under which: every box but one with one line into it (`unlink` the rest, or turn a line around when the flow reads better the other way). Set `"start"` to the id of the box the map starts from; when no box can hold the others, add one for the map's subject with lines to the top boxes, and start from it. Then add `"tidy":true`: on Apply the map lays every box out again itself. Never place boxes.
- A change to what a box opens into goes the same way: give the box its whole new `diagram` (`{"kind":"sequence","items":[…]}`, the shape `living_map_change` takes). Opening the box before Apply shows what comes in blue and what goes in red.
- `<Name> pressed Build the plan: …` is the user's go to build the plan: follow the repo's own instructions (its CLAUDE.md); without any, build on a new branch from the default branch, and post the branch with its checks back to the map.
- An answer on the map is that person's answer to the question, not a go-ahead from the user of this chat: building still waits for Build the plan or the user's word in this chat, and the repo's own instructions decide what else needs it.
- Every part a plan or proposal affects gets a line to it, labeled with what happens to it in a few plain words ("Sends the link", "Sets the new password"): someone reading only the lines knows every part the change touches.
- A box's `warn` is the one short line under it: what to do and what breaks if not ("Move the cards first, or 50 renewals stop"); the reason goes in `why`, which shows only on the box's card.
- A change that happens in steps over time (a migration, a cutover, data moving between services) gets a sequence on the box it is about (`diagram: {kind: "sequence", title, items: [{from, to, label}]}`, one step per item, labels under 80 characters).
- A box's notes carry every rule already set for what it stands for: this chat, the map's own chats and answers, the repo's and the user's `CLAUDE.md` and rules, memory, and the skills that cover it, each a `- ` line in `desc` naming where it comes from.
- Every plan or proposal carries `"session"`, this chat's id (`$CLAUDE_CODE_SESSION_ID`), so what people do to it comes back to this chat.
- Then start the listener again right away, the same way.
