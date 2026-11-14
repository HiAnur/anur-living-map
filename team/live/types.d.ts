// The shapes team/live's modules pass around, for the type check only:
// nothing imports this file and nothing runs it. A shape that says
// `[more: string]: any` allows fields not named here, so a module can be
// typed before every field it carries is listed.

/** Someone's name on the map, or nothing when the request is signed out. */
type Who = string | null | undefined;

/** A request as the access rules read it: its address and its headers. */
interface Req {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface Person {
  id: string;
  role?: string;
  [more: string]: any;
}

/** Who is on a map and who was taken off it. */
interface Members {
  people?: Person[];
  removedPeople?: string[];
  /** Who owns the map: whoever made it. Unset on a map kept from before maps recorded it. */
  admins?: string[];
}

interface LinkSharing {
  mode: string; // "restricted", "view" or "edit"
  token?: string;
}

interface ActionCompletion {
  status?: string;
  evidence?: unknown[];
  [more: string]: any;
}

/**
 * Where an Action came from when nobody made it by hand: the words of its author it was made from ("meeting",
 * "chat", "prompt"), or Claude's suggestion someone applied ("suggested"). `took` marks an item someone else's
 * words named them for, which they took on; `said` is whose words those were.
 */
interface ActionFrom {
  kind: string;
  quote?: string;
  at: number;
  took?: boolean;
  said?: string;
}

/**
 * The words an Action draft may be made from (action-items.js): only `who`'s own, as `lines`. `id` is what the
 * cap per source counts by (one meeting, or one chat a day); speech is `spoken`, and matched loosely.
 */
interface WordsSource {
  kind: "meeting" | "chat" | "prompt";
  id: string;
  who: string;
  lines: string[];
  spoken?: boolean;
}

/** What became of one item Claude proposed from someone's words: a box made, a note on a box already there, or why not. */
type ItemOutcome = { title: string } & ({ made: string } | { info: string; for: string } | { merged: string } | { refused: string });

/** A box's Action: the task planned for it and how far it got. */
interface BoxAction {
  stage: string;
  source?: string;
  plan?: unknown;
  completion?: ActionCompletion;
  [more: string]: any;
}

interface Box {
  id: string;
  label: string;
  sub?: string;
  desc?: string;
  inside?: { nodes: Box[]; edges: Line[] };
  action?: BoxAction;
  task?: unknown;
  [more: string]: any;
}

/**
 * A box as the layout code handles it. Layout reads and writes a box's
 * place and size, and runs on boxes that have little else, so it takes
 * them untyped.
 */
type LayoutBox = any;

interface Line {
  from: string;
  to: string;
  label?: string;
  [more: string]: any;
}

/** What the sharing rules read of a map: its people and its link. */
interface Shared extends Members {
  linkSharing?: LinkSharing;
}

/** A map as it is kept and sent to the page. */
interface MapState extends Shared {
  nodes: Box[];
  edges: Line[];
  [more: string]: any;
}

/** What an Action is to do, once it is ready to review. */
interface Brief {
  kind: string; // "email", "build" or "other"
  goal: string;
  target: string;
  result: string;
  steps: string[];
  tools?: string[];
  email?: { to: string; subject: string; body: string };
}

/** What an Action run may send and run, checked in each tool call's input before it runs (action-sends.js). */
interface SendGuard {
  /** the reviewed email: every send must be exactly this, and with none, no mail may go */
  message?: { to: string; subject: string; body: string };
  /** how many sends the run may still make: 1, or 0 once the Action has sent */
  left: number;
  /** nobody clicked Execute: the shell may not write to GitHub or the web, nothing may be sent but the reviewed email, and `unknown` tools are refused */
  unattended?: boolean;
  /** the brief's tools the map does not know (neither the agent's own nor on the list in action-sends.js) */
  unknown?: string[];
}

/** What a run of an Action came back with. */
interface RunResult {
  text: string;
  blocked: boolean;
  completion?: ActionCompletion;
  /** every tool call the run made, as the agent's own stream reported it */
  calls?: ToolCall[];
}

/** One tool call a run made: its input, whether it succeeded (null when no result came back) and what it returned. */
interface ToolCall {
  tool: string;
  input: unknown;
  ok: boolean | null;
  output: string;
  /** the agent knows this tool only reads, so it changed nothing */
  reads?: boolean;
  /** a few words of what the call was, written by the agent's adapter (a shell call's command) */
  summary?: string;
}

/** Stops a job under way; a job that never started has none. */
type Stop = (() => void) | null | undefined | void;

// One of the map's own MCP servers handed to an agent: how to start it over stdio, and the tools it may call.
interface McpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
  tools: string[];
}
type McpServers = Record<string, McpServer>;

