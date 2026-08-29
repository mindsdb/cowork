import { prepareForOrganizationReload } from './organizationTransition';

export const EXPECTED_ORGANIZATION_HEADER = 'X-Cowork-Expected-Organization-Id';
export const ORGANIZATION_RELOAD_HEADER = 'X-Cowork-Organization-Reload';

let expectedOrganizationId = null;

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function recordOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function decodeBase64UrlJson(value) {
  try {
    if (typeof value !== 'string' || !value || value.length % 4 === 1) return null;
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return recordOf(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

function organizationIdFromClaim(value) {
  let claim = value;
  if (typeof claim === 'string') {
    const raw = nonEmptyString(claim);
    if (!raw) return null;
    try {
      claim = JSON.parse(raw);
    } catch {
      return raw;
    }
    if (typeof claim === 'string') return nonEmptyString(claim);
  }
  const organization = recordOf(claim);
  return organization
    ? nonEmptyString(organization.id) ?? nonEmptyString(organization.name)
    : null;
}

function organizationIdFromAccessToken(accessToken) {
  if (typeof accessToken !== 'string') return null;
  const segments = accessToken.split('.');
  if (segments.length < 2) return null;
  const payload = decodeBase64UrlJson(segments[1]);
  return payload ? organizationIdFromClaim(payload.activate_organization) : null;
}

/**
 * Pin the first readable token organization for this JavaScript document and
 * return the request header that lets the server reject a later session drift.
 */
export function expectedOrganizationHeaders(accessToken) {
  const tokenOrganizationId = organizationIdFromAccessToken(accessToken);
  if (expectedOrganizationId === null) {
    if (tokenOrganizationId === null) return {};
    expectedOrganizationId = tokenOrganizationId;
  } else if (
    tokenOrganizationId !== null
    && tokenOrganizationId !== expectedOrganizationId
  ) {
    prepareForOrganizationReload();
    throw new Error('The active organization changed; reload required');
  }

  return { [EXPECTED_ORGANIZATION_HEADER]: expectedOrganizationId };
}

/**
 * Apply the server's mandatory-reload response before any caller can consume a
 * body scoped to an organization other than the one this document pinned.
 */
export function handleOrganizationBoundaryResponse(response) {
  let instruction = null;
  try {
    instruction = response?.headers?.get?.(ORGANIZATION_RELOAD_HEADER);
  } catch {
    return false;
  }
  if (typeof instruction !== 'string' || instruction.trim().toLowerCase() !== 'required') {
    return false;
  }
  prepareForOrganizationReload();
  return true;
}

/** Reset the document-local organization pin between tests. */
export function __resetOrganizationRequestBoundaryForTests() {
  expectedOrganizationId = null;
}
