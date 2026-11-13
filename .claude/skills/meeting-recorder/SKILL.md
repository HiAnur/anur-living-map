---
name: meeting-recorder
description: How a meeting becomes a Living Map — the Living Map Recorder Mac app in mac/, the /api/meetings routes, the meeting file format and its turns, and the meeting's own extractor instructions. Use when working on the recorder, meeting transcripts, live meeting maps, importing a transcript, or when a meeting's map files nothing.
---

# Meeting recorder

A meeting is followed and filed like a chat: the server writes what the
recorder sends to a file, reads that file into the map's own entries and
turns, and the ledger files sealed turns as usual. Only three things differ
from a chat, all keyed on a conversation id starting `meeting-`
(`isMeetingConv` in `shared/ledger.ts`):

- **Reading**: `ledger/routes.ts` hands the ledger and side chats a reader that
  sends `*.meeting.jsonl` files to `readMeeting` (`ledger/meeting/file.ts`)
  and everything else to the agent's `readMore`.
- **Filing**: `ledger/follow/run.ts` uses `MEETING_SYSTEM` and
  `meetingMessage` (`ledger/meeting/prompt.ts`), pinned in
  `ledger/fixtures/meeting-system.txt`; runs are kept under
  `MEETING_PROMPT_ID`. No sweep runs on a meeting.
- **Skipped**: no "what changed" snapshots, no late-link skipping (a meeting
  is filed whole), nothing told to a chat (`tellChat` returns).

## The file and its turns

`<home>/meetings/<conv>/transcript.meeting.jsonl` (the folder is the meeting's `cwd`, all a side chat on it may read), one JSON line each: `meeting` (title,
`imported`), `segment` (`speaker` you|others, optional `name`, `text`,
`start`/`end` in ms), `pause`, `end`. `createMeetings`
(`ledger/meeting/meetings.ts`) is the only writer.

- A turn starts with the first words after a pause, and again once it has
  run `CHUNK_MS` (60 s) or `CHUNK_WORDS`; an imported transcript has no times
  and cuts at `IMPORT_CHUNK_WORDS`.
- A `pause` (written after `PAUSE_MS` of silence) or `end` closes the turn
  like a finished reply, so it seals after `SEAL_IDLE_MS`. Talk after a pause
  is a new turn: a filed turn never grows.
- Lines read as `You: …`, `Others: …` or `<Name>: …` (`said` in `file.ts`).

## Routes

`ledger/meeting/routes.ts`, mounted at `/api/meetings` in `server/http.ts`,
token required like every `/api` route (listed in `server/auth.test.ts`):
`POST /` start, `POST /import` a pasted transcript (`parseTranscript` reads
"Name: words", leading times, and a name alone on its line), `POST
/:conv/segments`, `POST /:conv/end`, `POST /:conv/open` for a fresh sign-in
path. Start and import answer a one-time sign-in `url` that lands on the map.

## The Mac app

See `mac/README.md` for building, running, permissions and its tests.

## Check a change

```bash
npx vitest run ledger/meeting server/auth.test.ts
```

To watch a meeting mapped by the real model, run a test server
(`LIVING_MAP_HOME=<test home> PORT=4399 node server/index.ts`, never port 4317
with your own home), `POST /api/meetings` with the token from
`<test home>/token`, send segments, and open the returned `url` on
`http://localhost:4399`. It calls the model: a few cents per meeting-minute.
