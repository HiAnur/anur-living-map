# Journey: 60-second script

The voice-over for [`journey.html`](journey.html), 58 seconds. A narrator explains; you and Priyanka say your own lines in your own voices. One click per step: click when the step's first line starts.

Record at 1536×864 (or any 16:9 size) with `journey.html?rec`. `→` steps forward; `#0`…`#6` open a step's end state; `#3a` plays step 3 from its start.

| Time | Step | On screen | Who | Line |
|---|---|---|---|---|
| 0:00 | 0 | Production map; you start a draft and type the task | You | I start a draft of our system: a Pro plan on Stripe, and remove the old renewal job. |
| 0:06 | 1 | Claude's plan on your draft; its guess waits on Priyanka | Narrator | Claude Code and Codex write much of our code now. Living Map draws what they plan. Dashed red is a guess: Claude assumed the renewal job can go, so it asks Priyanka. |
| 0:18 | 2 | Priyanka decides; you accept; it goes back to Claude | Priyanka | Keep it for annual customers; new customers bill through Stripe. |
| 0:22 |  |  | You | I accept, and her decision goes back to Claude. |
| 0:25 | 3 | Priyanka and Duy approve; the design doc is saved; Claude builds | Narrator | She and Duy approve, the design doc is saved, and Claude builds what we agreed. |
| 0:31 | 4 | Sam's #219; the job struck one level down; the check blocks the merge | Narrator | Then my teammate Sam's Codex deletes that job in its pull request. It planned before Priyanka decided. Review passed; Living Map's check blocks the merge. |
| 0:42 | 5 | Codex reads the decision and restores the job | Narrator | Codex reads Priyanka's decision from Living Map and puts the job back. |
| 0:48 | 6 | Nov 1: production redrawn from the deploy; it held up | Narrator | November first: nine renewals ran. Her decision held up, and both agents read it. |
| 0:53 |  |  | You | Humans and AI agents, on the same page. |

## Voices

`video/journey-voiced.mp4` uses ElevenLabs stand-ins at 1.12× speed: Eric for the narrator, Will for you, Laura for Priyanka. Re-record with real voices before sending it anywhere. `video/journey-silent.mp4` is the same take with no voice and no captions, on the same timing, for recording over.

## Notes for the take

- **Step 4 is the aha.** Leave a beat after "Review passed;" before "Living Map's check blocks the merge."
- **Step 5 shows a Living Map call inside Codex.** Codex is marked preview because the Codex plugin isn't shipped. If the call isn't real in your recording, keep the label and don't claim it's live.
