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

`scenario-2.html` is a draft of a second story: you come back to a chat that is a wall of
tool lines, Claude asked something 58 steps ago, and the map has the question on top.
