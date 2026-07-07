// Shared artifact-comments state: initial load + realtime SSE (reconnect with
// backoff, terminal 401/403 stops), and create / reply / status mutations.
//
// Lifted out of CommentsPanel so a single instance can back BOTH the sidebar
// list and the on-artifact marker layer bridge (ArtifactCommentLayer) — one
// stream, one source of truth. Talks only to cowork-server, which attaches the
// user's MindsHub creds and proxies to the inference backend.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addCommentReply,
  createCommentThread,
  listCommentThreads,
  openCommentsStream,
  setCommentThreadStatus,
} from '../../api';
import { maxUpdatedAt, upsertThread } from '../../lib/commentsReducer';

export function useArtifactComments(userDir, reportId, { enabled = true } = {}) {
  const [threads, setThreads] = useState([]);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const threadsRef = useRef([]);
  threadsRef.current = threads;

  const apply = useCallback((event) => {
    setThreads((prev) => upsertThread(prev, event));
  }, []);

  // Initial load, then subscribe from the max updated_at (closes the gap).
  // Reconnect on any drop with the latest `since`, capped backoff; a terminal
  // 401/403 stops for good (session expired) instead of hammering the server.
  useEffect(() => {
    // The hook lives at the viewer level (not the short-lived panel), so a
    // change of artifact (userDir/reportId) or disabling must drop the previous
    // artifact's threads/error/expired — otherwise stale threads would draw
    // markers on, and a stale banner would show over, the new artifact.
    setThreads([]);
    setError('');
    setExpired(false);
    if (!enabled || !userDir || !reportId) return undefined;
    let cancelled = false;
    let ctrl = null;
    let retryTimer = null;
    let attempts = 0;

    const connect = (since) => {
      if (cancelled) return;
      ctrl = openCommentsStream(userDir, reportId, since, {
        onEvent: (ev) => { attempts = 0; apply(ev); },
        onExpired: () => setExpired(true), // terminal — no reconnect
        onError: () => {
          if (cancelled) return;
          const delay = Math.min(30000, 1000 * 2 ** attempts);
          attempts += 1;
          retryTimer = setTimeout(() => connect(maxUpdatedAt(threadsRef.current)), delay);
        },
      });
    };

    listCommentThreads(userDir, reportId, 'all')
      .then((data) => {
        if (cancelled) return;
        const loaded = (data && data.threads) || [];
        setThreads(loaded);
        connect(maxUpdatedAt(loaded));
      })
      .catch((e) => !cancelled && setError(e.message || 'Failed to load comments'));

    return () => {
      cancelled = true;
      if (ctrl) ctrl.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, userDir, reportId, apply]);

  const create = useCallback(async ({ selector = null, text }) => {
    if (!text || !text.trim()) return;
    try {
      const created = await createCommentThread(userDir, reportId, { selector, text: text.trim() });
      apply({ ...created, type: created.type || 'thread.created' });
    } catch (e) {
      setError(e.message || 'Failed to post');
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

  return { threads, error, expired, create, reply, setStatus };
}

export default useArtifactComments;