// What the team map asks of the agent it works with (agent.js). Each job is the map's: its prompt, its schema,
// its servers. How the agent is started, named and limited stays in that agent's folder under agents/.
/** How far a tool reaches (AgentWorker.reach): an Action that reaches no other person may run on its own. */
type ToolReach = 'reads' | 'files' | 'shell' | 'others';
interface AgentWorker {
  name: string;
  // the words an answer is replaced by when the agent is signed out, so the page can offer to sign in
  signedOut: string;
  signIn(): Promise<boolean>;
  // one read-only answer, streamed, over the project's files and the given servers; `propose` names the tool
  // whose last call is the change offered, handed back as onDone's third argument
  ask(job: AskJob): Stop;
  // lookups only, held to `schema`; reports which tools it could use
  prepare(job: PrepareJob): Stop;
  // carries out a reviewed task in a resumable session, limited to `tools`, held to `schema`
  run(job: RunJob): Stop;
  // how far a tool reaches: it only reads, changes files here, is the shell, or may reach other people
  reach(tool: string): ToolReach;
  // one turn of a headless chat the map runs itself, resumed by session id
  converse(job: ConverseJob): () => void;
  // one answer held to `schema`, with no tools and nothing read but the prompt (drawing a system map from facts)
  answer(job: AnswerJob): Promise<AnswerResult>;
}
// Your own chats with the agent, as the map follows and opens them (agent.js `chats`).
interface AgentConversation {
  // follow a chat's transcript as it grows: your words, its replies, what it is doing now
  follow(file: string, onChange: (msgs: any[]) => void, options?: { anyUser?: boolean }): {
    stop(): void; msgs(): any[]; readNow(): any[]; img(id: string): { type: string; data: string } | undefined;
    model(): { id: string; effort: string | null } | null; status(): { working: boolean; doing: string; at: number; since?: number };
  };
  findChat(session: string): string | null; // a chat's transcript by its id, once it exists
  findNewChat(o: { folder: string; since: number; holding: string }): string | null; // a chat started in `folder` since then, whose words hold `holding`
  isChat(file: string, session: string): boolean; // whether `file` is that chat's transcript
  owns?(file: string): boolean; // whether `file` is in this agent's transcripts at all, so it is the one to follow it
  sessionOf?(file: string): string; // a chat's id from its transcript's path (the file's name when absent)
  openNew(o: { prompt: string; folder: string }): void; // a new chat in the agent's app, starting with `prompt`
  skillDir(name: string): string; // where the agent keeps an installed skill
  skillDirs?(name: string): string[]; // where every agent the map knows keeps it (agent.js allChats)
  connectTools(): string; // register the map's MCP server with the agent; what to tell you, or '' when it already was
}
// What a Pi process the map starts is handed through the file LIVING_MAP_PI_JOB names (agents/pi/extension.js).
interface PiJob {
  servers?: McpServers;
  /** held to this, the answer comes back as the last call to submit_answer */
  schema?: object;
  /** every tool not named here is refused, with `allowReason` */
  allow?: string[];
  allowReason?: string;
  /** shell commands matching one of these regular expressions are refused, with `blockReason` */
  block?: string[];
  blockReason?: string;
  /** an Action run's sends and shell writes, checked by action-sends.js */
  guard?: SendGuard;
}
// What one Pi run left: its words as they streamed, its last reply's words, its tool calls, the tools it was
// given, the answer it submitted, and why it ended without one.
interface PiRun {
  words: string;
  text: string;
  calls: ToolCall[];
  tools: string[];
  value?: unknown;
  error: string | null;
  cost: number;
  stopped: boolean;
  timedOut: boolean;
  notFound: boolean;
}
interface AskJob {
  cwd: string;
  /** more folders it may read, read-only: a system map's code */
  dirs?: string[];
  prompt: string;
  servers?: McpServers;
  propose?: { server: string; tool: string };
  onText: (text: string, proposing?: boolean) => void;
  onDone: (text: string, access?: undefined, proposed?: unknown) => void;
}
interface PrepareJob {
  cwd: string;
  prompt: string;
  connected?: boolean; // may use the person's own connectors and settings
  servers?: McpServers;
  schema: object;
  onText: (words: string) => void;
  onDone: (text: string, access: { tools: string[]; denied: string[] }, value?: unknown) => void;
}
interface RunJob {
  cwd: string;
  session: string;
  resume?: boolean;
  prompt: string;
  tools?: string[];
  /** what code checks in each call before it runs, beyond the tool's name (action-sends.js) */
  guard?: SendGuard;
  schema: object;
  system: string;
  read: (value: unknown) => any;
  onText: (words: string) => void;
  onDone: (result: RunResult) => void;
}
interface AnswerJob {
  prompt: string;
  schema: object;
  model?: string;
  timeoutMs?: number;
  /** stops the agent, answering `stopped` */
  signal?: AbortSignal;
}
/** An answer held to its schema, or why there is none, and what it cost (in the agent's own unit). */
interface AnswerResult {
  value?: unknown;
  error?: string;
  cost?: { value: number; unit: string };
  ms: number;
  stopped?: boolean;
}
interface ConverseJob {
  cwd: string;
  session: string;
  first: boolean;
  title: string;
  system: string;
  prompt: string;
  // the map's own tool servers, the only tools the chat may use
  servers: McpServers;
  onClose: () => void;
}

