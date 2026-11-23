// The body of a viewer-analytics settings change (ENG-4455), shared by the
// desktop and org routes. `settings` is the analytics switch as a boolean, or
// `{ tracking, require_email }` where an omitted field is left unchanged. The
// routes name the analytics switch `enabled`.
export function trackingSettingsBody(settings) {
  if (typeof settings === 'boolean') return { enabled: settings };
  const body = {};
  if (typeof settings?.tracking === 'boolean') body.enabled = settings.tracking;
  if (typeof settings?.require_email === 'boolean') body.require_email = settings.require_email;
  return body;
}
