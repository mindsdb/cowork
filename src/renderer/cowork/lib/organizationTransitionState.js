/**
 * Durable cross-tab shape only. This module has no application dependencies so
 * tenant caches can tag their values without importing the switch coordinator.
 */
export const ORGANIZATION_TRANSITION_STORAGE_KEY = 'anton.organizationTransition';

function recordOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function validTransitionId(value) {
  /**
   * IDs are either crypto.randomUUID() or the timestamp/base36 fallback made
   * by the coordinator. Constraining the persisted shape also guarantees the
   * epoch can be encoded into a storage key without a malformed surrogate
   * throwing during static module evaluation.
   */
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function reloadMarkerOf(value) {
  const marker = recordOf(value);
  if (!marker || !validTransitionId(marker.id) || typeof marker.startedAt !== 'number') {
    return null;
  }
  return {
    version: 1,
    id: marker.id,
    phase: 'reload',
    subject: typeof marker.subject === 'string' ? marker.subject : null,
    startedAt: marker.startedAt,
  };
}

export function parseOrganizationTransition(raw) {
  if (!raw) return null;
  try {
    const value = recordOf(JSON.parse(raw));
    if (
      !value
      || value.version !== 1
      || !validTransitionId(value.id)
      || !['pending', 'reload'].includes(value.phase)
      || typeof value.startedAt !== 'number'
    ) return null;
    return {
      version: 1,
      id: value.id,
      phase: value.phase,
      subject: typeof value.subject === 'string' ? value.subject : null,
      startedAt: value.startedAt,
      previousReload: value.phase === 'pending' ? reloadMarkerOf(value.previousReload) : null,
    };
  } catch {
    return null;
  }
}

export function readOrganizationTransition() {
  try {
    return parseOrganizationTransition(
      globalThis.localStorage?.getItem(ORGANIZATION_TRANSITION_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

/**
 * During a pending switch, cached state still belongs to the last committed
 * epoch. If the request is refused that epoch remains current; if it commits,
 * the new transition id becomes the epoch and old cache envelopes stop loading.
 */
export function organizationEpochForTransition(transition) {
  if (transition?.phase === 'reload') return transition.id;
  if (transition?.phase === 'pending') return transition.previousReload?.id ?? null;
  return null;
}

export function currentOrganizationEpoch() {
  return organizationEpochForTransition(readOrganizationTransition());
}

/**
 * Keep each committed organization's browser cache on a distinct key. A late
 * write from an older document can then touch only its own epoch; localStorage
 * has no atomic compare-and-set with which a shared-key envelope could prevent
 * that write from overwriting the current organization's value.
 */
export function storageKeyForOrganizationEpoch(baseKey, epoch) {
  return epoch === null ? baseKey : `${baseKey}:organization:${encodeURIComponent(epoch)}`;
}

/**
 * One read shared by every module in this JavaScript document. Reading once in
 * draft, settings, and coordinator modules independently creates a boot race in
 * which each can believe it belongs to a different tenant epoch.
 */
export const DOCUMENT_ORGANIZATION_TRANSITION = readOrganizationTransition();
export const DOCUMENT_ORGANIZATION_EPOCH = organizationEpochForTransition(
  DOCUMENT_ORGANIZATION_TRANSITION,
);
