/**
 * The last org-branding answer (GET /api/v1/org-branding), kept per org so
 * the first paint after a reload is already branded instead of flashing the
 * stock look until the read lands. Same shape and rules as settingsCache.js:
 * the key carries this document's subject and organization, writes stop once
 * an organization switch begins, and every storage error is swallowed.
 *
 * Only what parseOrgBranding accepts is stored or returned, so a tampered
 * entry cannot put an image from another host on the page.
 */
import { parseOrgBranding } from '../../lib/orgBranding';
import {
  currentOrganizationEpoch,
  DOCUMENT_ORGANIZATION_EPOCH,
} from './organizationTransitionState';
import { storageKeyForOrganizationIdentity } from './organizationCacheIdentity';

const BASE_KEY = 'anton.orgBrandingCache';
const CACHE_VERSION = 1;
const organizationEpoch = DOCUMENT_ORGANIZATION_EPOCH;
let cacheWritesDisabled = false;

function storageKey() {
  return storageKeyForOrganizationIdentity(BASE_KEY, organizationEpoch);
}

/** The cached answer, or null when absent, unreadable or for another epoch. */
export function loadCachedOrgBranding() {
  try {
    if (currentOrganizationEpoch() !== organizationEpoch) return null;
    const key = storageKey();
    if (key === null) return null;
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed
      || typeof parsed !== 'object'
      || parsed.version !== CACHE_VERSION
      || parsed.organizationEpoch !== organizationEpoch
    ) return null;
    return parseOrgBranding(parsed.branding);
  } catch {
    return null;
  }
}

/** Remember the latest answer for the next cold start. Best-effort. */
export function cacheOrgBranding(branding) {
  if (cacheWritesDisabled || currentOrganizationEpoch() !== organizationEpoch) return;
  try {
    if (!branding || typeof branding !== 'object') return;
    const key = storageKey();
    if (key === null) return;
    globalThis.localStorage?.setItem(key, JSON.stringify({
      version: CACHE_VERSION,
      organizationEpoch,
      branding,
    }));
  } catch {
    /* localStorage unavailable or full: the first paint just starts stock */
  }
}

/** Forget the answer cached for the organization being left. Best-effort. */
export function clearCachedOrgBranding() {
  cacheWritesDisabled = true;
  try {
    const key = storageKey();
    if (key !== null) globalThis.localStorage?.removeItem(key);
  } catch {
    /* localStorage unavailable: the switch can still proceed */
  }
}

/** Restore the module-lifetime write guard between tests. */
export function __resetOrgBrandingCacheForTests() {
  cacheWritesDisabled = false;
}
