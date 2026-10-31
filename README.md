# Living Map demo

A click-through mockup of [Living Map](https://github.com/HiAnur/living-map): what the map
shows while you ask Claude Code for a feature, before it builds anything.

Open `index.html` in a browser. No build, no server.

- **Next ›** or **→** / **Space**: one step forward. **‹ Back** or **←** / **Backspace**: one step back.
- Nothing moves until you click. Each click plays one step, then waits.

## Scenario 1 (`index.html`)

1. The app as a mind map: what is built, and the decision the team made on each part.
2. You ask for a password reset flow. Claude plans it on the map first.
3. The plan: the feature as the user walks it, left to right. Under each step, what Claude
   assumed (purple), what the team already settled there and why (green, deployed), and
   where to look twice: ⚠ think about this, ! risky.
4. You fix and confirm on the boxes. The chat hears about it from the map.
5. Run. Each step ticks off as it is built.
6. Back out to the map, the branch checked.

`scenario-2.html` is a draft of a second story: you come back to a chat that is a wall of
tool lines, Claude asked something 58 steps ago, and the map has the question on top.
