// The shapes team/live's modules pass around, for the type check only:
// nothing imports this file and nothing runs it. A shape that says
// `[more: string]: any` allows fields not named here, so a module can be
// typed before every field it carries is listed.

/** Someone's name on the map, or nothing when the request is signed out. */
type Who = string | null | undefined;

/** A request as the access rules read it: its address and its headers. */
interface Req {
  url?: string;
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

/** What a run of an Action came back with. */
interface RunResult {
  text: string;
  blocked: boolean;
  completion?: ActionCompletion;
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
  // one turn of a headless chat the map runs itself, resumed by session id
  converse(job: ConverseJob): () => void;
}
// Your own chats with the agent, as the map follows and opens them (agent.js `chats`).
interface AgentConversation {
  // follow a chat's transcript as it grows: your words, its replies, what it is doing now
  follow(file: string, onChange: (msgs: any[]) => void, options?: { anyUser?: boolean }): {
    stop(): void; msgs(): any[]; img(id: string): { type: string; data: string } | undefined;
    model(): { id: string; effort: string | null } | null; status(): { working: boolean; doing: string; at: number; since?: number };
  };
  findChat(session: string): string | null; // a chat's transcript by its id, once it exists
  findNewChat(o: { folder: string; since: number; holding: string }): string | null; // a chat started in `folder` since then, whose words hold `holding`
  isChat(file: string, session: string): boolean; // whether `file` is that chat's transcript
  openNew(o: { prompt: string; folder: string }): void; // a new chat in the agent's app, starting with `prompt`
  skillDir(name: string): string; // where the agent keeps an installed skill
  connectTools(): string; // register the map's MCP server with the agent; what to tell you, or '' when it already was
}
interface AskJob {
  cwd: string;
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
  schema: object;
  system: string;
  read: (value: unknown) => any;
  onText: (words: string) => void;
  onDone: (result: RunResult) => void;
}
interface ConverseJob {
  cwd: string;
  session: string;
  first: boolean;
  title: string;
  system: string;
  prompt: string;
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
