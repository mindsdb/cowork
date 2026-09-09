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
    value && value.toLowerCase() !== title.toLowerCase()
    && values.findIndex((other) => other?.toLowerCase() === value.toLowerCase()) === index
  ));
  const subtitle = details.join(' · ') || slug;
  return { title, subtitle };
}
