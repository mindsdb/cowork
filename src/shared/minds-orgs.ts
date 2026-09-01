/**
 * Canonical organization shapes and selection decisions shared by the desktop
 * login flow and the web account menu. Network calls stay in their platform
 * owners; this file keeps ranking, personal-organization detection, and stored
 * desktop preference behavior testable without standing up Keycloak.
 */

/** One organization a person belongs to, as the desktop shows it. */
export interface MindsOrg {
  /** Keycloak organization id — what `users/switch-organization` takes. */
  id: string;
  /** Raw Keycloak name. A personal organization's is `personal_<userId>`. */
  name: string;
  /** What a person reads. Keycloak's display name where the organization has
   *  one, which for a personal organization is `<email>'s organization`. */
  displayName: string;
  /** Their own organization, rather than a company they belong to. */
  isPersonal: boolean;
}

/** The organizations a person belongs to, and which one their token names. */
export interface MindsOrgList {
  orgs: MindsOrg[];
  activeOrgId: string | null;
}

/** Shape `minds-auth` collects from the token claim and Keycloak's org reads. */
export interface OrgSource {
  id: string;
  name?: string;
  slug?: string;
}

/** Keycloak's name for a user's own organization. Auth builds the same string
 *  in `auth/keycloak/helpers/orgs.py` (`personal_org_name`), and the Keycloak
 *  side of it lives in `PersonalOrganizationProvisioner.java`. */
export function personalOrgName(userId: string): string {
  return `personal_${userId}`;
}

/**
 * What to call a personal organization when Keycloak's own label is not to
 * hand. Auth generates `<email>'s organization` and only the membership listing
 * carries it, so both readers that run before or without that listing fall back
 * here rather than to `personal_<uuid>` or to nothing.
 *
 * One word on purpose. This sits beside the account name in a sidebar footer
 * that truncates, and "Personal organization" is long enough there to ellipsize
 * both halves into `System A… · Personal organi…`.
 */
export const PERSONAL_ORG_LABEL = 'Personal';

/**
 * What to print for an organization.
 *
 * `displayName` stays truthful — it is the name Keycloak holds — and this is
 * the presentation layer over it. The two come apart for a personal
 * organization: Keycloak's label is auth's generated `<email>'s organization`,
 * which is both long and redundant beside the account name it sits next to, so
 * `PERSONAL_ORG_LABEL` is what a reader sees instead.
 *
 * Why this exists at all. Every reader used to write `org.displayName` inline,
 * which meant the label a personal organization got depended on whether the
 * membership listing had resolved yet: the token-claim path already substituted
 * `PERSONAL_ORG_LABEL`, the listing path did not, and the listing won. So the
 * row painted `Personal` and then replaced it with the long name a beat later
 * (ENG-2109). One function is what stops the two paths disagreeing.
 *
 * Deliberately NOT folded into `toMindsOrg`. `displayName` means "the name
 * Keycloak gave this organization", other readers depend on that, and the two
 * hosts already answer "what if there is no display name" differently. Keeping
 * the substitution here leaves the data honest and the choice in one place.
 */
export function organizationLabel(org: MindsOrg | null | undefined): string | null {
  if (!org) return null;
  if (org.isPersonal && isGeneratedPersonalOrgName(org)) return PERSONAL_ORG_LABEL;
  return org.displayName || org.name || null;
}

/**
 * Whether a personal organization is still wearing the name the system gave it.
 *
 * Renaming an organization is a real, audited feature - `rename()` in auth's
 * `accounts/services/organization_admin.py`, which has no personal-org guard -
 * and auth deliberately preserves a name the user chose: `personal_org_sync`
 * skips any display name that `is_default_personal_org_display_name`
 * (`auth/keycloak/helpers/orgs.py`) does not recognise as system-generated.
 * Substituting `PERSONAL_ORG_LABEL` unconditionally would throw that choice
 * away at the last hop, so this mirrors the same test.
 *
 * The generated forms are blank, the raw `personal_<uuid>` slug, auth's own
 * `DEFAULT_PERSONAL_ORG_DISPLAY_NAME` (also the string "Personal"), and every
 * version of the `<owner>'s organization` rule - the owner has been the full
 * email, the email local part and the first name across builds, so the suffix
 * is what identifies the shape.
 *
 * Known imprecision, accepted: auth compares against the exact strings it would
 * generate for *this* user, which needs their email and first name. This has
 * only the organization, so a user who renames theirs to something ending in
 * "'s organization" is read as generated and shown "Personal". Threading
 * identity through four presentation call sites costs more than that case does.
 */
