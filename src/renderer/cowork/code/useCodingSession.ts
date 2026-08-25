import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codingApi,
  openCodingEventStream,
  type CodingEvent,
  type CodingSession,
  type DiffFile,
  type GitState,
} from './api';


export function useCodingSession(sessionId: string | null) {
  const [session, setSession] = useState<CodingSession | null>(null);
  const [events, setEvents] = useState<CodingEvent[]>([]);
  const [git, setGit] = useState<GitState | null>(null);
  const [diff, setDiff] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cursor = useRef(0);
  const liveBuffer = useRef<CodingEvent[]>([]);
  const liveFlushTimer = useRef<number | null>(null);
  const activeSessionId = useRef(sessionId);
  activeSessionId.current = sessionId;

  const mergeEvents = useCallback((id: string, incoming: CodingEvent[], nextSeq?: number) => {
    if (activeSessionId.current !== id) return;
    const ordered = [...incoming]
      .filter((event) => event.seq > cursor.current)
      .sort((left, right) => left.seq - right.seq);
    const lastSeq = ordered.at(-1)?.seq;
    cursor.current = Math.max(cursor.current, lastSeq || 0, nextSeq || 0);
    if (!ordered.length) return;
    setEvents((current) => [...current, ...ordered].slice(-6_000));
  }, []);

  const queueLiveEvent = useCallback((id: string, event: CodingEvent) => {
    if (activeSessionId.current !== id || event.seq <= cursor.current) return;
    cursor.current = event.seq;
    liveBuffer.current.push(event);
    if (liveFlushTimer.current != null) return;
    // Codex can emit several small deltas in one display frame. Rendering
    // each one independently makes the growing Markdown transcript compete
    // with the composer for the renderer's main thread. Coalesce them into
    // one state update per frame while preserving every persisted event.
    liveFlushTimer.current = window.setTimeout(() => {
      liveFlushTimer.current = null;
      if (activeSessionId.current !== id) {
        liveBuffer.current = [];
        return;
      }
      const buffered = liveBuffer.current;
      liveBuffer.current = [];
      if (!buffered.length) return;
      buffered.sort((left, right) => left.seq - right.seq);
      setEvents((current) => [...current, ...buffered].slice(-6_000));
    }, 16);
  }, []);

  const refreshReview = useCallback(async (id: string) => {
    const [gitResult, diffResult] = await Promise.allSettled([codingApi.git(id), codingApi.diff(id)]);
    if (activeSessionId.current !== id) return;
    if (gitResult.status === 'fulfilled') setGit(gitResult.value);
    if (diffResult.status === 'fulfilled') setDiff(diffResult.value.files);
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const [sessionResult, eventResult] = await Promise.allSettled([
      codingApi.session(sessionId),
      codingApi.events(sessionId, cursor.current),
    ]);
    if (activeSessionId.current !== sessionId) return;
    if (sessionResult.status === 'fulfilled') setSession(sessionResult.value);
    if (eventResult.status === 'fulfilled') {
      mergeEvents(sessionId, eventResult.value.items, eventResult.value.next_seq);
    }
    if (sessionResult.status === 'rejected' && eventResult.status === 'rejected') {
      setError(sessionResult.reason instanceof Error ? sessionResult.reason.message : 'Could not refresh this coding task.');
    } else {
      setError('');
    }
    // Git inspection is supplementary review data. Never hold task actions,
    // approvals, or the composer hostage to a potentially expensive worktree
    // scan; update it progressively instead.
    void refreshReview(sessionId);
  }, [mergeEvents, refreshReview, sessionId]);

  useEffect(() => {
    setSession(null);
    setEvents([]);
    setGit(null);
    setDiff([]);
    setError('');
    cursor.current = 0;
    liveBuffer.current = [];
    if (liveFlushTimer.current != null) {
      window.clearTimeout(liveFlushTimer.current);
      liveFlushTimer.current = null;
    }
    if (!sessionId) return undefined;

    let alive = true;
    let closeStream = () => {};
    setLoading(true);
    codingApi.session(sessionId).then((value) => {
      if (!alive) return;
      setSession(value);
      setError('');
    }).catch((reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : 'Could not load this coding task.');
    }).finally(() => {
      if (alive) setLoading(false);
    });

    codingApi.events(sessionId).then((page) => {
      if (!alive) return;
      mergeEvents(sessionId, page.items, page.next_seq);
    }).catch(() => {
      if (alive) setError('Task history is reconnecting…');
    }).finally(() => {
      if (!alive) return;
      closeStream = openCodingEventStream(
        sessionId,
        cursor.current,
        (event) => {
          if (!alive || event.seq <= cursor.current) return;
          setError('');
          queueLiveEvent(sessionId, event);
          if (event.type === 'session' || event.type === 'approval' || event.type === 'error') {
            codingApi.session(sessionId).then((value) => { if (alive) setSession(value); }).catch(() => {});
          }
          if (event.type === 'file_change' || event.type === 'diff' || event.type === 'session') {
            refreshReview(sessionId).catch(() => {});
          }
        },
        () => { if (alive) setError('Live updates disconnected. Reconnecting…'); },
      );
    });
    // Review data is useful as soon as it is available, but it is never a
    // prerequisite for restoring the conversation or accepting input.
    void refreshReview(sessionId);

    const reconcile = window.setInterval(() => {
      Promise.allSettled([
        codingApi.session(sessionId),
        codingApi.events(sessionId, cursor.current),
      ]).then(([sessionResult, eventResult]) => {
        if (!alive) return;
        if (sessionResult.status === 'fulfilled') setSession(sessionResult.value);
        if (eventResult.status === 'fulfilled') {
          const page = eventResult.value;
          mergeEvents(sessionId, page.items, page.next_seq);
          if (page.items.some((event) => event.type === 'file_change' || event.type === 'diff' || event.type === 'session')) {
            refreshReview(sessionId).catch(() => {});
          }
        }
        if (sessionResult.status === 'fulfilled' || eventResult.status === 'fulfilled') setError('');
      });
    }, 2_500);
    return () => {
      alive = false;
      window.clearInterval(reconcile);
      if (liveFlushTimer.current != null) {
        window.clearTimeout(liveFlushTimer.current);
        liveFlushTimer.current = null;
      }
      liveBuffer.current = [];
      closeStream();
    };
  }, [mergeEvents, queueLiveEvent, refreshReview, sessionId]);

  return { session, events, git, diff, loading, error, refresh, refreshReview };
}
