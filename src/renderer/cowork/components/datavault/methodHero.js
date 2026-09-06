const OAUTH_BUILTIN_ID = 'browser_oauth_builtin';

// Preserve provider brand casing when specs omit labels/titles; prettifying IDs would produce
// Github/Gcp.
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

/**
 * Resolve provider names from label, title, then known ID casing. OAuth form specs can omit the
 * connector-level label.
 */
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
  // Require input before authorization when the method has required fields.
  const heroOneClick = heroIsOAuth && !fields.some((f) => f && f.required);
  const heroLabel = heroIsOAuth ? `Authorize with ${providerName}` : (hero.label || hero.id);
  const heroHelper = heroIsOAuth
    ? `Opens ${providerName} authorization in your browser — one click to wire.`
    : (hero.description || '');

  return { hero, rest, heroIsOAuth, heroOneClick, providerName, heroLabel, heroHelper };
}
