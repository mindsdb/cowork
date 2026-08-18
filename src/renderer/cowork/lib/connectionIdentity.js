// Pure derivations for how a saved connection names itself in the UI. No
// hooks, no JSX — a function of the connection summary the server returns,
// which keeps it directly unit-testable without rendering CustomizeView.

// Titlecase a snake_case identifier for display ("google_calendar" →
// "Google Calendar"). Moved here verbatim from CustomizeView so the card
// title and the detail panel's field labels share one definition.
export function humanLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// The two lines a connection card shows, neither of which is ever empty.
//
// ENG-1705: the title was `user_label || '—'`, so every connection saved
// before the label field shipped (v2.26.8.17.1, 2026-08-17) rendered a
// literal dash — nothing backfills `_user_label`, so that is the whole
// pre-release installed base.
//
//   title    — what the connection IS: the user's own label, else the
//              connector registry's display label (`label`, already on
//              ConnectionSummaryResponse as `spec.label` — "GitHub",
//              "PostHog", "Google Calendar"), else the humanized engine id
//              for an engine with no registry spec.
//   subtitle — WHICH account: the derived identity (email / host[/database],
//              from `connection_display_name` server-side), else the slug.
//
// This keeps the split the label field was designed around — the title names
// the service, the subtitle names the account — and only replaces the dash
// with the connector name. Deriving at read time rather than backfilling
// `_user_label` is deliberate: a written label is indistinguishable from one
// the user chose, and would freeze today's guess into their vault forever.
//
// The slug is the terminal case on purpose. It is the only field unique per
// connection, so two connections on the same engine with no label and no
// derivable identity stay distinguishable — e.g. the records ENG-1706 saved
// under a single `fm_<uuid>` engine.
export function connectionIdentity(connection) {
  const c = connection || {};
  const slug = c.name || c.slug || 'unnamed';
  const identity = c.display_name || c.displayName || null;
  const title = c.user_label || c.label || humanLabel(c.engine || 'unknown');
  // Compared by value, not provenance: a user who labels a connection with
  // the same string the identity derives to sees it once, not twice.
  const subtitle = (identity && identity !== title) ? identity : slug;
  return { title, subtitle };
}
