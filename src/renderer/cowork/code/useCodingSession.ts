import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codingApi,
  openCodingEventStream,
  type CodingEvent,
  type CodingSession,
  type DiffFile,
  type GitState,
} from './api';


function sameSessionPayload(left: CodingSession | null, right: CodingSession): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}


export function useCodingSession(sessionId: string | null, active = true) {
  const [session, setSession] = useState<CodingSession | null>(null);
  const [events, setEvents] = useState<CodingEvent[]>([]);
  const [git, setGit] = useState<GitState | null>(null);
  const [diff, setDiff] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cursor = useRef(0);
  const pendingEvents = useRef<Map<number, CodingEvent>>(new Map());
  const liveFlushTimer = useRef<number | null>(null);
  const reviewScheduleTimer = useRef<number | null>(null);
  const requestedReviewId = useRef<string | null>(null);
  const reviewInFlight = useRef<Promise<void> | null>(null);
  const activeSessionId = useRef(sessionId);
  activeSessionId.current = sessionId;

  const applySession = useCallback((value: CodingSession) => {
    setSession((current) => sameSessionPayload(current, value) ? current : value);
  }, []);

  const flushEvents = useCallback((id: string) => {
    if (activeSessionId.current !== id) return;
    const ordered = [...pendingEvents.current.values()].sort((left, right) => left.seq - right.seq);
    pendingEvents.current.clear();
    if (!ordered.length) return;
    setEvents((current) => {
      const bySequence = new Map(current.map((event) => [event.seq, event]));
      for (const event of ordered) bySequence.set(event.seq, event);
      return [...bySequence.values()].sort((left, right) => left.seq - right.seq).slice(-6_000);
    });
  }, []);

  const ingestEvents = useCallback((id: string, incoming: CodingEvent[], nextSeq = 0, immediate = false) => {
    if (activeSessionId.current !== id) return;
    for (const event of incoming) pendingEvents.current.set(event.seq, event);
    const lastSeq = incoming.reduce((highest, event) => Math.max(highest, event.seq), 0);
    cursor.current = Math.max(cursor.current, lastSeq, nextSeq);
    if (immediate) {
      if (liveFlushTimer.current != null) window.clearTimeout(liveFlushTimer.current);
      liveFlushTimer.current = null;
      flushEvents(id);
      return;
    }
    if (liveFlushTimer.current != null) return;
    // Codex can emit several small deltas in one display frame. All transport
    // paths feed this same ordered buffer, so reconciliation can never render
    // a later frame ahead of an earlier live frame.
    liveFlushTimer.current = window.setTimeout(() => {
      liveFlushTimer.current = null;
      flushEvents(id);
    }, 16);
  }, [flushEvents]);

  const refreshReview = useCallback(async (id: string) => {
    requestedReviewId.current = id;
    if (reviewInFlight.current) return reviewInFlight.current;
    const run = async () => {
      while (requestedReviewId.current) {
        const requestedId = requestedReviewId.current;
        requestedReviewId.current = null;
        const [gitResult, diffResult] = await Promise.allSettled([
          codingApi.git(requestedId),
          codingApi.diff(requestedId),
        ]);
        if (activeSessionId.current !== requestedId) continue;
        if (gitResult.status === 'fulfilled') setGit(gitResult.value);
        if (diffResult.status === 'fulfilled') setDiff(diffResult.value.files);
      }
    };
    reviewInFlight.current = run().finally(() => { reviewInFlight.current = null; });
    return reviewInFlight.current;
  }, []);

  const scheduleReview = useCallback((id: string) => {
    requestedReviewId.current = id;
    if (reviewScheduleTimer.current != null) return;
    reviewScheduleTimer.current = window.setTimeout(() => {
      reviewScheduleTimer.current = null;
      void refreshReview(id);
    }, 150);
  }, [refreshReview]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const [sessionResult, eventResult] = await Promise.allSettled([
      codingApi.session(sessionId),
      codingApi.events(sessionId, cursor.current),
    ]);
    if (activeSessionId.current !== sessionId) return;
    if (sessionResult.status === 'fulfilled') applySession(sessionResult.value);
    if (eventResult.status === 'fulfilled') {
      ingestEvents(sessionId, eventResult.value.items, eventResult.value.next_seq, true);
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
  }, [applySession, ingestEvents, refreshReview, sessionId]);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return undefined;
    }
    setSession(null);
    setEvents([]);
    setGit(null);
    setDiff([]);
    setError('');
    cursor.current = 0;
    pendingEvents.current.clear();
    requestedReviewId.current = null;
    if (liveFlushTimer.current != null) {
      window.clearTimeout(liveFlushTimer.current);
      liveFlushTimer.current = null;
    }
    if (reviewScheduleTimer.current != null) {
      window.clearTimeout(reviewScheduleTimer.current);
      reviewScheduleTimer.current = null;
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
      ingestEvents(sessionId, page.items, page.next_seq, true);
    }).catch(() => {
      if (alive) setError('Task history is reconnecting…');
    }).finally(() => {
      if (!alive) return;
      closeStream = openCodingEventStream(
        sessionId,
        cursor.current,
        (event) => {
          if (!alive) return;
          setError('');
          ingestEvents(sessionId, [event]);
          if (event.type === 'session' || event.type === 'approval' || event.type === 'error' || event.type === 'command_result') {
            codingApi.session(sessionId).then((value) => { if (alive) applySession(value); }).catch(() => {});
          }
          if (event.type === 'file_change' || event.type === 'diff' || event.type === 'session') {
            scheduleReview(sessionId);
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
        if (sessionResult.status === 'fulfilled') applySession(sessionResult.value);
        if (eventResult.status === 'fulfilled') {
          const page = eventResult.value;
          ingestEvents(sessionId, page.items, page.next_seq, true);
          if (page.items.some((event) => event.type === 'file_change' || event.type === 'diff' || event.type === 'session')) {
            scheduleReview(sessionId);
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
      if (reviewScheduleTimer.current != null) {
        window.clearTimeout(reviewScheduleTimer.current);
        reviewScheduleTimer.current = null;
      }
      pendingEvents.current.clear();
      closeStream();
    };
  }, [active, applySession, ingestEvents, refreshReview, scheduleReview, sessionId]);

  return { session, events, git, diff, loading, error, refresh, refreshReview };
}
