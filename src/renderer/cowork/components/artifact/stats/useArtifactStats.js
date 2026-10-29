// View stats of one published artifact, for its owner.
//
// Loads every time the Stats panel opens (`enabled` turns true) and never
// polls. Desktop addresses the artifact by path and org mode by project and
// id, the same split usePublish makes. API functions are called only from
// callbacks, never during render.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPublishStats, publishTargetPath, setPublishTracking } from '../../../api';
import { loadArtifactStats, setArtifactTracking } from '../../../lib/artifactWorkspaceApi';
import { useOrgMode } from '../../../../lib/orgMode';

export function toStatsError(e) {
  return {
    status: typeof e?.status === 'number' ? e.status : null,
    code: e?.code || null,
    message: e?.message || 'Could not load stats.',
  };
}

function identityOf(artifact) {
  return `${artifact?.projectId || ''}/${artifact?.id || ''}/${artifact?.folder || artifact?.path || ''}`;
}

export function useArtifactStats(artifact, { enabled = false } = {}) {
  const orgMode = useOrgMode();
  // Data, error and the saving lock are stored with the identity they belong
  // to. After an artifact switch none of the previous artifact's state is
  // returned, not even in the render before the effects run.
  const [entry, setEntry] = useState(null);
  const [errorEntry, setErrorEntry] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [loading, setLoading] = useState(false);

  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;
  const identity = identityOf(artifact);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  // Bumped by every load and by every close, so a response that belongs to
  // an earlier open or to another artifact is dropped instead of painted.
  const requestRef = useRef(0);
  const busyKeyRef = useRef(null);
  const data = entry && entry.key === identity ? entry.value : null;
  const error = errorEntry && errorEntry.key === identity ? errorEntry.value : null;
  const trackingBusy = busyKey === identity;

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
    if (!enabled) {
      requestRef.current += 1;
      setLoading(false);
      return;
    }
    reload();
  }, [enabled, identity, reload]);

  const setTracking = useCallback(async (next) => {
    const key = identityRef.current;
    if (busyKeyRef.current === key || !data) return false;
    const previous = data.tracking;
    const patch = (tracking) => setEntry((current) => (
      current && current.key === key
        ? { ...current, value: { ...current.value, tracking } }
        : current
    ));
    busyKeyRef.current = key;
    setBusyKey(key);
    setErrorEntry(null);
    patch(next);
    try {
      const target = artifactRef.current;
      const result = orgMode
        ? await setArtifactTracking(target, next)
        : await setPublishTracking(publishTargetPath(target), next);
      patch(typeof result?.tracking === 'boolean' ? result.tracking : next);
      return true;
    } catch (e) {
      patch(previous);
      // One error slot serves the whole hook: a late failure for an artifact
      // no longer on screen must not overwrite the current artifact's error.
      if (identityRef.current === key) setErrorEntry({ key, value: toStatsError(e) });
      return false;
    } finally {
      // A change started for another artifact since then keeps its own lock.
      if (busyKeyRef.current === key) busyKeyRef.current = null;
      setBusyKey((current) => (current === key ? null : current));
    }
  }, [data, orgMode]);

  return { data, loading, error, trackingBusy, reload, setTracking };
}

export default useArtifactStats;
