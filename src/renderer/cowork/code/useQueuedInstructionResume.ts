import { useEffect, useRef, useState } from 'react';

import { codingApi, type CodingSession } from './api';
import { isActiveStatus } from './presentation';


/** Resume a persisted queue after a desktop restart without racing live turns.
 * The server owns normal queue progression; this hook is only the reconnecting
 * safety net, with bounded backoff for transient local/API failures. Each
 * queued instruction is sent at most once until its retry is due. */
export function useQueuedInstructionResume(
  session: CodingSession | null,
  refresh: () => Promise<void>,
  onError: (message: string) => void,
) {
  const attempts = useRef(new Map<string, { failures: number; retryDue: boolean }>());
  const currentKey = useRef('');
  const [retryTick, setRetryTick] = useState(0);
  const queuedInstructionId = session?.queued_instructions?.[0]?.id;
  currentKey.current = session && queuedInstructionId ? `${session.id}:${queuedInstructionId}` : '';

  useEffect(() => {
    const key = currentKey.current;
    if (!session || !key || isActiveStatus(session.status)) return;
    const attempt = attempts.current.get(key);
    if (attempt && !attempt.retryDue) return;
    attempts.current.set(key, { failures: attempt?.failures || 0, retryDue: false });

    codingApi.runQueued(session.id).then(
      () => { if (currentKey.current === key) void refresh(); },
      (reason) => {
        const failures = (attempts.current.get(key)?.failures || 0) + 1;
        attempts.current.set(key, { failures, retryDue: false });
        if (currentKey.current === key) {
          onError(reason instanceof Error ? reason.message : 'Could not resume the queued instruction.');
        }
        window.setTimeout(() => {
          attempts.current.set(key, { failures, retryDue: true });
          if (currentKey.current === key) setRetryTick((value) => value + 1);
        }, Math.min(30_000, 1_000 * (2 ** (failures - 1))));
      },
    );
  }, [onError, queuedInstructionId, refresh, retryTick, session?.id, session?.status]);
}
