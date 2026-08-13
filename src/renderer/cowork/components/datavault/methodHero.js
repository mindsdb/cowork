// Pure decision logic for the connect-form method picker's "hero"
// promotion (ENG-1534), extracted so it's unit-testable without
// rendering. Given a connector's methods + spec, decides which method
// to lead with as a prominent "Authorize with <Provider>" button, what
// copy it carries, whether it can launch in one click, and which
// methods fall under "See other options".

const OAUTH_BUILTIN_ID = 'browser_oauth_builtin';

// Exact display casing for the connector ids that ship the in-browser
// OAuth method — used as a fallback when neither `label` nor `title`
// carries the name, so we never fall all the way to a generic word for
// a known provider. Prettifying the id would give "Github"/"Gcp".
const KNOWN_PROVIDER_NAMES = {
  github: 'GitHub',
  gmail: 'Gmail',
  gcp: 'Google Cloud',
  google_drive: 'Google Drive',
  google_ads: 'Google Ads',
  google_analytics_4: 'Google Analytics 4',
  google_calendar: 'Google Calendar',
  linear: 'Linear',
};

function prettifyEngine(engine) {
  return String(engine)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Human connector name for user-facing copy ("GitHub", "Google Drive").
 *  Resolution order: `spec.label` (the connector name — populated on some
 *  paths) → the form title with a leading "Connect " stripped → the
 *  connector id (`engine` / `_connector_id`) with known display casing →
 *  a generic word. The label is empty in the browser-OAuth form spec (it
 *  lives at the connector level, not inside `form`), which is why the
 *  title/id fallbacks matter — without them the success message reads
 *  "Provider connected" instead of "GitHub connected" (ENG-1534). */
export function providerNameFromSpec(spec) {
  if (!spec) return 'the provider';
  if (spec.label) return spec.label;
  if (spec.title) {
    const stripped = String(spec.title).replace(/^connect\s+/i, '').trim();
    if (stripped) return stripped;
  }
  const engine = spec.engine || spec._connector_id;
  if (engine) return KNOWN_PROVIDER_NAMES[engine] || prettifyEngine(engine);
  return 'the provider';
}

/** Methods with recommended ones floated to the front (stable). */
export function orderMethods(methods) {
  if (!Array.isArray(methods)) return [];
  const recommended = methods.filter((m) => m && m.recommended);
  const rest = methods.filter((m) => !m || !m.recommended);
  return [...recommended, ...rest];
}

/**
 * @returns {{
 *   hero: object|null, rest: object[], heroIsOAuth: boolean,
 *   heroOneClick: boolean, providerName: string,
 *   heroLabel: string, heroHelper: string,
 * }} View model for the picker. `hero` is null when no method is
 * recommended — the caller then renders the plain card list.
 */
export function computeHeroView(methods, spec) {
  const ordered = orderMethods(methods);
  const hero = ordered.find((m) => m && m.recommended) || null;
  const rest = ordered.filter((m) => m !== hero);
  const providerName = providerNameFromSpec(spec);

  if (!hero) {
    return { hero: null, rest: ordered, heroIsOAuth: false, heroOneClick: false, providerName, heroLabel: '', heroHelper: '' };
  }

  const heroIsOAuth = hero.id === OAUTH_BUILTIN_ID;
  const fields = Array.isArray(hero.fields) ? hero.fields : [];
  // One-click only when there's nothing to fill first. A method with a
  // required field (e.g. Google Ads' developer token) reveals its fields
  // on click instead, so we never skip required input.
  const heroOneClick = heroIsOAuth && !fields.some((f) => f && f.required);
  const heroLabel = heroIsOAuth ? `Authorize with ${providerName}` : (hero.label || hero.id);
  const heroHelper = heroIsOAuth
    ? `Opens ${providerName} authorization in your browser — one click to wire.`
    : (hero.description || '');

  return { hero, rest, heroIsOAuth, heroOneClick, providerName, heroLabel, heroHelper };
}