function isGeneratedPersonalOrgName(org: MindsOrg): boolean {
  const current = (org.displayName || '').trim();
  if (!current) return true;
  if (current === org.name) return true;
  if (current === PERSONAL_ORG_LABEL) return true;
  return current.endsWith("'s organization");
}

/**
 * Turn what Keycloak returned into the shape the UI reads.
 *
 * `displayName` deliberately falls back to the raw name rather than to a
 * label of our own. A personal organization's display name is generated by
 * auth as `<email>'s organization`, and reconstructing that string here would
 * put a third copy of a rule that already lives in two places and drifts on
 * its own schedule.
 *
 * What a caller does when Keycloak has no display name to give is the caller's
 * decision, and the two hosts answer it differently. Desktop shows nothing.
 * Web substitutes a readable generic label, because the account menu is the
 * only place a person can see which organization they are in and a blank row
 * there is worse than a non-specific one.
 */
export function toMindsOrg(source: OrgSource, userId: string): MindsOrg {
  const name = source.slug ?? source.name ?? source.id;
  return {
    id: source.id,
    name,
    displayName: source.name ?? name,
    isPersonal: name === personalOrgName(userId),
  };
}

/**
 * Company organizations first, personal ones after, original order kept inside
 * each group.
 *
 * The order within a group is the order Keycloak listed them, which is what
 * makes "the first company organization" a stable answer across sign-ins rather
 * than one that moves when a membership is added.
 */
export function rankMindsOrgs(orgs: MindsOrg[]): MindsOrg[] {
  const company = orgs.filter((org) => !org.isPersonal);
  const personal = orgs.filter((org) => org.isPersonal);
  return [...company, ...personal];
}

/**
 * The organization to make active for this desktop session.
 *
 * A pick the person made themselves always wins, and it wins for as long as
 * they are still a member — that is the whole reason it is stored. Without
 * that check a revoked membership would pin the app to an organization it can
 * no longer reach and the ranking could never recover it.
 */
export function chooseMindsOrg(
  orgs: MindsOrg[],
  preferredOrgId: string | null,
): MindsOrg | null {
  const preferred = preferredOrgId
    ? orgs.find((org) => org.id === preferredOrgId)
    : undefined;
  if (preferred) return preferred;
  return rankMindsOrgs(orgs)[0] ?? null;
}

/** Whether a picker is worth showing during onboarding. One company
 *  organization is not a choice, it is a label. */
export function needsOrgPick(orgs: MindsOrg[]): boolean {
  return orgs.filter((org) => !org.isPersonal).length > 1;
}

// ── The stored pick ───────────────────────────────────────────────
//
/**
 * Kept in the Cowork home's `state.json` beside the provider preferences, and
 * keyed by the Keycloak subject: one machine can be signed into a different
 * account tomorrow, and inheriting the last person's organization would move
 * their session with nothing on screen saying so.
 */

const ORG_PREFERENCE_KEY = 'mindsOrganization';

interface OrgPreference {
  sub: string;
  orgId: string;
}

function preferencesOf(state: unknown): Record<string, unknown> {
  const preferences = (state as { preferences?: unknown } | null)?.preferences;
  return preferences && typeof preferences === 'object'
    ? preferences as Record<string, unknown>
    : {};
}

/** The organization this account last picked by hand, or null. */
export function readOrgPreference(state: unknown, sub: string): string | null {
  const stored = preferencesOf(state)[ORG_PREFERENCE_KEY] as OrgPreference | undefined;
  if (!stored || typeof stored !== 'object') return null;
  if (stored.sub !== sub || !stored.orgId) return null;
  return stored.orgId;
}

/** `state` with this account's pick recorded, leaving every other key alone. */
export function writeOrgPreference(state: unknown, sub: string, orgId: string): Record<string, unknown> {
  const base = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>;
  return {
    ...base,
    preferences: {
      ...preferencesOf(state),
      [ORG_PREFERENCE_KEY]: { sub, orgId },
    },
  };
}
