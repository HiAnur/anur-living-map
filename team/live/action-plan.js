const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
const strings = (value, max, size) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const result = value.map((item) => text(item, size));
  return result.every(Boolean) ? [...new Set(result)] : null;
};

// A planner supplies task data, never runtime state, ownership or permission to execute.
export function readPlannedTask(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const goal = text(value.goal, 1000), result = text(value.result, 2000);
  const inputs = strings(value.inputs, 20, 1000), steps = strings(value.steps, 20, 1000);
  const evidence = strings(value.evidence, 12, 1000), dependsOn = strings(value.dependsOn, 20, 40);
  if (!goal || !result || !inputs || !steps?.length || !evidence?.length || !dependsOn || dependsOn.some((id) => !/^[a-z0-9-]{1,40}$/.test(/** @type {string} */ (id)))) return null;
  const destination = value.destination === undefined || value.destination === '' ? '' : text(value.destination, 1000);
  const readiness = value.readiness ?? 'needs_information';
  if (destination === null || !['ready','needs_information','waiting'].includes(readiness)) return null;
  if (value.blockers !== undefined && (!Array.isArray(value.blockers) || value.blockers.length > 20)) return null;
  const blockers = (value.blockers || []).map((b) => ({ detail:text(b?.detail, 1000), resolver:text(b?.resolver, 300) }));
  if (blockers.some((b) => !b.detail || !b.resolver)) return null;
  return {goal,result,destination,inputs,steps,evidence,dependsOn,readiness,blockers};
}

export const taskSource = (n) => JSON.stringify([n.label,n.sub || '',n.desc || '',...(n.action?.plan ? [n.action.plan] : [])]);

export function dependencyBlockers(plan, nodeOf, canUse) {
  return (plan?.dependsOn || []).flatMap((id) => {
    const n = nodeOf(id);
    if (!n || !canUse(n)) return [{id, detail:'A prerequisite is missing or no longer accessible.'}];
    const completion = n.action?.completion;
    return n.action?.stage === 'finished' && n.action.source === taskSource(n) && completion?.status === 'completed' && completion.evidence?.some((e) => typeof e === 'string' && e.trim())
      ? [] : [{id, detail:`Waiting for ${n.label} to finish with confirmation.`}];
  });
}
