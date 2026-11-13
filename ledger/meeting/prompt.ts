// What the extractor is told when the map follows a meeting instead of a
// chat: the same kinds, states and schema (extract.ts), with what each means
// in a meeting, and turns shown as what was said. Pinned in
// ledger/fixtures/meeting-system.txt: change both together.

import { checklist, clip, promptId, renderMap, SCHEMA } from "../extract.ts";
import { KINDS, STATES, type Kind, type Store } from "../items.ts";
import type { Turn } from "../transcript.ts";

const GUIDE: Record<Kind, string> = {
  topic:
    "what a stretch of the meeting is about. Every new turn belongs to a topic: an existing one, or a new one you create.",
  question:
    'something asked in the meeting that still needs an answer. owner "you" only when it was put to the user and waits for their answer; otherwise no owner.',
  option:
    "one of several choices discussed for a question; its parent is that question. Mark it taken only when the meeting shows it was chosen.",
  decision: "something the meeting settled that later work relies on.",
  task: 'an action item: work someone took on or was given. owner "you" only when the user took it on or it was given to them; otherwise no owner, and the title names who, when the meeting says ("Priya: send the pricing deck").',
  ask: "someone in the meeting waiting on the user for something only they can give (an approval, a document, an introduction, a decision).",
  assumption: "something taken as true in the meeting without being checked.",
  finding:
    "a fact stated that matters later: a number, a date, a deadline, a constraint, a status.",
};

const kindLine = (k: Kind) =>
  `- ${k}${k === "topic" ? "" : ` (${STATES[k].join(", ")})`}: ${GUIDE[k]}`;

export const MEETING_SYSTEM = `You keep a map of one meeting while it happens: what is discussed, asked, decided and left to do. The words come from live speech recognition: lines starting "You:" are the user (the person keeping this map, on their microphone), lines starting "Others:" or with a person's name are everyone else on the call. Recognition makes mistakes: read past misheard words, and never file a misheard phrase as a fact. You are shown the map so far (as a Mermaid mindmap: each item has an id like i12, a type and a state on the ":::" line under it) and the meeting's NEW TURNS, each about a minute of talk. Answer only through the schema, with changes to the map.

Kinds and their states (the first is where a new one starts):
${KINDS.map(kindLine).join("\n")}

Rules:
- File what someone who missed the meeting would need: decisions, action items, open questions, and the facts they rest on. Skip greetings, small talk, filler and audio trouble ("can you hear me?").
- Prefer updating an existing item over creating a near-duplicate: people come back to the same point in new words. When a question is answered, an option is chosen, or an action item is done or dropped, update its state.
- Every batch, check the map's open items against the new turns: an item the meeting has answered, settled or moved past gets its new state.
- Options only when at least two were discussed for the same question.
- A decision's "body" says why it was taken, in one line, when the meeting gives a reason.
- An action item's "body" says when it is due, when the meeting says so.
- Never set owner "claude": nobody in a meeting is Claude.
- "links" ties an item to another when the meeting shows it, and only then: {"rel": "blocks", "to": <id or ref>} on a question or ask whose answer work is waiting for; {"rel": "answers", "to": <id>} on a decision or option that settles a question. Most items have none.
- Every create needs "quote": words copied exactly from the turn named in "turn" (at most 25 words, without the speaker's label). An update that changes state should quote the turn that shows it.
- "turn" is always one of the NEW TURNS. Name new items "new1", "new2", ...; you may use those refs as parents later in the same answer.
- A non-topic item's parent is the item it belongs under (an option under its question), or its topic.
- "topics" gives, for every new turn, the id or ref of its topic.
- Titles are short (under 12 words), in plain words, saying what the item is.
- Never invent: if the turns don't show it, don't file it.`;

export const MEETING_PROMPT_ID = promptId(MEETING_SYSTEM, SCHEMA);

const TURN_MAX = 12_000;
const clock = (ts: number) =>
  ts
    ? new Date(ts).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

// a turn as the model reads it: everything said in it, one line each
export const spoken = (t: Turn) =>
  [t.text, ...t.reply.split(/\n\n+/)].filter((l) => l.trim()).join("\n");

export function renderMeetingTurns(turns: Turn[]): string {
  return turns
    .map((t) => {
      const at = clock(t.ts);
      const until = clock(t.end);
      const when = at
        ? ` (${at}${until && until !== at ? `–${until}` : ""})`
        : "";
      return `TURN ${t.n} · MEETING${when}:\n${clip(spoken(t), TURN_MAX)}`;
    })
    .join("\n\n");
}

export function meetingMessage(s: Store, turns: Turn[]): string {
  return `MAP SO FAR:\n${renderMap(s)}\n\nSTILL OPEN (for each, do the new turns answer, settle, drop or move past it? If so, update it):\n${checklist(s)}\n\nNEW TURNS:\n${renderMeetingTurns(turns)}`;
}
