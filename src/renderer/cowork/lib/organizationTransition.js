import { clearDraftsForOrganizationSwitch } from './draftStore';
import { clearCachedSettings } from './settingsCache';
import {
  DOCUMENT_ORGANIZATION_EPOCH,
  DOCUMENT_ORGANIZATION_TRANSITION,
  ORGANIZATION_TRANSITION_STORAGE_KEY,
  organizationEpochForTransition,
  parseOrganizationTransition,
} from './organizationTransitionState';

/**
 * Keycloak's active organization is shared by every Cowork tab, while each
 * tab's tasks, drafts, settings, and access token live in that document. Keep a
 * persisted transition marker so a second tab cannot refresh into the new
 * tenant while it still renders the old one's state.
 */
const STORAGE_KEY = ORGANIZATION_TRANSITION_STORAGE_KEY;
const LOCK_NAME = 'anton.organizationTransition.lock';
const PENDING_MAX_MS = 25_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;

let storageUnavailable = false;
let transition = DOCUMENT_ORGANIZATION_TRANSITION;
let ownedPendingId = null;
let pendingTimer = null;
let reloadStarted = false;
/**
 * This is deliberately document-local. sessionStorage belongs to the tab and
 * can be shared with a bfcached predecessor or copied into a new window, so it
 * cannot prove that this particular JavaScript heap booted in the current epoch.
 */
let appliedReloadId = DOCUMENT_ORGANIZATION_EPOCH;

function readTransition() {
  try {
    return parseOrganizationTransition(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    storageUnavailable = true;
    return null;
  }
}

function writeTransition(next) {
  transition = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    const persisted = parseOrganizationTransition(globalThis.localStorage?.getItem(STORAGE_KEY));
    if (persisted?.id !== next.id || persisted.phase !== next.phase) {
      storageUnavailable = true;
      return false;
    }
    return true;
  } catch {
    /**
     * The initiating document remains protected by the in-memory marker. A
     * browser that denies same-origin storage cannot coordinate other tabs.
     */
    storageUnavailable = true;
    return false;
  }
}

function removeTransition() {
  transition = null;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    storageUnavailable = true;
  }
}

function refreshTransition() {
  if (storageUnavailable) return transition;
  transition = readTransition();
  return transition;
}

function clearPendingTimer() {
  if (pendingTimer !== null) globalThis.clearTimeout(pendingTimer);
  pendingTimer = null;
}

function schedulePendingExpiry(next) {
  clearPendingTimer();
  if (next?.phase !== 'pending') return;
  const remaining = Math.max(0, next.startedAt + PENDING_MAX_MS - Date.now());
  pendingTimer = globalThis.setTimeout(() => {
    const current = refreshTransition();
    if (current?.phase === 'pending' && current.id === next.id) {
      publishReload(current.id, true);
    }
  }, remaining);
}

function reloadWasApplied(id) {
  return appliedReloadId === id;
}

function rememberReload(id) {
  appliedReloadId = id;
}

async function acquireTransitionLock() {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== 'function') {
    throw new Error('Exclusive browser locks are unavailable');
  }

  return new Promise((resolve, reject) => {
    let accepting = true;
    const timeout = globalThis.setTimeout(() => {
      accepting = false;
      reject(new Error('Organization transition lock timed out'));
    }, LOCK_ACQUIRE_TIMEOUT_MS);

    try {
      const request = locks.request(
        LOCK_NAME,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!accepting) return;
          globalThis.clearTimeout(timeout);
          accepting = false;
          if (!lock) {
            resolve(null);
            return;
          }
          await new Promise((release) => {
            let released = false;
            resolve(() => {
              if (released) return;
              released = true;
              release();
            });
          });
        },
      );
      Promise.resolve(request).catch((error) => {
        if (!accepting) return;
        globalThis.clearTimeout(timeout);
        accepting = false;
        reject(error);
      });
    } catch (error) {
      globalThis.clearTimeout(timeout);
      accepting = false;
      reject(error);
    }
  });
}

/** Clear this document's tenant state and replace it. Safe to call repeatedly. */
export function prepareForOrganizationReload({
  transitionId = null,
  clearTenantState = true,
} = {}) {
  if (reloadStarted) return;
  reloadStarted = true;
  if (transitionId) rememberReload(transitionId);
  if (clearTenantState) {
    clearCachedSettings();
    clearDraftsForOrganizationSwitch();
  }
  globalThis.location?.reload();
}

function publishReload(id, applyLocally) {
  const current = refreshTransition();
  const markerId = current?.id ?? id;
  const next = {
    version: 1,
    id: markerId,
    phase: 'reload',
    subject: current?.subject ?? null,
    startedAt: Date.now(),
  };
  clearPendingTimer();
  writeTransition(next);
  if (applyLocally) prepareForOrganizationReload({ transitionId: markerId });
  else {
    /**
     * pagehide can be the only surviving outcome path. Purge its eagerly
     * hydrated draft heap and shared cache without marking this old document
     * current; a bfcache resurrection must still reload on pageshow.
     */
    clearCachedSettings();
    clearDraftsForOrganizationSwitch();
  }
  if (ownedPendingId === id) ownedPendingId = null;
}

