// Pure derivations for how a saved connection names itself in the UI —
// unit-testable without rendering CustomizeView.

// "google_calendar" → "Google Calendar". Moved here verbatim from
// CustomizeView so the card and the detail panel's field labels share one.
export function humanLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// The card's two lines, neither ever empty. ENG-1705: the title was
// `user_label || '—'` and nothing backfills `_user_label`, so every connection
// predating the label field rendered a dash. `label` is the connector
// registry's display label, already on ConnectionSummaryResponse.
//
// Deriving here rather than backfilling is deliberate — a written label is
// indistinguishable from one the user chose. The slug is terminal because it is
// the only per-connection unique field: two spec-less connections on one engine
// would otherwise render identical cards.
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
