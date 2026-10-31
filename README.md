# Living Map demo

A click-through mockup of [Living Map](https://github.com/HiAnur/living-map): what the map
shows while you ask Claude Code for a feature, before it builds anything.

Open `index.html` in a browser. No build, no server.

- **Next ›** or **→** / **Space**: one step forward. **‹ Back** or **←** / **Backspace**: one step back.
- Nothing moves until you click. Each click plays one step, then waits.

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
