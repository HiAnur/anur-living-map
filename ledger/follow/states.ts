// Where a follower is, as two small machines that run side by side: reading
// its chat's transcript, and filing what it read (a read may happen while a
// filing is under way). Each state comes from the follower's fields, and each
// event changes those fields only here, so states.test.ts holds the whole
// table.

import { backoff, type Follower } from "./follower.ts";

export type ReadState = "not read" | "reading first" | "read" | "reading";
export type ReadEvent =
  | "start" // a read begins
  | "first view" // the first read gave turns: filing may start
  | "end" // a read ends, however it went
  | "restart"; // the chat goes on in another file: read it from its start

export type FileState = "idle" | "filing" | "backing off";
export type FileEvent =
  | "succeeded" // a run's answer was saved and applied
  | "failed"; // a run failed: wait longer after each failure in a row

type Reading = Pick<Follower, "readOnce" | "readBusy">;
type Filing = Pick<Follower, "running" | "failures" | "retryAt">;

export const readState = (f: Reading): ReadState =>
  f.readBusy
    ? f.readOnce
      ? "reading"
      : "reading first"
    : f.readOnce
      ? "read"
      : "not read";

export function onRead(f: Reading, e: ReadEvent): void {
  if (e === "start") f.readBusy = true;
  else if (e === "end") f.readBusy = false;
  else if (e === "first view") f.readOnce = true;
  else f.readOnce = false;
}

// a new read waits for the one under way
export const mayRead = (f: Reading) => !f.readBusy;
// the follower has read its chat at least once, so its turns can be filed
export const hasRead = (f: Reading) => f.readOnce;

export const fileState = (f: Filing, now: number): FileState =>
  f.running ? "filing" : f.failures && now < f.retryAt ? "backing off" : "idle";

export function onFile(f: Filing, e: FileEvent, now: number): void {
  if (e === "failed") {
    f.failures++;
    f.retryAt = now + backoff(f.failures);
  } else {
    f.failures = 0;
    f.retryAt = 0;
  }
}
