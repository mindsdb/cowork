import { useEffect, useRef, useState } from 'react';

import { codingApi, type CodingSession } from './api';
import { isActiveStatus } from './presentation';


/** Resume a persisted queue after a desktop restart without racing live turns.
 * The server owns normal queue progression; this hook is only the reconnecting
 * safety net, with bounded backoff for transient local/API failures. */
export function useQueuedInstructionResume(
  session: CodingSession | null,
  refresh: () => Promise<void>,
  onError: (message: string) => void,
) {
  const attempt = useRef({ key: '', failures: 0, inFlight: false });
  const [retryTick, setRetryTick] = useState(0);
  const queuedInstructionId = session?.queued_instructions?.[0]?.id;

  useEffect(() => {
    if (!session || !queuedInstructionId || isActiveStatus(session.status)) {
      if (!queuedInstructionId) attempt.current = { key: '', failures: 0, inFlight: false };
      return undefined;
    }
    const key = `${session.id}:${queuedInstructionId}`;
    if (attempt.current.key !== key) {
      attempt.current = { key, failures: 0, inFlight: false };
    }
    if (attempt.current.inFlight) return undefined;
    attempt.current.inFlight = true;

    let alive = true;
    let retryTimer: number | undefined;
    codingApi.runQueued(session.id)
      .then(() => {
        if (!alive) return;
        attempt.current = { key: '', failures: 0, inFlight: false };
        return refresh();
      })
      .catch((reason) => {
        if (!alive) return;
        onError(reason instanceof Error ? reason.message : 'Could not resume the queued instruction.');
        const failures = attempt.current.key === key ? attempt.current.failures + 1 : 1;
        attempt.current = { key, failures, inFlight: true };
        retryTimer = window.setTimeout(() => {
          if (attempt.current.key === key) attempt.current.inFlight = false;
          setRetryTick((value) => value + 1);
        }, Math.min(30_000, 1_000 * (2 ** (failures - 1))));
      });

    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
      if (attempt.current.key === key) attempt.current.inFlight = false;
    };
  }, [onError, queuedInstructionId, refresh, retryTick, session?.id, session?.status]);
}
