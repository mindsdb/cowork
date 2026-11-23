// View stats and viewer analytics of one published artifact, for its owner.
//
// Loads every time the Stats panel (or the Share panel) opens (`enabled`
// turns true) and never polls. Desktop addresses the artifact by path and org
// mode by project and id, the same split usePublish makes. API functions are
// called only from callbacks, never during render.
//
// The Stats panel and the Share panel each hold one of these. A settings
// change saved in one is announced to the other (`trackingChanges`), so the
// two never disagree about whether analytics is on.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deletePublishStats,
  fetchPublishStats,
  fetchPublishStatsViewer,
  publishTargetPath,
  setPublishTracking,
} from '../../../api';
import {
  deleteArtifactStats,
  loadArtifactStats,
  loadArtifactStatsViewer,
  setArtifactTracking,
} from '../../../lib/artifactWorkspaceApi';
import { useOrgMode } from '../../../../lib/orgMode';
import i18n from '../../../../lib/i18n';

export function toStatsError(e) {
  return {
    status: typeof e?.status === 'number' ? e.status : null,
    code: e?.code || null,
    message: e?.message || i18n.t('artifacts:stats.errors.loadFailed'),
  };
}

function identityOf(artifact) {
  return `${artifact?.projectId || ''}/${artifact?.id || ''}/${artifact?.folder || artifact?.path || ''}`;
}

// `true`/`false` is the analytics switch alone; an object may carry either.
function settingsPatch(settings) {
  if (typeof settings === 'boolean') return { tracking: settings };
  const patch = {};
  if (typeof settings?.tracking === 'boolean') patch.tracking = settings.tracking;
  if (typeof settings?.require_email === 'boolean') patch.require_email = settings.require_email;
  return patch;
}

// Saved settings, announced to every hook showing the same artifact.
const listeners = new Set();
export const trackingChanges = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emit(identity, patch) {
    listeners.forEach((listener) => listener(identity, patch));
  },
};

