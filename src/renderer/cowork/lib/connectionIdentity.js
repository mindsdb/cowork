// Pure derivations for how a saved connection names itself in the UI —
// unit-testable without rendering CustomizeView.

// "google_calendar" → "Google Calendar". Moved here verbatim from
// CustomizeView so the card and the detail panel's field labels share one.
export function humanLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Loose enough to equate "google_drive" with "Google Drive": cowork-server
// defaults a fresh connection's user_label to the bare engine id whenever it
// has no account name to use instead (persist.py's default_user_label()),
// and that raw id should read as "the title, again" just as much as an
// exact-cased repeat does.
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

// user_label uniqueness is deliberately global — across every engine, not
// scoped to one (ensure_unique_user_label() in anton/utils/datasources.py) —
// so a label that collides with another connection's anywhere in the vault
// gets " <n>" appended to stay unique. That's common whenever default_label
// is a real provider identity rather than an opaque per-engine id: the same
// Google account connected to both Gmail and Drive gets the same email as
// both connections' default label, and two different org-based connectors
// (Linear, PostHog, Supabase) can easily share an org/workspace name. Strip
// that counter before comparing a user_label against the connection's own
// identity, so "MindsDB 2" still reads as "MindsDB, again" instead of a
// second, meaningful value.
const stripDisambiguationCounter = (value) => value.replace(/\s+\d+$/, '');

// Lead with the app; follow with the user's label and account, without
// repeating either. Keep the slug as a last resort for records with no human
// identity, so otherwise indistinguishable connections still have a name.
export function connectionIdentity(connection) {
  const c = connection || {};
  const slug = c.name || c.slug || 'unnamed';
  const identity = c.display_name || c.displayName || null;
  const title = c.label || humanLabel(c.engine || 'unknown');

  // Loose enough to equate "google_drive" with "Google Drive": cowork-server
  // defaults a fresh connection's user_label to the bare engine id whenever it
  // has no account name to use instead (persist.py's default_user_label()),
  // and that raw id should read as "the title, again" just as much as an
  // exact-cased repeat does.
  const isTitleAgain = (value) => normalize(stripDisambiguationCounter(value)) === normalize(title);
  const isIdentityAgain = (value) => (
    typeof identity === 'string' && !!identity
    && normalize(stripDisambiguationCounter(value)) === normalize(identity)
  );

  const userLabel = typeof c.user_label === 'string' && c.user_label
    && !isTitleAgain(c.user_label) && !isIdentityAgain(c.user_label)
    ? c.user_label
    : null;
  const identityValue = typeof identity === 'string' && identity && !isTitleAgain(identity)
    ? identity
    : null;

  const details = [userLabel, identityValue].filter((value, index, values) => (
    value != null && values.findIndex((other) => other != null && other.toLowerCase() === value.toLowerCase()) === index
  ));
  // `identity` comes from the provider and is effectively unique per account;
  // `user_label` is free text a user can reuse across connections. Only trust
  // the join to be collision-free when identity backs it — otherwise append
  // the slug (the one field guaranteed unique per connection) so two
  // same-engine connections sharing just a label never render identical cards.
  const subtitle = identityValue
    ? (details.join(' · ') || slug)
    : (details.length ? `${details.join(' · ')} · ${slug}` : slug);
  return { title, subtitle };
}
