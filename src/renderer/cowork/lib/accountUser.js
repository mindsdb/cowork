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

// The realm spells this claim `activate_organization`; retain older spellings for other issuers.
// Keep the organization identity separate from its display label.
function activeOrgFromPayload(payload) {
  let org = payload.activate_organization ?? payload.active_organization ?? payload.organization;
  if (typeof org === 'string') {
    try { org = JSON.parse(org); } catch { return { org: null, orgId: null }; }
  }
  if (!org || typeof org !== 'object') return { org: null, orgId: null };
  const name = org.name || null;
  const isPersonal = Boolean(payload.sub) && name === personalOrgName(payload.sub);
  // Use the shared personal-organization label even when the claim supplies auth's generated
  // display name.
  // Keep this consistent with organizationLabel in shared/minds-orgs.ts.
  return {
    org: isPersonal ? PERSONAL_ORG_LABEL : (org.displayName || name),
    orgId: org.id || name || null,
  };
}

// Cache identity for the Code skills catalogue. Keyed by the organization's id,
// never its label: labels collide (every personal organization prints as
// PERSONAL_ORG_LABEL) and a collision would serve one organization's skills to
// another. The label is only a fallback for a claim that carries no id.
export function skillScopeKey(user) {
  if (!user) return 'signed-out';
  return [user.sub, user.email, user.orgId || user.org].filter(Boolean).join(':');
}

// Initials for the avatar placeholder when the account has no picture:
// first letters of the first two name words, else the email's first
// letter, else "?" — shared by the settings account card and the sidebar
// user menu so the two placeholders can't drift apart.
export function accountInitials(user) {
  if (user?.name) {
    // Iterate code points: UTF-16 indexing would split an astral character into a lone surrogate.
    return user.name.split(' ').map((w) => [...w][0]).slice(0, 2).join('').toUpperCase();
  }
  if (user?.email) return [...user.email][0].toUpperCase();
  return '?';
}
