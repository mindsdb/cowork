import { decodeJwtPayload, recordOf } from './jwtClaims';

let webIdentityRequired = false;
let documentIdentity = null;

function storageKeyForEpoch(baseKey, epoch) {
  return epoch === null ? baseKey : `${baseKey}:organization:${encodeURIComponent(epoch)}`;
}

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
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

function cacheIdentityFromAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  const subject = nonEmptyString(payload.sub);
  const organizationId = organizationIdFromClaim(payload.activate_organization);
  if (!subject || !organizationId) return null;
  try {
    return {
      subject,
      organizationId,
      namespace: `subject:${encodeURIComponent(subject)}:organization:${encodeURIComponent(organizationId)}`,
    };
  } catch {
    return null;
  }
}

/**
 * Require identity before web React hydration; cache access fails closed until the initial token is
 * pinned.
 * Electron and legacy tenant hosts retain unscoped persistence.
 */
export function requireWebOrganizationCacheIdentity() {
  webIdentityRequired = true;
  documentIdentity = null;
}

/**
 * Pin the document to its initial subject/organization; token changes require a reload, never
 * retargeting this heap.
 */
export function pinWebOrganizationCacheIdentity(accessToken) {
  if (!webIdentityRequired) return 'unscoped';
  const nextIdentity = cacheIdentityFromAccessToken(accessToken);
  if (!nextIdentity) return 'unavailable';
  if (documentIdentity === null) {
    documentIdentity = nextIdentity;
    return 'pinned';
  }
  return documentIdentity.subject === nextIdentity.subject
    && documentIdentity.organizationId === nextIdentity.organizationId
    ? 'matched'
    : 'changed';
}

/**
 * The epoch isolates live switches; token identity also separates sessions changed through Keycloak
 * while Cowork was closed.
 */
export function storageKeyForOrganizationIdentity(baseKey, epoch) {
  if (!webIdentityRequired) return storageKeyForEpoch(baseKey, epoch);
  if (documentIdentity === null) return null;
  const identityKey = `${baseKey}:${documentIdentity.namespace}`;
  return epoch === null ? identityKey : `${identityKey}:epoch:${encodeURIComponent(epoch)}`;
}

/** Reset module state between tests. */
export function __resetOrganizationCacheIdentityForTests() {
  webIdentityRequired = false;
  documentIdentity = null;
}
