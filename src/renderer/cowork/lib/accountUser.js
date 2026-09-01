import { PERSONAL_ORG_LABEL, personalOrgName } from '../../../shared/minds-orgs';
import { decodeJwtPayload } from './jwtClaims';

// Pure mapping from an access token to the account card's user object; null
// means "show the sign-in card" — both for a missing token and for one that
// can't be decoded (a stale identity must never keep rendering over a token we
// can no longer read, ENG-761).
export function accountUserFromToken(token) {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return {
    name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || null,
    email: payload.email || null,
    username: payload.preferred_username || null,
    sub: payload.sub || null,
    // Standard OIDC claim; most MindsHub accounts don't carry one, in which
    // case the UI falls back to an initials circle (see accountInitials).
    picture: payload.picture || null,
    ...activeOrgFromPayload(payload),
  };
}

// The organization claim, which the realm spells `activate_organization`.
//
// This read named `active_organization` for its whole life and the realm has
// never issued that, so the org line in the account menu and the Organization
// row in Settings rendered nothing at all. Both other readers in this app get
// the name right — `src/main/minds-auth.ts` checks both spellings, and
// `lib/analytics.js` uses the correct one with a comment saying so — which is
// what makes this a typo rather than a misunderstanding. The old spellings are
// kept as fallbacks so a token minted by some other issuer still resolves.
//
// `org` is a label to print and `orgId` identifies which organization it is.
// They come apart because the claim carries no display name: a personal
// organization's claim name is the raw `personal_<userId>`, and auth's real
// label for it is `<email>'s organization`. Printing the raw name would be
// worse than the generic label below, and rebuilding auth's string here would
// put a third copy of a rule that already lives in auth and in Keycloak.
//
// So a personal organization gets a readable placeholder rather than nothing.
// The listing is an async, failable source, and it is the only thing that can
// produce auth's real label. The menu still has to name the organization on
// first paint and when that read never lands. `useMindsOrgs` upgrades this
// to the Keycloak-held name as soon as it arrives, because `UserMenu` prefers
// the listing's `displayName` over this value.
function activeOrgFromPayload(payload) {
  let org = payload.activate_organization ?? payload.active_organization ?? payload.organization;
  if (typeof org === 'string') {
    try { org = JSON.parse(org); } catch { return { org: null, orgId: null }; }
  }
  if (!org || typeof org !== 'object') return { org: null, orgId: null };
  const name = org.name || null;
  const isPersonal = Boolean(payload.sub) && name === personalOrgName(payload.sub);
  return {
    org: org.displayName || (isPersonal ? PERSONAL_ORG_LABEL : name),
    orgId: org.id || name || null,
  };
}

// Initials for the avatar placeholder when the account has no picture:
// first letters of the first two name words, else the email's first
// letter, else "?" — shared by the settings account card and the sidebar
// user menu so the two placeholders can't drift apart.
export function accountInitials(user) {
  if (user?.name) {
    // `[...w][0]`, not `w[0]`: string indexing returns a UTF-16 code *unit*,
    // so a name beginning with an astral character ('🛰 Byron') put a lone
    // high surrogate in the avatar circle, which renders as tofu. Spreading
    // iterates by code point. BMP accents were already fine — this is the
    // same class as ENG-2138 one layer down, in string indexing rather than
    // in the decode.
    return user.name.split(' ').map((w) => [...w][0]).slice(0, 2).join('').toUpperCase();
  }
  if (user?.email) return [...user.email][0].toUpperCase();
  return '?';
}
