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
   * Constrain persisted ids so encodeURIComponent cannot throw on malformed surrogates during
   * module evaluation.
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
 * A pending switch still belongs to the previous committed epoch; only a committed transition
 * invalidates old caches.
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
 * Use distinct epoch keys: localStorage has no compare-and-set to prevent an old document
 * overwriting a shared current-tenant key.
 */
export function storageKeyForOrganizationEpoch(baseKey, epoch) {
  return epoch === null ? baseKey : `${baseKey}:organization:${encodeURIComponent(epoch)}`;
}

/**
 * Read once per document so draft, settings, and coordinator modules cannot boot into different
 * tenant epochs.
 */
export const DOCUMENT_ORGANIZATION_TRANSITION = readOrganizationTransition();
export const DOCUMENT_ORGANIZATION_EPOCH = organizationEpochForTransition(
  DOCUMENT_ORGANIZATION_TRANSITION,
);
