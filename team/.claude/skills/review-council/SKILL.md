---
name: review-council
description: Run a standing panel of subagent reviewers (thesis guardian, Sr SDE, Principal Engineer, PM, beautiful-UI, keep-it-simple, and an Anthropic "sherlock test") that must all approve a plan, and later the built screenshots, before anything reaches the founder. Use for Living Map / Anur demo, story, pitch or UI work, or when the user says "run the council", "get the agents to agree", "review it from SDE/PE/PM angles", or "is this on thesis".
---

# Review council

The founder should not have to push for each fix. Before presenting a plan, a story, a UI or a build, run it past this panel, revise until every member approves, and bring the founder only the agreed result plus any choice the panel could not settle.

## The panel

Each member judges one thing, against a fixed yardstick. Full briefs are in [references/roles.md](references/roles.md).

| Member | Judges | Yardstick | Scores |
|---|---|---|---|
| Thesis guardian | Does it prove the company's thesis, nothing off-thesis | The YC application text, verbatim: [references/thesis.md](references/thesis.md) | Thesis fit |
| Senior SDE | Technical and workflow truth: would a squad work this way | Real engineering practice | Credibility |
| Principal Engineer | Governance, provenance, system of record, overclaims | An architecture review board | Credibility |
| PM | Does the PM's part read as real and worth it | A PM's week in their own tools | Would use weekly |
| Beautiful UI | Does it look good, calm, deliberate | `.claude/skills/frontend-design/SKILL.md` and Vercel's Web Interface Guidelines | Visual quality |
| Keep it simple | Can a first-time viewer retell it | 60–90 s with the sound low; 5-word test per step | Clarity |
| Sherlock test | Could Claude Code or another lab ship this natively | The labs' roadmaps | Share of the aha that is hard for them |

Add a member when the work needs one (e.g. a vibe coder or a junior engineer for "does it build understanding?"). Keep the panel's briefs fresh: reviewers who wrote the plan judge it too kindly, so the story architect and the reviewers are separate agents.

## Process

1. **Write one shared plan file** (e.g. `council/plan-vN.md` in the scratchpad): the thesis lines, the founder's fixed decisions (marked "do not reopen"), the story step by step, the visual system, and what earlier rounds changed and why. Every member reads the same file.
2. **Round 1, in parallel.** Spawn or message every member with the file path and their brief. Ask for:
   - `VERDICT: APPROVE` or `BLOCK`
   - `MUST-FIX` (max 5, each "step → exact change")
   - votes on any open questions
   - a 1–10 score on their dimension (the bar is 8)
   - a word limit (≤250 words in round 1, ≤150 later)
3. **Revise.** Merge the must-fixes into `plan-v(N+1).md`. Where members disagree, settle it in this order and write the resolution and the reasons into the file:
   1. the founder's fixed decisions
   2. the thesis (YC text)
   3. credibility (nothing an engineer would call staged)
   4. clarity
   5. visual polish

   Prefer a resolution that satisfies both sides (e.g. "two lines on the card, provenance moved into the strike's label").
4. **Next round:** send each member the new file, list which of their fixes landed and which resolutions went against their vote, and ask for a verdict only on what remains. Don't let them re-raise settled items.
5. **Stop** when all approve, or after 3 rounds per gate. Bring the founder the remaining disagreement as a short choice with a recommendation.
6. **Present to the founder** only the consensus: the plan, the scores, and anything that depends on them (e.g. "credible at 9 only if the Codex screen is real in the recording"). Never build before the founder confirms.

## Two gates

- **Plan gate:** story and visual system, before any code.
- **Build gate:** after building, screenshot every step and send the images to the same panel. Static screenshots only show end states, so transient beats (a notification, a queue) must have their own step to be judged. Screenshot recipe: [references/screenshots.md](references/screenshots.md).

## Habits that came out of running this

- Run the sherlock test whenever the story starts to lean on one vendor's built-in feature (e.g. a plan mode). If most of the runtime is "native" or "shippable" for the vendor, the demo has drifted.
- Ask "what can a single session not do?" The answers (several agents, people outside the chat, a record that lasts, a check against what ran) are where the story should spend its time.
- Colour, dash and label rules from the UI member are law for every later round. For example, red means removed, so never use it for emphasis.
- Founder feedback that arrives mid-way (e.g. "no outro", "keep the PM") goes into the fixed decisions immediately.
