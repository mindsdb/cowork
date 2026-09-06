/** Shared organization selection and presentation rules. Platform owners handle network calls. */

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

/**
 * Must match personal_org_name in auth/keycloak/helpers/orgs.py and
 * PersonalOrganizationProvisioner.java.
 */
export function personalOrgName(userId: string): string {
  return `personal_${userId}`;
}

/**
 * Short fallback for generated personal-organization names; it must fit beside the account name in
 * the sidebar.
 */
export const PERSONAL_ORG_LABEL = 'Personal';

/**
 * Substitute personal labels only at presentation time. Keep displayName faithful to Keycloak, and
 * use this helper for both token and membership-list paths so their labels agree.
 */
export function organizationLabel(org: MindsOrg | null | undefined): string | null {
  if (!org) return null;
  if (org.isPersonal && isGeneratedPersonalOrgName(org)) return PERSONAL_ORG_LABEL;
  return org.displayName || org.name || null;
}

/**
 * Preserve user-renamed personal organizations; collapse only generated names. Unlike auth, this
 * helper lacks owner identity and recognizes the historical suffix broadly: a user-chosen name
 * ending in "'s organization" will also display as Personal.
 */
function isGeneratedPersonalOrgName(org: MindsOrg): boolean {
  const current = (org.displayName || '').trim();
  if (!current) return true;
  if (current === org.name) return true;
  if (current === PERSONAL_ORG_LABEL) return true;
  return current.endsWith("'s organization");
}

/**
 * Keep Keycloak's name, falling back to the raw identifier. Reconstructing generated personal names
 * here would duplicate auth's naming rule; fallback presentation belongs to callers.
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

/** Company organizations first, preserving Keycloak order within each group. */
export function rankMindsOrgs(orgs: MindsOrg[]): MindsOrg[] {
  const company = orgs.filter((org) => !org.isPersonal);
  const personal = orgs.filter((org) => org.isPersonal);
  return [...company, ...personal];
}

/** A stored user choice wins only while its membership remains valid. */
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
/** Stored in state.json and keyed by Keycloak subject so another account cannot inherit this choice. */

const ORG_PREFERENCE_KEY = 'mindsOrganization';

interface OrgPreference {
  sub: string;
  orgId: string;
  /** Absent on entries written before ENG-2199 — see `readOrgPreference`. */
  chosenByUser?: boolean;
}

/** The organization this install last settled on, and who decided it. */
export interface StoredOrgPick {
  orgId: string;
  /**
   * Record user intent explicitly; an automatically selected organization may be revised, a user
   * preference may not.
   */
  chosenByUser: boolean;
}

function preferencesOf(state: unknown): Record<string, unknown> {
  const preferences = (state as { preferences?: unknown } | null)?.preferences;
  return preferences && typeof preferences === 'object'
    ? preferences as Record<string, unknown>
    : {};
}

/**
 * Legacy entries without chosenByUser were written only by explicit picker/switch actions, so
 * absence means true.
 */
export function readOrgPreference(state: unknown, sub: string): StoredOrgPick | null {
  const stored = preferencesOf(state)[ORG_PREFERENCE_KEY] as OrgPreference | undefined;
  if (!stored || typeof stored !== 'object') return null;
  if (stored.sub !== sub || !stored.orgId) return null;
  return { orgId: stored.orgId, chosenByUser: stored.chosenByUser !== false };
}

/** `state` with this account's pick recorded, leaving every other key alone. */
export function writeOrgPreference(
  state: unknown,
  sub: string,
  orgId: string,
  chosenByUser: boolean,
): Record<string, unknown> {
  const base = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>;
  return {
    ...base,
    preferences: {
      ...preferencesOf(state),
      [ORG_PREFERENCE_KEY]: { sub, orgId, chosenByUser },
    },
  };
}
