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

/** The part of node:sqlite this code uses; a row comes back untyped. */
interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: any[]): unknown;
    get(...values: any[]): any;
  };
}
