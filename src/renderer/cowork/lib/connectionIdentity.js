// Pure derivations for how a saved connection names itself in the UI —
// unit-testable without rendering CustomizeView.

// "google_calendar" → "Google Calendar". Moved here verbatim from
// CustomizeView so the card and the detail panel's field labels share one.
export function humanLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Derive fallback labels without persisting them: a backfilled value is indistinguishable from a
// user-chosen label.
// Use the unique connection slug as the final subtitle fallback to distinguish otherwise identical
// connections.
export function connectionIdentity(connection) {
  const c = connection || {};
  const slug = c.name || c.slug || 'unnamed';
  const identity = c.display_name || c.displayName || null;
  const title = c.user_label || c.label || humanLabel(c.engine || 'unknown');
  // By value, not provenance: labelling a connection with its own identity
  // string should show it once, not twice.
  const subtitle = (identity && identity !== title) ? identity : slug;
  return { title, subtitle };
}