export function useArtifactStats(artifact, { enabled = false } = {}) {
  const orgMode = useOrgMode();
  // Data, error and the saving lock are stored with the identity they belong
  // to. After an artifact switch none of the previous artifact's state is
  // returned, not even in the render before the effects run.
  const [entry, setEntry] = useState(null);
  const [errorEntry, setErrorEntry] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const [loading, setLoading] = useState(false);
  // The viewer whose visits are on screen: `{ key, id, data, loading, error }`.
  const [viewerEntry, setViewerEntry] = useState(null);

  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;
  const identity = identityOf(artifact);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  // Bumped by every load and by every close, so a response that belongs to
  // an earlier open or to another artifact is dropped instead of painted.
  const requestRef = useRef(0);
  const viewerRequestRef = useRef(0);
  const busyKeyRef = useRef(null);
  const data = entry && entry.key === identity ? entry.value : null;
  const error = errorEntry && errorEntry.key === identity ? errorEntry.value : null;
  const trackingBusy = busyKey === identity;
  const deleting = deletingKey === identity;
  const viewer = viewerEntry && viewerEntry.key === identity
    ? { id: viewerEntry.id, data: viewerEntry.data, loading: viewerEntry.loading, error: viewerEntry.error }
    : null;

  const patchSettings = useCallback((key, patch) => setEntry((current) => (
    current && current.key === key
      ? { ...current, value: { ...current.value, ...patch } }
      : current
  )), []);

  useEffect(() => trackingChanges.subscribe((key, patch) => patchSettings(key, patch)), [patchSettings]);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    const key = identityRef.current;
    setLoading(true);
    setErrorEntry(null);
    try {
      const target = artifactRef.current;
      const next = orgMode
        ? await loadArtifactStats(target)
        : await fetchPublishStats(publishTargetPath(target));
      if (request === requestRef.current) setEntry({ key, value: next });
    } catch (e) {
      if (request === requestRef.current) setErrorEntry({ key, value: toStatsError(e) });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [orgMode]);

  useEffect(() => {
    // Clearing on close means the next open starts from a skeleton, and the
    // viewer's "first load of this open" check never sees the previous data.
    setEntry(null);
    setErrorEntry(null);
    setViewerEntry(null);
    viewerRequestRef.current += 1;
    if (!enabled) {
      requestRef.current += 1;
      setLoading(false);
      return;
    }
    reload();
  }, [enabled, identity, reload]);

  // Saves the analytics switch (a boolean) or `{ tracking, require_email }`.
  const setTracking = useCallback(async (settings) => {
    const key = identityRef.current;
    const patch = settingsPatch(settings);
    if (busyKeyRef.current === key || !data || !Object.keys(patch).length) return false;
    const previous = Object.fromEntries(Object.keys(patch).map((name) => [name, data[name]]));
    busyKeyRef.current = key;
    setBusyKey(key);
    setErrorEntry(null);
    patchSettings(key, patch);
    try {
      const target = artifactRef.current;
      const result = orgMode
        ? await setArtifactTracking(target, settings)
        : await setPublishTracking(publishTargetPath(target), settings);
      const saved = { ...patch, ...settingsPatch(result || {}) };
      patchSettings(key, saved);
      trackingChanges.emit(key, saved);
      return true;
    } catch (e) {
      patchSettings(key, previous);
      // One error slot serves the whole hook: a late failure for an artifact
      // no longer on screen must not overwrite the current artifact's error.
      if (identityRef.current === key) setErrorEntry({ key, value: toStatsError(e) });
      return false;
    } finally {
      // A change started for another artifact since then keeps its own lock.
      if (busyKeyRef.current === key) busyKeyRef.current = null;
      setBusyKey((current) => (current === key ? null : current));
    }
  }, [data, orgMode, patchSettings]);

  const setRequireEmail = useCallback((on) => setTracking({ require_email: !!on }), [setTracking]);

  const openViewer = useCallback(async (viewerId) => {
    if (!viewerId) return;
    const request = ++viewerRequestRef.current;
    const key = identityRef.current;
    setViewerEntry({ key, id: viewerId, data: null, loading: true, error: null });
    try {
      const target = artifactRef.current;
      const next = orgMode
        ? await loadArtifactStatsViewer(target, viewerId)
        : await fetchPublishStatsViewer(publishTargetPath(target), viewerId);
      if (request === viewerRequestRef.current) {
        setViewerEntry({ key, id: viewerId, data: next, loading: false, error: null });
      }
    } catch (e) {
      if (request === viewerRequestRef.current) {
        setViewerEntry({ key, id: viewerId, data: null, loading: false, error: toStatsError(e) });
      }
    }
  }, [orgMode]);

  const closeViewer = useCallback(() => {
    viewerRequestRef.current += 1;
    setViewerEntry(null);
  }, []);

  // Deletes every view, visit and viewer recorded, then reads the stats
  // again so the panel shows what is left (the settings).
  const deleteAnalytics = useCallback(async () => {
    const key = identityRef.current;
    if (deletingKey === key) return false;
    setDeletingKey(key);
    setErrorEntry(null);
    try {
      const target = artifactRef.current;
      if (orgMode) await deleteArtifactStats(target);
      else await deletePublishStats(publishTargetPath(target));
      if (identityRef.current === key) {
        closeViewer();
        await reload();
      }
      return true;
    } catch (e) {
      if (identityRef.current === key) setErrorEntry({ key, value: toStatsError(e) });
      return false;
    } finally {
      setDeletingKey((current) => (current === key ? null : current));
    }
  }, [deletingKey, orgMode, closeViewer, reload]);

  return {
    data,
    loading,
    error,
    trackingBusy,
    deleting,
    viewer,
    reload,
    setTracking,
    setRequireEmail,
    openViewer,
    closeViewer,
    deleteAnalytics,
  };
}

export default useArtifactStats;
