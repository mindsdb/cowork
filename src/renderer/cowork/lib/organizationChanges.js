// Desktop switches organization in place after the credential handoff succeeds.
// Notify mounted organization-scoped readers without waiting for a new subject
// or a reload. The subject keeps a late switch out of another account's state.
const listeners = new Set();

export function subscribeOrganizationChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyOrganizationChanged(subject) {
  for (const listener of listeners) listener(subject);
}
