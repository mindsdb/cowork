import Keycloak from 'keycloak-js';
import {
  type MindsOrg,
  PERSONAL_ORG_LABEL,
  personalOrgName,
  rankMindsOrgs,
  toMindsOrg,
} from '../../shared/minds-orgs';
import {
  __resetOrganizationTransitionForTests as resetOrganizationTransitionForTests,
  assertOrganizationTransitionClear,
  beginOrganizationTransition,
  prepareForOrganizationReload,
  releaseOrganizationTransition,
  reloadForOrganizationTransition,
} from '../cowork/lib/organizationTransition';
import {
  __resetOrganizationRequestBoundaryForTests as resetOrganizationRequestBoundaryForTests,
  expectedOrganizationHeaders,
  handleOrganizationBoundaryResponse,
} from '../cowork/lib/organizationRequestBoundary';
import { MINDS_KEYCLOAK_URL } from './mindsUrls';

// Single source of truth for the Keycloak host lives in mindsUrls.ts so the
// login flow and the sign-up link (MINDS_REGISTER_URL) always agree on the
// environment (prod / staging / dev).
const keycloakUrl = MINDS_KEYCLOAK_URL;

// Base URL without query params for Keycloak redirect (Keycloak validates strictly)
const redirectUri = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}${window.location.pathname}`
  : undefined;

// Web uses the `public-client` (browser redirect + web origins), same as the
// MindsHub console. `anton-desktop` is the loopback-only PKCE client for the
// native desktop app (redirectUris http://127.0.0.1:*) and can't serve a
// browser origin, so it must not be used here.
const keycloak = new Keycloak({
  url: keycloakUrl,
  realm: 'mindsdb',
  clientId: 'public-client',
});

keycloak.onAuthError = () => {
  keycloak.clearToken();
  keycloak.login({ redirectUri });
};

export { keycloak };

export const getAccessToken = async (): Promise<string | null> => {
  /**
   * Once a switch request starts, the server-side session may name the new
   * tenant before this document can confirm and reload. Refuse every ordinary
   * API token request so the old UI cannot start work in that indeterminate
   * window. A definite refusal releases the guard below.
   */
  assertOrganizationTransitionClear();
  if (!keycloak.authenticated) return null;
  if (keycloak.token) expectedOrganizationHeaders(keycloak.token);
  try {
    await keycloak.updateToken(30);
  } catch {
    /**
     * A refresh failure may still leave the existing token usable, but only if
     * no other tab began changing the shared Keycloak tenant while we waited.
     */
    assertOrganizationTransitionClear();
    const token = keycloak.token ?? null;
    if (token) expectedOrganizationHeaders(token);
    return token;
  }
  /**
   * A refresh that began under the old UI can finish after another tab commits
   * a switch and hand back a new-organization token. Fence that exact race.
   */
  assertOrganizationTransitionClear();
  const token = keycloak.token ?? null;
  if (token) expectedOrganizationHeaders(token);
  return token;
};

export type WebOrganizationListResult =
  | { ok: true; orgs: MindsOrg[]; activeOrgId: string | null }
  | { ok: false; reason: string };

export type WebOrganizationSwitchResult =
  | { ok: true; activeOrgId: string; reloadRequired: true; clearTenantState: true }
  | { ok: false; reason: string; reloadRequired: false; clearTenantState: false }
  | { ok: false; reason: string; reloadRequired: true; clearTenantState: boolean };

const REALM_URL = `${MINDS_KEYCLOAK_URL.replace(/\/$/, '')}/realms/mindsdb`;
const ORGANIZATIONS_UNAVAILABLE = 'We could not load organizations. Please try again.';
const SWITCH_REFUSED = 'We could not change organization. Nothing changed.';
const SWITCH_COORDINATION_UNAVAILABLE = 'We could not safely change organization in this browser. Nothing changed.';
const SWITCH_CAPABILITY_UNAVAILABLE = 'Changing organization is not available. Nothing changed.';
const SWITCH_PREPARE_UNAVAILABLE = 'We could not prepare the organization change. Reload to continue.';
const SWITCH_UNCONFIRMED = 'We could not confirm the organization change. Reload to continue.';
const ORGANIZATION_REQUEST_TIMEOUT_MS = 10_000;
const DEFINITE_SWITCH_REFUSALS = new Set([400, 401, 403, 404]);
const ORGANIZATION_SWITCH_CAPABILITY_URL = '/api/v1/capabilities/organization-switch';

async function withinOrganizationDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = globalThis.setTimeout(
          () => reject(new Error('Organization request timed out')),
          ORGANIZATION_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

async function fetchOrganizationRoute(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const abortController = new AbortController();
  const timeout = globalThis.setTimeout(
    () => abortController.abort(),
    ORGANIZATION_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: abortController.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchOrganizationJson(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<{ response: Response; payload: unknown }> {
  const abortController = new AbortController();
  const timeout = globalThis.setTimeout(
    () => abortController.abort(),
    ORGANIZATION_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(input, { ...init, signal: abortController.signal });
    const payload = response.ok ? await response.json() : null;
    return { response, payload };
  } finally {
    /**
     * This timer stays armed through body consumption. Aborting the controller
     * cancels a response that sent headers but never finishes its JSON body.
     */
    globalThis.clearTimeout(timeout);
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type OrganizationSwitchCapability = {
  enabled: boolean;
  reloadRequired: boolean;
};

async function organizationSwitchCapability(
  token: string,
): Promise<OrganizationSwitchCapability> {
  try {
    const { response, payload } = await fetchOrganizationJson(
      ORGANIZATION_SWITCH_CAPABILITY_URL,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...expectedOrganizationHeaders(token),
        },
      },
    );
    if (handleOrganizationBoundaryResponse(response)) {
      return { enabled: false, reloadRequired: true };
    }
    const capability = recordOf(payload);
    return {
      enabled: response.ok
        && capability?.protocolVersion === 1
        && capability.expectedOrganizationEnforced === true
        && capability.enabled === true,
      reloadRequired: false,
    };
  } catch {
    return { enabled: false, reloadRequired: false };
  }
}

function activeOrganizationId(): string | null {
  let claim: unknown = keycloak.tokenParsed?.activate_organization;
  if (typeof claim === 'string') {
    try {
      claim = JSON.parse(claim) as unknown;
    } catch {
      return null;
    }
  }
  const organization = recordOf(claim);
  return organization
    ? nonEmptyString(organization.id) ?? nonEmptyString(organization.name)
    : null;
}

function organizationRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const body = recordOf(payload);
  return body && Array.isArray(body.results) ? body.results : null;
}

function normalizeOrganizations(payload: unknown, subject: string): MindsOrg[] | null {
  const rows = organizationRows(payload);
  if (!rows) return null;

  const organizations: MindsOrg[] = [];
  for (const row of rows) {
    const entry = recordOf(row);
    const source = entry && Object.hasOwn(entry, 'organization')
      ? recordOf(entry.organization)
      : entry;
    if (!source) return null;

    const id = nonEmptyString(source.id);
    if (!id) return null;
    const sourceName = nonEmptyString(source.name);
    const sourceSlug = nonEmptyString(source.slug);
    const rawName = sourceSlug ?? sourceName ?? id;
    const suppliedDisplayName =
      nonEmptyString(source.displayName) ?? nonEmptyString(source.display_name);
    /**
     * Fail readable when an older or partial membership shape omits the label.
     * Never expose the personal_<subject> implementation name in the menu.
     */
    const displayName = suppliedDisplayName
      ?? (rawName === personalOrgName(subject)
        ? (sourceSlug && sourceName !== sourceSlug ? sourceName : null) ?? PERSONAL_ORG_LABEL
        : sourceName ?? rawName);
    organizations.push(toMindsOrg({ id, name: displayName, slug: rawName }, subject));
  }
  return rankMindsOrgs(organizations);
}

/** List the organizations belonging to the authenticated browser session. */
export async function listWebOrganizations(): Promise<WebOrganizationListResult> {
  try {
    assertOrganizationTransitionClear();
  } catch {
    return { ok: false, reason: ORGANIZATIONS_UNAVAILABLE };
  }
  if (!keycloak.authenticated) {
    return { ok: false, reason: 'Sign in to view organizations.' };
  }
  const subject = nonEmptyString(keycloak.subject) ?? nonEmptyString(keycloak.tokenParsed?.sub);
  if (!subject) {
    return { ok: false, reason: 'Could not read the signed-in account.' };
  }
  /**
   * The account model that mounts this hook already came from a refreshed
   * token. Avoid initiating a second, uncancellable keycloak-js refresh just
   * to populate an optional menu group; an expired bearer fails closed and the
   * bounded retry can ask again after another app request refreshes it.
   */
  const token = keycloak.token ?? null;
  if (!token) {
    return { ok: false, reason: 'Sign in to view organizations.' };
  }

  try {
    const capability = await organizationSwitchCapability(token);
    if (!capability.enabled) return { ok: false, reason: ORGANIZATIONS_UNAVAILABLE };
    const { response, payload } = await fetchOrganizationJson(
      `${REALM_URL}/users/${encodeURIComponent(subject)}/orgs?search=&first=0&max=100`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!response.ok) return { ok: false, reason: ORGANIZATIONS_UNAVAILABLE };
    const organizations = normalizeOrganizations(payload, subject);
    if (!organizations) return { ok: false, reason: ORGANIZATIONS_UNAVAILABLE };
    return { ok: true, orgs: organizations, activeOrgId: activeOrganizationId() };
  } catch {
    return { ok: false, reason: ORGANIZATIONS_UNAVAILABLE };
  }
}

/** Change the organization carried by future browser access tokens. */
export async function switchWebOrganization(
  organizationId: string,
): Promise<WebOrganizationSwitchResult> {
  const targetId = nonEmptyString(organizationId);
  if (!targetId) {
    return {
      ok: false,
      reason: 'Choose an organization to continue.',
      reloadRequired: false,
      clearTenantState: false,
    };
  }
  let token: string | null;
  try {
    token = await withinOrganizationDeadline(getAccessToken());
  } catch {
    /**
     * keycloak-js cannot abort its refresh fetch. Reload so a timed-out
     * preflight cannot leave every later token request queued behind it.
     */
    prepareForOrganizationReload({ clearTenantState: false });
    return {
      ok: false,
      reason: SWITCH_PREPARE_UNAVAILABLE,
      reloadRequired: true,
      clearTenantState: false,
    };
  }
  if (!token) {
    return {
      ok: false,
      reason: 'Sign in to change organization.',
      reloadRequired: false,
      clearTenantState: false,
    };
  }

  const capability = await organizationSwitchCapability(token);
  if (!capability.enabled) {
    if (capability.reloadRequired) {
      return {
        ok: false,
        reason: SWITCH_UNCONFIRMED,
        reloadRequired: true,
        clearTenantState: true,
      };
    }
    return {
      ok: false,
      reason: SWITCH_CAPABILITY_UNAVAILABLE,
      reloadRequired: false,
      clearTenantState: false,
    };
  }

  let response: Response;
  let transitionId: string;
  try {
    transitionId = await beginOrganizationTransition(
      nonEmptyString(keycloak.subject) ?? nonEmptyString(keycloak.tokenParsed?.sub),
    );
  } catch {
    return {
      ok: false,
      reason: SWITCH_COORDINATION_UNAVAILABLE,
      reloadRequired: false,
      clearTenantState: false,
    };
  }
  try {
    response = await fetchOrganizationRoute(`${REALM_URL}/users/switch-organization`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: targetId }),
    });
  } catch {
    reloadForOrganizationTransition(transitionId);
    return {
      ok: false,
      reason: SWITCH_UNCONFIRMED,
      reloadRequired: true,
      clearTenantState: true,
    };
  }

  if (!response.ok) {
    const definitelyRefused = DEFINITE_SWITCH_REFUSALS.has(response.status);
    if (definitelyRefused) {
      releaseOrganizationTransition(transitionId);
      return {
        ok: false,
        reason: SWITCH_REFUSED,
        reloadRequired: false,
        clearTenantState: false,
      };
    }
    reloadForOrganizationTransition(transitionId);
    return {
      ok: false,
      reason: SWITCH_UNCONFIRMED,
      reloadRequired: true,
      clearTenantState: true,
    };
  }

  try {
    await withinOrganizationDeadline(keycloak.updateToken(-1));
  } catch {
    reloadForOrganizationTransition(transitionId);
    return {
      ok: false,
      reason: SWITCH_UNCONFIRMED,
      reloadRequired: true,
      clearTenantState: true,
    };
  }
  if (activeOrganizationId() !== targetId) {
    reloadForOrganizationTransition(transitionId);
    return {
      ok: false,
      reason: SWITCH_UNCONFIRMED,
      reloadRequired: true,
      clearTenantState: true,
    };
  }
  reloadForOrganizationTransition(transitionId);
  return {
    ok: true,
    activeOrgId: targetId,
    reloadRequired: true,
    clearTenantState: true,
  };
}

/** Restore the module-lifetime transition guard between tests. */
export function __resetOrganizationTransitionForTests(): void {
  resetOrganizationTransitionForTests();
  resetOrganizationRequestBoundaryForTests();
}

// Ends the browser session. keycloak.logout() clears the in-memory token and
// redirects to Keycloak's end-session endpoint; on return, onLoad:'login-required'
// (web-main.tsx) forces a fresh login. Guarded on `authenticated` so it's a safe
// no-op on legacy tenant hosts that render without the Keycloak wrapper.
export const logout = async (): Promise<void> => {
  if (!keycloak.authenticated) return;
  await keycloak.logout({ redirectUri });
};
