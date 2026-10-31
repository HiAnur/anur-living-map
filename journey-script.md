# Journey: walkthrough script

The voice-over for [`journey.html`](journey.html), about 116 seconds. A narrator explains the demo; you, Priyanka and Duy each say your own line in your own voice. One click per step: click when the step's first line starts.

Record at 1536×864 (or any 16:9 size) with `journey.html?rec`. `→` steps forward. `#0`…`#8` open a step's end state; `#3a` plays step 3 from its start.

| Time | Step | On screen | Who | Line |
|---|---|---|---|---|
| 0:00 | 0 | Acme's system; you type the task into Claude Code | Narrator | This is Acme's system on Living Map. Customers use the web app, it calls our API and Postgres, and a renewal job bills annual customers every night. |
| 0:10 |  |  | You | I ask Claude Code for a Pro plan with Stripe, and to remove the old renewal job. |
| 0:15 | 1 | Claude's plan is drawn; the renewal job waits on Priyanka | Narrator | Our agents write much of our code now. Living Map reads their sessions and draws what they plan, before any code. Blue is new, amber is changed. The renewal job is dashed red: Claude assumed it could go, so it waits on Priyanka. |
| 0:31 | 2 | Priyanka's notification; she disputes on the box | Narrator | Priyanka owns the ticket. She gets the question on her own screen. |
| 0:36 |  |  | Priyanka | No. 312 annual customers still renew through that job. Keep it for them; new customers pay through Stripe. |
| 0:42 |  |  | Narrator | Her answer goes on the ticket, and back to Claude. |
| 0:46 | 3 | One level down: the renewal job's infrastructure and Codex's plan | Narrator | One level down, Sam's Codex has its own plan on the same map. It removes three schedules Stripe now handles, and leaves the renewal job alone. |
| 0:55 | 4 | Payment confirmed as a sequence diagram; charged twice | Narrator | The payment flow opens as a sequence diagram. |
| 0:59 |  |  | You | What happens to an annual customer who upgrades to Pro mid-term? |
| 1:03 |  |  | Narrator | Stripe bills them, and our job bills them again. Charged twice. That's Duy's call. |
| 1:10 | 5 | Duy confirms and approves; Claude builds #212 | Duy | Skip anyone on Stripe. Approved. |
| 1:14 |  |  | Narrator | Claude builds it, and Living Map checks the code matches the plan. |
| 1:19 | 6 | Sam's #219; the strike; the check blocks the merge | Narrator | Then Sam's Codex opens a pull request. Review passed, but its code removes the job Priyanka kept. |
| 1:26 |  |  | Narrator | Living Map's check blocks the merge. Both reviews passed; without the map, 312 customers would have stopped renewing. |
| 1:35 | 7 | Codex reads the decision and restores the job | Narrator | Sam tells Codex to fix it. Codex reads Priyanka's decision from Living Map, and puts the job back. |
| 1:42 | 8 | Nov 1: redrawn from main; it held up | Narrator | November first. Priyanka's call held up: nine renewals ran, and upgrades were billed once. |
| 1:49 |  |  | You | Humans and AI agents, working from one record, on the same page. |

## Voices

The cut in `video/journey-voiced.mp4` uses ElevenLabs stand-ins at 1.1× speed. Re-record with real voices before sending it anywhere.

| Who | Stand-in voice | Re-record by |
|---|---|---|
| Narrator | Eric | the founder |
| You | Will | the founder, as yourself |
| Priyanka | Laura | Priyanka, or a teammate |
| Duy | Chris | Duy |

`video/journey-silent.mp4` is the same take with no voice and no captions, on the same timing, for recording over.

## Notes for the take

- **Let each step finish.** Steps 2 and 4 animate longest; if a line runs short, hold the click.
- **Step 6 is the aha.** Leave a beat after "Both reviews passed;" before "without the map".
- **Step 7 shows a Living Map call inside Codex.** Codex is marked preview because the Codex plugin isn't shipped. If the call isn't real in your recording, keep the label and don't claim it's live.
