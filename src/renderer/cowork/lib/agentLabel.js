// Display name for a harness id. Used throughout the UI to show the active
// agent's name instead of a hardcoded "Anton", and to label old messages
// stored under a harness we no longer ship.

/** Return the display name for the active harness. */
export function getAgentLabel(settings) {
  return harnessLabel(settings?.harness || 'anton');
}

/** Return the display name for a harness ID string. */
export function harnessLabel(id) {
  if (!id) return null;
  return id.charAt(0).toUpperCase() + id.slice(1);
}
