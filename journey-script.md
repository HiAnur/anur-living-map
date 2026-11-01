# Journey: 60-second script

The voice-over for [`journey.html`](journey.html), 60 seconds. A narrator explains; you and Priyanka say your own lines. One click per step: click when the step's first line starts. Steps 2, 3 and 6 open with a laptop switch of about 1.5 s, so their first line starts after it.

Record at 1536×864 (or any 16:9 size) with `journey.html?rec`. `→` steps forward; `#0`…`#6` open a step's end state; `#3a` plays step 3 from its start.

| Time | Step | On screen | Who | Line |
|---|---|---|---|---|
| 0:00 | 0 | Your laptop: production snapshot 41 | You | Today, annual plans renew through our own nightly job, drawn here from our repo. |
| 0:05 | 1 | Your laptop: draft, your request, Claude's plan, the dashed renewal job, the review request | You | I ask Claude Code for a Pro plan on Stripe, and to drop that job. |
| 0:09 |  |  | Narrator | Claude draws its plan before writing any code. Dashed red is a guess: it assumed the job can go. |
| 0:15 |  |  | You | So I ask Priyanka. |
| 0:18 | 2 | Switch to Priyanka's laptop: product view; she suggests a change and approves | Narrator | On her laptop, Priyanka sees only the parts she owns. |
| 0:22 |  |  | Priyanka | Wait, 312 customers still renew through that job. Keep it. Approved. |
| 0:28 | 3 | Switch back to your laptop: you accept; Claude builds; tests pass | You | I accept, and send it to build. Claude writes it, and every test passes. |
| 0:33 | 4 | Check: Users DB changes, the link to the renewal job lights up, ✕ 0 of 312 | Narrator | But Living Map reads Claude's session as it builds. The migration renamed a field the renewal job reads. Those 312 customers would never renew. |
| 0:42 | 5 | Back to Claude: fixed; snapshot 42 | Narrator | Claude gets that back and fixes it. Once merged, the map is redrawn as snapshot 42. |
| 0:49 | 6 | Switch to Sam's laptop: his Claude starts from Priyanka's decision | Narrator | A week later, Sam's Claude reads snapshot 42 first, and leaves Priyanka's job alone. |
| 0:54 |  |  | Narrator | Every change that ships becomes the next snapshot, so everyone starts from what the team agreed. |

## Voices

`video/journey-voiced.mp4` uses ElevenLabs `eleven_v4` stand-ins at 1.2× speed: Eric for the narrator, Will for you, Laura for Priyanka. Re-record with real voices before sending it anywhere. `video/journey-silent.mp4` is the same take with no voice and no captions, on the same timing, for recording over.

## Notes for the take

- **Step 4 is the aha.** Let "Those 312 customers would never renew" land before the next click.
- **Everything shown is claimed in the YC application today:** Living Map reads Claude's session, draws the plan and the changes from the repo, sends answers back to the agent, and the next session starts from what the team agreed. The "0 of 312" is inferred from code, and the screen says so.
