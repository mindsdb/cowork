// Maps harness IDs to user-facing agent names.
// Used throughout the UI to show the active agent's name instead of
// hardcoded "Anton". Import `getAgentLabel(settings)` wherever you
// need the display name for the currently selected harness.

const HARNESS_LABELS = {
  anton: 'Anton',
  hermes: 'Hermes',
};

/** Return the display name for the active harness. */
export function getAgentLabel(settings) {
  const harness = settings?.harness || 'anton';
  return harnessLabel(harness);
}

/** Return the display name for a harness ID string. */
export function harnessLabel(id) {
  if (!id) return null;
  return HARNESS_LABELS[id] || id.charAt(0).toUpperCase() + id.slice(1);
}
