# Anur Living Map

The team's shared map of a codebase. Claude Code draws its plan for a feature on the map before building anything; the team confirms or disputes each call with a click; the agent builds from what was agreed, and what it changes lands back on the map.

The map is the server in [`live/`](live/): `node live/server.js 4323 --project <repo>`, then http://localhost:4323/<repo folder name>/. Its own [README](live/README.md) says how sign-in, the MCP tools and the list of maps work. Node 22 or newer; no install step.

The pages below are the story boards the map grew from, each a click-through in one HTML file (open it in a browser; no build, no server), and `site/index.html` is the landing page that went to heyanur.ai/living-map.

- **Next ›** or **→** / **Space**: one step forward. **‹ Back** or **←** / **Backspace**: one step back.
- Nothing moves until you click. Each click plays one step, then waits.

## Site (`site/index.html`)

The landing page for Living Map, with the plan-first story as an interactive demo: the visitor is the engineer. Claude plans on the map by itself (after 5 seconds, or on the button); the one call it can't make, keep or retire the nightly renewal job, is the visitor's. Each answer branches: keep it, and Claude builds from that; let it go, and the map blocks the merge of the pull request that deletes it, and asks again. Both end a week later on Sam's laptop, where Sam's Claude reads the decision from the map before it plans. Open the file in a browser; no build, no server.

`site/use-cases.html`, linked from the landing page's top bar, is the use cases page: what a project manager and an engineer each get from the map, three drawings for each, in the landing page's style.

## Scenario 1 (`index.html`)

1. The app as a mind map: what is built, and the decision the team made on each part.
2. You ask for a password reset flow. Claude plans it on the map first.
3. The plan as a list, worst first: ! critical, ⚠ warning (worth a glance), ✓ fair. Each
   row says what Claude assumed, what it means, the deployed team decision it touches,
   and the fix already named on the button. The path it sits on is the strip below.
4. Click the ⚠ row: a side chat slides in that knows the map and the chat. You ask why,
   Claude answers and proposes the change.
5. Apply it from there; fix the critical one and OK the fair one on their rows. The chat
   hears about it from the map.
6. Run. Each step ticks off as it is built.
7. Back out to the map, the branch checked.

## Journey (`journey.html`)

The story in 7 clicks, shown only with what the map does today. You own a draft of the system map and drive it with Claude Code; Priyanka, the PM, reviews from her own laptop; Sam's Claude starts later from what the team agreed. Switching people looks like changing laptops, and Priyanka sees a product view of the same map.

0. Your screen: production snapshot 41, drawn from the repo. Nothing changed yet.
1. You start a draft and ask Claude Code for a Pro plan with Stripe, and to remove the old renewal job. Claude draws its plan; the renewal job is dashed red because Claude assumed it could go. You ask Priyanka to review.
2. Priyanka's laptop, product view: she suggests keeping annual renewals and approves with that change.
3. Your laptop: you accept her change; Claude hears it and builds. Tests pass.
4. Check: the map sees Claude's migration replaced a field the renewal job still reads. It would renew 0 of 312 annual customers.
5. That goes back to Claude, which fixes the job and the data; released as snapshot 42.
6. Sam's laptop, a week later: his Claude starts from Priyanka's decision and leaves the renewal job alone.

`journey.html#3` opens at step 3, `#3a` plays step 3 from its start, and `?rec` hides Back/Next for recording. The 60-second voice-over, timed to the steps, is in [journey-script.md](journey-script.md).

## Plan first (`plan-first.html`)

Two agents and a team, one record, before and after the code.

0. The prompt, in plan mode.
1. Claude's plan is drawn on the team map in ink, no code yet; its guess (retire the renewal job) is dashed.
2. A notification brings Priyanka (PM) to her queue: one call from Claude, one from Codex.
3. She disputes with a click; the dashed line closes: keep the job for 312 annual customers.
4. Inside Billing, Sam's Codex plan sits on the same map and checks out against what was agreed.
5. You ask about upgrades on the flow: charged twice. Duy settles it.
6. Duy approves; Claude builds; the map checks #212's diff against the plan.
7. Sam's Codex opens #219: its code deletes the agreed schedule. The map strikes it and a check blocks the merge.
8. Sam says fix it; Codex reads the agreement from Living Map and restores it.
9. Nov 1, after the deploy: the decision held up, and the plan's ink settles into the system as it now runs.

`plan-first.html#5` opens at step 5; `?rec` hides the controls for recording; `?chat` shows a mock Claude Code chat beside the map (off by default: in the real demo the real chat sits there). The 60-second voice-over, timed to the steps, is in [plan-first-script.md](plan-first-script.md).

## Pro plan (`pro-plan.html`)

The map zooms like Google Maps: the system, then one box's infrastructure, then one route's
calls. Green is new, yellow changed, red removed; purple is what Claude assumed; amber is a risk.

0. The prompt is typed: add a Pro plan with the payment provider, retire the renewal job.
1. Claude builds it. Each edit colours its box, and the map files what Claude said it
   assumed: only the provider calls the new Payment confirmed route.
2. Priyanka asks on the map whether retiring the job is safe; Claude checks and answers; resolved.
3. You open Billing: the box grows into its infrastructure.
4. You select Payment confirmed: anyone on the internet can call it, and nothing checks who sent it.
5. Duy asks "so anyone can mark themselves paid?"; Claude owns the assumption.
6. You open the flow: the real payment, then the same customer faking it and getting Pro.
7. You ask a side chat (a read-only Claude) on the skipped check; it points at line 14.
8. You send the fix to Claude, which edits, runs the tests and pushes.
9. You replay the fake call: rejected.

`pro-plan.html#6` opens straight at step 6. `pro-plan.html?rec` hides the Back / Next
controls for recording; the arrow keys still step. **‹ System** and **‹ Billing** zoom back out.

`scenario-2.html` is a draft of a second story: you come back to a chat that is a wall of
tool lines, Claude asked something 58 steps ago, and the map has the question on top.

## Skills (`.claude/skills/`)

Claude Code picks these up in this repo.

- `frontend-design`: Anthropic's frontend-design skill, copied unchanged from [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) under its Apache 2.0 license (`LICENSE.txt`). The UI reviewer judges against it.
