// The kinds of task an Action box carries out, and what each means to the map. The schema preparation answers
// with, the check of that answer, the run and code's verification of it all read this table, so a kind is added
// here or nowhere; action-kinds.test.js fails when one of them names a kind the table does not hold.
//
//   does       what it does, in the words people read
//   email      its brief carries the exact recipient, subject and body (`brief.email`)
//   toolless   it may finish in Claude's reply alone, with no tool
//   branch     it runs on a new branch in its own worktree, and code commits, pushes and opens the pull request
//   proof      what code accepts as proof it was done, from the tool calls the run made (action-evidence.js):
//              'sent' a successful send whose to-field is the brief's one recipient, with no one copied, 'pull' a pull request GitHub confirms,
//              null nothing code can check, so its author confirms it
//   alone      it may run with no click, when its author chose that and no tool its brief needs reaches another person
//
// Preparation names the kind, but code has the last word from the tools the brief needs (kindFromTools).
import { mailTool } from './action-sends.js';

/** @typedef {{ does: string, email: boolean, toolless: boolean, branch: boolean, proof: 'sent' | 'pull' | null, alone: boolean }} ActionKind */

export const ACTION_KINDS = /** @type {const} */ ({
  email: { does: 'Sends one email to the exact recipient, with the subject and body you reviewed.', email: true, toolless: false, branch: false, proof: 'sent', alone: false },
  build: { does: 'Changes code on a new branch and ends in a pull request.', email: false, toolless: false, branch: true, proof: 'pull', alone: true },
  other: { does: 'Anything else the connected tools allow, or a result written in the reply.', email: false, toolless: true, branch: false, proof: null, alone: true },
});

export const KINDS = /** @type {(keyof typeof ACTION_KINDS)[]} */ (Object.keys(ACTION_KINDS));

/** The table's row for a brief's kind, or null for a kind it does not hold. @param {{ kind?: unknown } | null | undefined} brief @returns {ActionKind | null} */
export const kindOf = (brief) => Object.hasOwn(ACTION_KINDS, String(brief?.kind)) ? ACTION_KINDS[/** @type {keyof typeof ACTION_KINDS} */ (brief?.kind)] : null;

/** The kinds as preparation's instructions name them: "email", "build" or "other". */
export const kindsInWords = () => KINDS.map((k) => `"${k}"`).join(', ').replace(/, ([^,]*)$/, ' or $1');

const EMAIL = /** @type {keyof typeof ACTION_KINDS} */ (KINDS.find((k) => ACTION_KINDS[k].email));
/**
 * The kind code gives a brief from the tools it needs, so the model's label never lets a send skip review: a step
 * whose tools send mail is an email, with its recipient, subject and message reviewed. null when the kind cannot
 * hold such a step (a build, which runs on its own branch, does not also send mail).
 * @param {unknown} kind the kind preparation named @param {readonly string[]} tools
 * @returns {string | null}
 */
export function kindFromTools(kind, tools) {
  if (!tools.some(mailTool)) return String(kind);
  return kindOf({ kind })?.branch ? null : EMAIL;
}
