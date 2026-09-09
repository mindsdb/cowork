// Pure derivations for how a saved connection names itself in the UI —
// unit-testable without rendering CustomizeView.

// "google_calendar" → "Google Calendar". Moved here verbatim from
// CustomizeView so the card and the detail panel's field labels share one.
export function humanLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Lead with the app; follow with the user's label and account, without
// repeating either. Keep the slug as a last resort for records with no human
// identity, so otherwise indistinguishable connections still have a name.
export function connectionIdentity(connection) {
  const c = connection || {};
  const slug = c.name || c.slug || 'unnamed';
  const identity = c.display_name || c.displayName || null;
  const title = c.label || humanLabel(c.engine || 'unknown');
  const details = [c.user_label, identity].filter((value, index, values) => (
    typeof value === 'string' && value && value.toLowerCase() !== title.toLowerCase()
    && values.findIndex((other) => typeof other === 'string' && other.toLowerCase() === value.toLowerCase()) === index
  ));
  // `identity` comes from the provider and is effectively unique per account;
  // `user_label` is free text a user can reuse across connections. Only trust
  // the join to be collision-free when identity backs it — otherwise append
  // the slug (the one field guaranteed unique per connection) so two
  // same-engine connections sharing just a label never render identical cards.
  const subtitle = identity
    ? (details.join(' · ') || slug)
    : (details.length ? `${details.join(' · ')} · ${slug}` : slug);
  return { title, subtitle };
}
