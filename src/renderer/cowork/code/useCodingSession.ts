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

  const refreshReview = useCallback(async (id: string) => {
    const [gitResult, diffResult] = await Promise.allSettled([codingApi.git(id), codingApi.diff(id)]);
    if (activeSessionId.current !== id) return;
    if (gitResult.status === 'fulfilled') setGit(gitResult.value);
    if (diffResult.status === 'fulfilled') setDiff(diffResult.value.files);
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const [sessionResult, eventResult, gitResult, diffResult] = await Promise.allSettled([
      codingApi.session(sessionId),
      codingApi.events(sessionId, cursor.current),
      codingApi.git(sessionId),
      codingApi.diff(sessionId),
    ]);
    if (activeSessionId.current !== sessionId) return;
    if (sessionResult.status === 'fulfilled') setSession(sessionResult.value);
    if (eventResult.status === 'fulfilled') {
      mergeEvents(sessionId, eventResult.value.items, eventResult.value.next_seq);
    }
    if (gitResult.status === 'fulfilled') setGit(gitResult.value);
    if (diffResult.status === 'fulfilled') setDiff(diffResult.value.files);
    if (sessionResult.status === 'rejected' && eventResult.status === 'rejected') {
      setError(sessionResult.reason instanceof Error ? sessionResult.reason.message : 'Could not refresh this coding task.');
    } else {
      setError('');
    }
  }, [mergeEvents, sessionId]);

  useEffect(() => {
    setSession(null);
    setEvents([]);
    setGit(null);
    setDiff([]);
    setError('');
    cursor.current = 0;
    if (!sessionId) return undefined;

    let alive = true;
    let closeStream = () => {};
    setLoading(true);
    Promise.allSettled([
      codingApi.session(sessionId),
      codingApi.events(sessionId),
      codingApi.git(sessionId),
      codingApi.diff(sessionId),
    ]).then(([sessionResult, eventResult, gitResult, diffResult]) => {
      if (!alive) return;
      if (sessionResult.status === 'fulfilled') setSession(sessionResult.value);
      if (eventResult.status === 'fulfilled') {
        mergeEvents(sessionId, eventResult.value.items, eventResult.value.next_seq);
      }
      if (gitResult.status === 'fulfilled') setGit(gitResult.value);
      if (diffResult.status === 'fulfilled') setDiff(diffResult.value.files);
      if (sessionResult.status === 'rejected') {
        setError(sessionResult.reason instanceof Error ? sessionResult.reason.message : 'Could not load this coding task.');
      } else if (eventResult.status === 'rejected') {
        setError('Task history is reconnecting…');
      }
      closeStream = openCodingEventStream(
        sessionId,
        cursor.current,
        (event) => {
          if (!alive || event.seq <= cursor.current) return;
          setError('');
          mergeEvents(sessionId, [event], event.seq);
          if (event.type === 'session' || event.type === 'approval' || event.type === 'error') {
            codingApi.session(sessionId).then((value) => { if (alive) setSession(value); }).catch(() => {});
          }
          if (event.type === 'file_change' || event.type === 'diff' || event.type === 'session') {
            refreshReview(sessionId).catch(() => {});
          }
        },
        () => { if (alive) setError('Live updates disconnected. Reconnecting…'); },
      );
    }).finally(() => { if (alive) setLoading(false); });

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
      closeStream();
    };
  }, [mergeEvents, refreshReview, sessionId]);

  return { session, events, git, diff, loading, error, refresh, refreshReview };
}
