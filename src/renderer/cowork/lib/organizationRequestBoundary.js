import { prepareForOrganizationReload } from './organizationTransition';
import { decodeBase64UrlJson, recordOf } from './jwtClaims';

export const EXPECTED_ORGANIZATION_HEADER = 'X-Cowork-Expected-Organization-Id';
export const ORGANIZATION_RELOAD_HEADER = 'X-Cowork-Organization-Reload';

let expectedOrganizationId = null;

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The server parses this header as a UUID and answers a malformed one with a
 * mandatory reload, so a value it cannot accept would reload, pin the same
 * value again, and reload again. Send nothing rather than something the
 * boundary must reject. Auth guarantees the id: `activate_organization` without
 * one is refused at the gateway before any request reaches cowork-server.
 */
function organizationIdFromClaim(value) {
  let claim = value;
  if (typeof claim === 'string') {
    const raw = nonEmptyString(claim);
    if (!raw) return null;
    try {
      claim = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const organization = recordOf(claim);
  const id = organization ? nonEmptyString(organization.id) : null;
  return id && UUID_PATTERN.test(id) ? id : null;
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
