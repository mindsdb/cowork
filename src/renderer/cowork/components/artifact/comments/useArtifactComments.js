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
  markCommentsRead,
  openCommentsStream,
  setCommentThreadStatus,
} from '../../../api';
import { maxUpdatedAt, upsertThread } from '../../../lib/commentsReducer';
import i18n from '../../../../lib/i18n';

const failed = (action) => i18n.t(`comments.errors.${action}`, { ns: 'artifacts' });

// A dropped connection reads "Failed to fetch" / "Load failed" / "NetworkError…"
// depending on the browser; none of that is worth showing. Those, and errors
// with no message, read as the action that failed.
function isNetworkError(e) {
  return e instanceof TypeError || /failed to fetch|load failed|networkerror|network request failed/i.test(String(e?.message || ''));
}
const reasonFor = (e, action) => (!e?.message || isNetworkError(e) ? failed(action) : e.message);

// A warning is a moment's notice, not a state: it fades (CommentsPanel) and
// clears after this long. Loading keeps retrying underneath, and a success
// clears it at once.
export const COMMENTS_ERROR_MS = 6000;
// Marking read is housekeeping: it retries quietly a few times, then waits
// for the next open of the inbox.
const MARK_READ_RETRIES = 3;
const MARK_READ_RETRY_MS = 4000;

export function useArtifactComments(userDir, reportId, { enabled = true, onUnread } = {}) {
  const [threads, setThreads] = useState([]);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  // Server-echoed identity of the current viewer (X-User-Id for cowork). Used by
  // the UI to gate edit/delete controls; the server still re-checks authorship.
  const [viewer, setViewer] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const viewerRef = useRef(null);
  viewerRef.current = viewer;
  const onUnreadRef = useRef(onUnread);
  onUnreadRef.current = onUnread;
  const unreadRequestRef = useRef(0);

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
    setCapabilities(null);
    setUnreadCount(0);
    unreadRequestRef.current += 1;
    if (!enabled || !userDir || !reportId) return undefined;
    let cancelled = false;
    let ctrl = null;
    let retryTimer = null;
    let attempts = 0;

    const subscribe = (since) => {
      if (cancelled) return;
      ctrl = openCommentsStream(userDir, reportId, since, {
        onEvent: (ev) => {
          attempts = 0;
          apply(ev);
          const actorId = ev?.actor_user_id || ev?.payload?.author?.user_id;
          if ((ev?.type === 'thread.created' || ev?.type === 'thread.updated')
            && actorId
            && String(actorId) !== String(viewerRef.current?.user_id || '')) {
            // Unread is a count of threads, not events. A busy discussion can
            // emit several updates for one still-unread thread, so re-read the
            // server's receipt-based count instead of incrementing locally.
            const requestId = unreadRequestRef.current + 1;
            unreadRequestRef.current = requestId;
            listCommentThreads(userDir, reportId, 'all')
              .then((data) => {
                if (!cancelled && unreadRequestRef.current === requestId) {
                  setUnreadCount(Number(data?.unreadCount || 0));
                }
              })
              .catch(() => { /* the SSE reconnect path will reconcile */ });
            onUnreadRef.current?.(ev);
          }
        },
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
          setError('');
          if (data && data.viewer) setViewer(data.viewer);
          if (data && data.capabilities) setCapabilities(data.capabilities);
          setUnreadCount(Number(data?.unreadCount || 0));
          subscribe(maxUpdatedAt(loaded));
        })
        .catch((e) => {
          if (cancelled) return;
          // Terminal auth failure (session expired) — stop for good instead of
          // hammering the server (req() sets e.status from the HTTP code).
          if (e && (e.status === 401 || e.status === 403)) { setExpired(true); return; }
          setError(reasonFor(e, 'load'));
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

  const create = useCallback(async ({
    selector = null, text, revisionId = null, kind = 'review',
  }) => {
    if (!text || !text.trim()) return false;
    try {
      const created = await createCommentThread(userDir, reportId, {
        selector, text: text.trim(), revisionId, kind,
      });
      apply({ ...created, type: created.type || 'thread.created' });
      return true;
    } catch (e) {
      setError(reasonFor(e, 'post'));
      return false;
    }
  }, [userDir, reportId, apply]);

  const reply = useCallback(async (id, text) => {
    if (!text || !text.trim()) return;
    try {
      const updated = await addCommentReply(userDir, reportId, id, text.trim());
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(reasonFor(e, 'reply'));
    }
  }, [userDir, reportId, apply]);

  const setStatus = useCallback(async (id, status) => {
    try {
      const updated = await setCommentThreadStatus(userDir, reportId, id, status);
      apply({ ...updated, type: 'thread.updated' });
      return true;
    } catch (e) {
      setError(reasonFor(e, 'update'));
      return false;
    }
  }, [userDir, reportId, apply]);

  const editThread = useCallback(async (id, text) => {
    if (!text || !text.trim()) return;
    try {
      const updated = await editCommentThread(userDir, reportId, id, text.trim());
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(reasonFor(e, 'edit'));
    }
  }, [userDir, reportId, apply]);

  const deleteThread = useCallback(async (id) => {
    try {
      await deleteCommentThread(userDir, reportId, id);
      apply({ type: 'thread.deleted', id });
    } catch (e) {
      setError(reasonFor(e, 'delete'));
    }
  }, [userDir, reportId, apply]);

  const editReply = useCallback(async (id, replyId, text) => {
    if (!text || !text.trim()) return;
    try {
      const updated = await editCommentReply(userDir, reportId, id, replyId, text.trim());
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(reasonFor(e, 'edit'));
    }
  }, [userDir, reportId, apply]);

  const deleteReply = useCallback(async (id, replyId) => {
    try {
      const updated = await deleteCommentReply(userDir, reportId, id, replyId);
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(reasonFor(e, 'delete'));
    }
  }, [userDir, reportId, apply]);

  const markReadRetryRef = useRef({ timer: null, attempts: 0 });
  const markRead = useCallback(async () => {
    const retry = markReadRetryRef.current;
    clearTimeout(retry.timer);
    try {
      await markCommentsRead(userDir, reportId);
      retry.attempts = 0;
      unreadRequestRef.current += 1;
      setUnreadCount(0);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) { setExpired(true); return; }
      if (retry.attempts < MARK_READ_RETRIES) {
        retry.attempts += 1;
        retry.timer = setTimeout(() => { markRead(); }, MARK_READ_RETRY_MS * retry.attempts);
      } else {
        retry.attempts = 0;
      }
    }
  }, [userDir, reportId]);
  useEffect(() => () => clearTimeout(markReadRetryRef.current.timer), [userDir, reportId]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(''), COMMENTS_ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);

  return {
    threads, error, expired, viewer, capabilities, unreadCount, markRead,
    create, reply, setStatus,
    editThread, deleteThread, editReply, deleteReply,
  };
}

export default useArtifactComments;