/** Persist the point after which every Cowork tab must stop acquiring tokens. */
export async function beginOrganizationTransition(subject) {
  const lockRelease = await acquireTransitionLock();
  if (!lockRelease) throw new Error('Another organization transition is in progress');
  try {
    /**
     * Web Locks makes this read/write section mutually exclusive across tabs.
     * localStorage read-back alone cannot provide compare-and-set semantics.
     */
    const current = refreshTransition();
    if (current?.phase === 'pending') {
      throw new Error('Another organization transition is in progress');
    }
    if (current?.phase === 'reload' && !reloadWasApplied(current.id)) {
      prepareForOrganizationReload({ transitionId: current.id });
      throw new Error('An organization transition requires reload');
    }
    const id = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const next = {
      version: 1,
      id,
      phase: 'pending',
      subject: typeof subject === 'string' ? subject : null,
      startedAt: Date.now(),
      previousReload: current?.phase === 'reload' ? current : null,
    };
    if (!writeTransition(next)) {
      transition = null;
      throw new Error('Organization transition storage is unavailable');
    }
    ownedPendingId = id;
    schedulePendingExpiry(next);
    /**
     * The lock protects the check plus durable pending write. Keeping it for
     * the network request would let a browser-frozen owner block every future
     * switch indefinitely; later acquirers now observe `pending` and refuse.
     */
    lockRelease();
    return id;
  } catch (error) {
    lockRelease();
    throw error;
  }
}

/** A known refusal leaves every document on its existing tenant. */
export function releaseOrganizationTransition(id) {
  const current = refreshTransition();
  if (current?.id !== id || current.phase !== 'pending') {
    if (ownedPendingId === id) ownedPendingId = null;
    return;
  }
  clearPendingTimer();
  if (current.previousReload) writeTransition(current.previousReload);
  else removeTransition();
  if (ownedPendingId === id) ownedPendingId = null;
}

/** Publish and apply the mandatory reload outcome in this and every other tab. */
export function reloadForOrganizationTransition(id) {
  publishReload(id, true);
}

/** Stop ordinary API token reads while this document may show another tenant. */
export function assertOrganizationTransitionClear() {
  if (reloadStarted) throw new Error('Organization change requires reload');
  const current = refreshTransition();
  if (!current) return;
  const committedEpoch = organizationEpochForTransition(current);
  if (appliedReloadId !== committedEpoch) {
    prepareForOrganizationReload({ transitionId: committedEpoch });
    throw new Error('Organization change requires reload');
  }
  if (current.phase === 'pending') {
    if (Date.now() >= current.startedAt + PENDING_MAX_MS) {
      publishReload(current.id, true);
      throw new Error('Organization change requires reload');
    }
    schedulePendingExpiry(current);
    throw new Error('Organization change is in progress');
  }
}

function onStorage(event) {
  if (event.key !== STORAGE_KEY) return;
  const next = parseOrganizationTransition(event.newValue);
  transition = next;
  schedulePendingExpiry(next);
  const committedEpoch = organizationEpochForTransition(next);
  if (next && appliedReloadId !== committedEpoch) {
    prepareForOrganizationReload({ transitionId: committedEpoch });
  }
}

function onPageShow() {
  const current = refreshTransition();
  schedulePendingExpiry(current);
  const committedEpoch = organizationEpochForTransition(current);
  if (current && appliedReloadId !== committedEpoch) {
    prepareForOrganizationReload({ transitionId: committedEpoch });
  }
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('storage', onStorage);
  /**
   * A bfcached page can resume without replaying the storage event that fired
   * while it was frozen. Reconcile before that old document becomes usable.
   */
  globalThis.addEventListener('pageshow', onPageShow);
  globalThis.addEventListener('pagehide', () => {
    if (ownedPendingId) publishReload(ownedPendingId, false);
  });
}

/**
 * `appliedReloadId` captured this document's committed epoch above. The storage
 * listener is registered before this second read, so a marker that changed
 * during module evaluation is either observed here or by the event handler.
 */
const currentAtStartup = refreshTransition();
const currentStartupEpoch = organizationEpochForTransition(currentAtStartup);
if (currentAtStartup && appliedReloadId !== currentStartupEpoch) {
  prepareForOrganizationReload({ transitionId: currentStartupEpoch });
}

/**
 * A document born during a pending request captures its `previousReload`, so
 * restoring a refused switch does not spuriously wipe current-org state. A
 * document born after a committed marker is fresh and its epoch-tagged caches
 * reject any old payload; an older heap has a different in-memory id and must
 * reload.
 */
if (currentAtStartup?.phase === 'pending') schedulePendingExpiry(currentAtStartup);

/** Reset module-lifetime state between tests. */
export function __resetOrganizationTransitionForTests() {
  clearPendingTimer();
  transition = null;
  ownedPendingId = null;
  reloadStarted = false;
  appliedReloadId = organizationEpochForTransition(transition);
  storageUnavailable = false;
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* test cleanup */ }
}
