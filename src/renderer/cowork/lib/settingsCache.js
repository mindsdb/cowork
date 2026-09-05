/**
 * Seed first paint from the last successful server settings response, or empty on first launch.
 * The boot fetch remains authoritative; local defaults would flash values that can disagree with
 * the server.
 */
import {
  currentOrganizationEpoch,
  DOCUMENT_ORGANIZATION_EPOCH,
} from './organizationTransitionState';
import { storageKeyForOrganizationIdentity } from './organizationCacheIdentity';

const BASE_KEY = 'anton.settingsCache';
const CACHE_VERSION = 1;
const organizationEpoch = DOCUMENT_ORGANIZATION_EPOCH;
let cacheWritesDisabled = false;

function storageKey() {
  return storageKeyForOrganizationIdentity(BASE_KEY, organizationEpoch);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The cached settings blob, or {} when absent/unreadable. */
export function loadCachedSettings() {
  try {
    if (currentOrganizationEpoch() !== organizationEpoch) return {};
    const key = storageKey();
    if (key === null) return {};
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (
      plainObject(parsed)
      && parsed.version === CACHE_VERSION
      && Object.hasOwn(parsed, 'settings')
    ) {
      return parsed.organizationEpoch === organizationEpoch && plainObject(parsed.settings)
        ? parsed.settings
        : {};
    }
    /**
     * Read the pre-epoch shape only until the browser completes its first
     * organization transition. The next successful write migrates it.
     */
    return organizationEpoch === null && plainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist the latest settings blob for the next cold start. Best-effort. */
export function cacheSettings(settings) {
  /**
   * Reject late writes after a tenant transition until reload.
   * A transition racing this check remains safe because the key belongs to this document's epoch.
   */
  if (cacheWritesDisabled || currentOrganizationEpoch() !== organizationEpoch) return;
  try {
    if (!settings || typeof settings !== 'object') return;
    const key = storageKey();
    if (key === null) return;
    globalThis.localStorage?.setItem(key, JSON.stringify({
      version: CACHE_VERSION,
      organizationEpoch,
      settings,
    }));
  } catch {
    /* localStorage unavailable / quota exceeded — first paint just starts bare */
  }
}

/** Forget settings cached for the organization being left. Best-effort. */
export function clearCachedSettings() {
  cacheWritesDisabled = true;
  try {
    /**
     * The key is fixed to this document's identity and epoch, so an old
     * document cannot remove newer settings if their operations interleave.
     */
    const key = storageKey();
    if (key !== null) globalThis.localStorage?.removeItem(key);
  } catch {
    /* localStorage unavailable — the organization switch can still proceed */
  }
}

/** Restore the module-lifetime write guard between tests. */
export function __resetSettingsCacheForTests() {
  cacheWritesDisabled = false;
}
