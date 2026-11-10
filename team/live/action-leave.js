// How a box holding an Action may leave the map. Before it runs, its author or an Admin may delete it, and the
// Actions waiting on it stop waiting for it. Once it has run, what it did stays on record: it is only archived, off
// the map and kept whole, and an Action waiting on it still sees how it ended. While Claude prepares or runs it,
// neither: it is cancelled or stopped first. actionLeaving in action-stages.js is the rule, for the page too.
import { managesAccess } from './access.js';
import { actionLeaving } from './action-stages.js';
import { note } from './action-box.js';

/**
 * What this person may do to take the box off the map: 'remove', 'archive', or the reason they may not.
 * @param {MapState} state @param {Box} n @param {string | undefined} by
 */
export const leaving = (state, n, by) => actionLeaving(n.action, by, !!managesAccess(state, by));

/**
 * Deleted boxes are no longer prerequisites: each Action that waited on one stops waiting for it, and its history
 * says so. Returns how many Actions changed.
 * @param {Box[]} nodes every box on the map @param {Set<string>} gone @param {string} by
 */
export function forgetPrerequisites(nodes, gone, by) {
  let changed = 0;
  for (const n of nodes) {
    const a = n.action, plan = /** @type {{ dependsOn?: string[] } | undefined} */ (a?.plan);
    const dropped = (plan?.dependsOn || []).filter((id) => gone.has(id));
    if (!a || !plan || !dropped.length || gone.has(n.id)) continue;
    plan.dependsOn = (plan.dependsOn || []).filter((id) => !gone.has(id));
    note(a, 'unblocked', by, { boxes: dropped });
    changed++;
  }
  return changed;
}
