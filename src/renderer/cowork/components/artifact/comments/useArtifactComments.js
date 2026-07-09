// Shared artifact-comments state: initial load + realtime SSE (reconnect with
// backoff + full refetch, terminal 401/403 stops), and create / reply / status /
// edit / delete mutations.
//
// Lifted out of CommentsPanel so a single instance can back BOTH the sidebar
// list and the on-artifact marker layer bridge (ArtifactCommentLayer) — one
// stream, one source of truth. Talks only to cowork-server, which attaches the
// user's MindsHub creds and proxies to the inference backend.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addCommentReply,
  createCommentThread,
  deleteCommentReply,
  deleteCommentThread,
  editCommentReply,
  editCommentThread,
  listCommentThreads,
  openCommentsStream,
  setCommentThreadStatus,
} from '../../../api';
import { maxUpdatedAt, upsertThread } from '../../../lib/commentsReducer';

export function useArtifactComments(userDir, reportId, { enabled = true } = {}) {
  const [threads, setThreads] = useState([]);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  // Server-echoed identity of the current viewer (X-User-Id for cowork). Used by
  // the UI to gate edit/delete controls; the server still re-checks authorship.
  const [viewer, setViewer] = useState(null);
  const threadsRef = useRef([]);
  threadsRef.current = threads;

  const apply = useCallback((event) => {
    setThreads((prev) => upsertThread(prev, event));
  }, []);

  // Initial load, then subscribe from the max updated_at (closes the gap).
  // On any drop we do a FULL refetch before resubscribing (decision A): deletes
  // that happened while offline reconcile by absence in the fresh set. A terminal
  // 401/403 stops for good (session expired) instead of hammering the server.
  useEffect(() => {
    // The hook lives at the viewer level (not the short-lived panel), so a
    // change of artifact (userDir/reportId) or disabling must drop the previous
    // artifact's threads/error/expired/viewer — otherwise stale threads would
    // draw markers on, and a stale banner would show over, the new artifact.
    setThreads([]);
    setError('');
    setExpired(false);
    setViewer(null);
    if (!enabled || !userDir || !reportId) return undefined;
    let cancelled = false;
    let ctrl = null;
    let retryTimer = null;
    let attempts = 0;

    const subscribe = (since) => {
      if (cancelled) return;
      ctrl = openCommentsStream(userDir, reportId, since, {
        onEvent: (ev) => { attempts = 0; apply(ev); },
        onExpired: () => setExpired(true), // terminal — no reconnect
        onError: () => {
          if (cancelled) return;
          const delay = Math.min(30000, 1000 * 2 ** attempts);
          attempts += 1;
          // Full refetch on reconnect so offline deletions reconcile, then resubscribe.
          retryTimer = setTimeout(loadAndSubscribe, delay);
        },
      });
    };

    const loadAndSubscribe = () => {
      if (cancelled) return;
      listCommentThreads(userDir, reportId, 'all')
        .then((data) => {
          if (cancelled) return;
          const loaded = (data && data.threads) || [];
          setThreads(loaded);
          if (data && data.viewer) setViewer(data.viewer);
          subscribe(maxUpdatedAt(loaded));
        })
        .catch((e) => {
          if (cancelled) return;
          // Terminal auth failure (session expired) — stop for good instead of
          // hammering the server (req() sets e.status from the HTTP code).
          if (e && (e.status === 401 || e.status === 403)) { setExpired(true); return; }
          setError(e.message || 'Failed to load comments');
          // Keep trying so a transient list failure doesn't kill realtime.
          const delay = Math.min(30000, 1000 * 2 ** attempts);
          attempts += 1;
          retryTimer = setTimeout(loadAndSubscribe, delay);
        });
    };

    loadAndSubscribe();

    return () => {
      cancelled = true;
      if (ctrl) ctrl.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, userDir, reportId, apply]);

  const create = useCallback(async ({ selector = null, text }) => {
    if (!text || !text.trim()) return false;
    try {
      const created = await createCommentThread(userDir, reportId, { selector, text: text.trim() });
      apply({ ...created, type: created.type || 'thread.created' });
      return true;
    } catch (e) {
      setError(e.message || 'Failed to post');
      return false;
    }
  }, [userDir, reportId, apply]);

  const reply = useCallback(async (id, text) => {
    if (!text || !text.trim()) return;
    try {
      const updated = await addCommentReply(userDir, reportId, id, text.trim());
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(e.message || 'Failed to reply');
    }
  }, [userDir, reportId, apply]);

  const setStatus = useCallback(async (id, status) => {
    try {
      const updated = await setCommentThreadStatus(userDir, reportId, id, status);
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(e.message || 'Failed to update');
    }
  }, [userDir, reportId, apply]);

  const editThread = useCallback(async (id, text) => {
    if (!text || !text.trim()) return;
    try {
      const updated = await editCommentThread(userDir, reportId, id, text.trim());
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(e.message || 'Failed to edit');
    }
  }, [userDir, reportId, apply]);

  const deleteThread = useCallback(async (id) => {
    try {
      await deleteCommentThread(userDir, reportId, id);
      apply({ type: 'thread.deleted', id });
    } catch (e) {
      setError(e.message || 'Failed to delete');
    }
  }, [userDir, reportId, apply]);

  const editReply = useCallback(async (id, replyId, text) => {
    if (!text || !text.trim()) return;
    try {
      const updated = await editCommentReply(userDir, reportId, id, replyId, text.trim());
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(e.message || 'Failed to edit');
    }
  }, [userDir, reportId, apply]);

  const deleteReply = useCallback(async (id, replyId) => {
    try {
      const updated = await deleteCommentReply(userDir, reportId, id, replyId);
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(e.message || 'Failed to delete');
    }
  }, [userDir, reportId, apply]);

  return {
    threads, error, expired, viewer,
    create, reply, setStatus,
    editThread, deleteThread, editReply, deleteReply,
  };
}

export default useArtifactComments;
