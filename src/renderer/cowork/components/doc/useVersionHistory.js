// useVersionHistory — a doc's version history as its pane shows it: the list
// (asked for each time the menu opens, so it is never stale), the version
// being looked at (read-only, stepped through with ‹ ›), restoring it after a
// confirmation, and the Undo offered after that. A restore is the server's:
// the restored doc reaches the pane on its stream like any other write.
//
// Every answer belongs to the doc it was asked for: one that lands after the
// pane has moved to another doc, or after a later version was picked, is let go.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDocHistory, fetchDocVersion, restoreDocVersion } from './docApi';
import { stepFrom } from './versionHistory';

// How long "Restored", with its Undo, stays in view: long enough to look the doc over first.
export const RESTORED_SHOWN_MS = 20_000;

export function useVersionHistory({ projectRef, artifactId, onError }) {
  const [list, setList] = useState(null); // { current, versions } | { failed: true }
  const [preview, setPreview] = useState(null); // { entry, doc }
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(null); // { entry, replacedRev }
  const docRun = useRef(0);
  const picked = useRef(0);

  useEffect(() => {
    docRun.current += 1;
    setList(null);
    setPreview(null);
    setConfirming(false);
    setRestoring(false);
    setRestored(null);
  }, [projectRef, artifactId]);

  const load = useCallback(async () => {
    const run = docRun.current;
    try {
      const got = await fetchDocHistory(projectRef, artifactId);
      if (run === docRun.current) setList(got);
    } catch {
      if (run === docRun.current) setList({ failed: true });
    }
  }, [projectRef, artifactId]);

  const open = useCallback(async (entry) => {
    const run = docRun.current;
    const pick = ++picked.current;
    try {
      const doc = await fetchDocVersion(projectRef, artifactId, entry.rev);
      if (run === docRun.current && pick === picked.current) setPreview({ entry, doc });
    } catch (e) {
      if (run === docRun.current && pick === picked.current) onError?.(e?.message || 'Could not open that version');
    }
  }, [projectRef, artifactId, onError]);

  const close = useCallback(() => {
    picked.current += 1;
    setPreview(null);
    setConfirming(false);
  }, []);

  const versions = list?.versions || [];
  const older = preview ? stepFrom(versions, preview.entry.rev, 'older') : null;
  const newer = preview ? stepFrom(versions, preview.entry.rev, 'newer') : null;
  const step = useCallback((direction) => {
    const next = direction === 'older' ? older : newer;
    if (next) open(next);
  }, [older, newer, open]);

  const restore = useCallback(async () => {
    if (!preview || restoring) return;
    const run = docRun.current;
    const { entry } = preview;
    setRestoring(true);
    try {
      const { replacedRev } = await restoreDocVersion(projectRef, artifactId, entry.rev);
      if (run !== docRun.current) return;
      picked.current += 1;
      setPreview(null);
      setList(null);
      setRestored({ entry, replacedRev });
    } catch (e) {
      if (run === docRun.current) onError?.(e?.message || 'Could not restore that version');
    } finally {
      if (run === docRun.current) {
        setRestoring(false);
        setConfirming(false);
      }
    }
  }, [preview, restoring, projectRef, artifactId, onError]);

  const undo = useCallback(async () => {
    if (!restored) return;
    const run = docRun.current;
    setRestored(null);
    try {
      await restoreDocVersion(projectRef, artifactId, restored.replacedRev);
    } catch (e) {
      if (run === docRun.current) onError?.(e?.message || 'Could not undo the restore');
    }
  }, [restored, projectRef, artifactId, onError]);

  useEffect(() => {
    if (!restored) return undefined;
    const t = setTimeout(() => setRestored(null), RESTORED_SHOWN_MS);
    return () => clearTimeout(t);
  }, [restored]);

  return {
    list,
    load,
    preview,
    open,
    close,
    step,
    canStep: { older: !!older, newer: !!newer },
    confirming,
    askToRestore: useCallback(() => setConfirming(true), []),
    cancelRestore: useCallback(() => setConfirming(false), []),
    restore,
    restoring,
    restored,
    dismissRestored: useCallback(() => setRestored(null), []),
    undo,
  };
}
