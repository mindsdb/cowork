// The MindsHub plan the latest usage read names ('free' | 'plus' | 'pro'), or
// null while no read carries one: the plan gate is off, cowork-server predates
// plans, or nobody is signed in. The usage poll (hooks/useHubUsage) writes it
// and analytics stamps it as the plan tier. It sits apart from both, with no
// imports, so the poll takes on none of the analytics module's import-time
// work.

let current = null;
const listeners = new Set();

/** The plan tier the latest usage read names, or null for none. */
export function usagePlanTier() {
  return current;
}

/** Record the plan tier a usage read names (null for none), and tell each
 *  listener when it moves. */
export function setUsagePlanTier(tier) {
  const next = typeof tier === 'string' && tier ? tier : null;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener(next);
}

export function subscribeUsagePlanTier(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