/** The part of node:sqlite this code uses; a row comes back untyped. */
interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: any[]): unknown;
    get(...values: any[]): any;
  };
}

// ---- the map's objects ------------------------------------------------------
// What a box, a line and a memory are meant to be: one parent that gives
// every object an id, a type, a name and its dates, and each kind built on
// it. Maps are not stored in this shape yet (a line has no id of its own, a
// box's type is split over `boxType` and `kind`, a box's second line is
// `sub`). objects.js reads what is stored as these objects and says what
// each still lacks, so the shape can be settled before any map is changed.

/** What every object on a map has. */
interface MapObject {
  id: string;
  type: string;
  name: string;
  createdAt: number | null; // null: made before dates were kept
  updatedAt: number | null;
  createdBy?: string;
  updatedBy?: string;
}

/** Where a box sits and how big it is drawn. */
interface Place {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

interface BoxBase extends MapObject {
  description: string; // the line or two under the name; "" when it has none
  notes: string; // what opens with the box; "" when it has none
  state?: string; // "new", "todo", "assumed-gone" or "gone"
  area?: string; // who may see it, when not everyone
  place?: Place; // absent until it has been given one
  inside?: { boxes: BoxObject[]; lines: LineObject[] }; // the map it opens into
}

/** A box that organizes: a topic, a person at the edge, a system outside. */
interface TopicBox extends BoxBase {
  type: "topic" | "actor" | "external";
}

/** A box that is a task to carry out: only this kind carries a plan or a run. */
interface ActionBox extends BoxBase {
  type: "action";
  task?: unknown; // what a planner proposed for it
  action?: BoxAction; // absent until someone begins it
}

type BoxObject = TopicBox | ActionBox;

/**
 * A line between two boxes. "contains" is the map's tree: the box at `to`
 * hangs under the box at `from`, and needs no name. "flow" is anything
 * else one box does to another, and its name says what.
 */
interface LineObject extends MapObject {
  type: "contains" | "flow";
  from: string;
  to: string;
  state?: string;
}

/** Something kept in mind on a map, or a rule for it; its name is its text. */
interface MemoryObject extends MapObject {
  type: "instruction" | "memory";
  box: string | null; // the box it is about; null for the whole map
}

/** What an object still lacks to be whole in this shape. */
interface ObjectGap {
  id: string;
  kind: "box" | "line" | "memory";
  lacks: "name" | "description" | "dates";
}

// An action as its handler gets it, read from its schema in commands.js: each field it names, typed by its kind
// (an `id` may be text or a number; a field marked `?` may be missing or null), plus who takes it. `created` is
// what add hands back: the id of the box it drew. `type` is missing when the map calls a handler itself.
type Commands = typeof import("./commands.js").COMMANDS;
interface KindType {
  id: string | number;
  text: string | number;
  string: string;
  number: number;
  boolean: boolean;
  array: any[];
  object: Record<string, any>;
  any: any;
}
type KindOf<S> = S extends `${infer K}?` ? K : S;
type FieldType<S> = KindType[KindOf<S> & keyof KindType];
type Act<T extends keyof Commands> = { type?: T; by: string; created?: string } & {
  -readonly [F in keyof Commands[T] as Commands[T][F] extends `${string}?` ? never : F]: FieldType<Commands[T][F]>;
} & {
  -readonly [F in keyof Commands[T] as Commands[T][F] extends `${string}?` ? F : never]?: FieldType<Commands[T][F]> | null;
};
