/**
 * Read-through cache of the last successful settings fetch, used only to seed
 * the UI on first paint before the boot fetch resolves.
 *
 * This is a cache of the server — the single source of truth (ENG-941/ENG-1125)
 * — never a competing set of hard-coded defaults. Previously App.jsx seeded its
 * settings state from a literal object whose values could (and did, e.g.
 * showDots) disagree with the server's, so a wrong value flashed until the
 * fetch landed. Now the seed is either the last server response we saw or, on
 * the very first launch, empty — and the boot fetch fills it either way.
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
   * A settings request started in the old organization can finish after the
   * switch clears storage. Once a tenant transition begins, keep every late
   * write out until the hard reload gives this module a fresh lifetime. If the
   * epoch advances after this check, the write still targets this document's
   * epoch-qualified key and cannot overwrite current-organization settings.
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
