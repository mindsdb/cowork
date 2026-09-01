import { decodeBase64UrlJson, recordOf } from './jwtClaims';

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
  if (typeof accessToken !== 'string') return null;
  const segments = accessToken.split('.');
  if (segments.length < 2) return null;
  const payload = decodeBase64UrlJson(segments[1]);
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
 * Mark the canonical browser build as identity-bound before React can hydrate
 * tenant state. Until a valid initial token is pinned, reads and writes fail
 * closed. Electron and legacy tenant hosts never call this and retain their
 * existing unscoped persistence behavior.
 */
export function requireWebOrganizationCacheIdentity() {
  webIdentityRequired = true;
  documentIdentity = null;
}

/**
 * Pin this JavaScript document to the subject and organization in its initial
 * authenticated token. A later token cannot retarget an already-running heap;
 * the request boundary owns reloading that document instead.
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
 * Resolve a cache key for this document. The transition epoch still separates
 * live same-origin switches; the token identity also separates sessions when
 * Keycloak changed on another origin while Cowork was closed.
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
