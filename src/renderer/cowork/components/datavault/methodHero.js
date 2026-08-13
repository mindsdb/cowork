// Pure decision logic for the connect-form method picker's "hero"
// promotion (ENG-1534), extracted so it's unit-testable without
// rendering. Given a connector's methods + spec, decides which method
// to lead with as a prominent "Authorize with <Provider>" button, what
// copy it carries, whether it can launch in one click, and which
// methods fall under "See other options".

const OAUTH_BUILTIN_ID = 'browser_oauth_builtin';

/** Human connector name for button copy ("GitHub", "Google Drive").
 *  `spec.label` is the connector name (the OAuth handler reads the same
 *  field); fall back to stripping a leading "Connect " off the form
 *  title, then a generic word. */
export function providerNameFromSpec(spec) {
  if (spec && spec.label) return spec.label;
  if (spec && spec.title) return String(spec.title).replace(/^connect\s+/i, '').trim() || 'the provider';
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
    ? `Opens ${providerName} sign-in in your browser — no setup needed.`
    : (hero.description || '');

  return { hero, rest, heroIsOAuth, heroOneClick, providerName, heroLabel, heroHelper };
}
