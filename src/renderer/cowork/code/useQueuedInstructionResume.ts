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
  const attempts = useRef(new Map<string, { failures: number; retryDue: boolean; settled: boolean }>());
  const currentKey = useRef('');
  const [retryTick, setRetryTick] = useState(0);
  const queuedInstructionId = session?.queued_instructions?.[0]?.id;
  currentKey.current = session && queuedInstructionId ? `${session.id}:${queuedInstructionId}` : '';

  useEffect(() => {
    const key = currentKey.current;
    for (const [known, entry] of attempts.current) {
      if (entry.settled && (!session || !known.startsWith(`${session.id}:`))) attempts.current.delete(known);
    }
    if (!session || !key || isActiveStatus(session.status)) return;
    const attempt = attempts.current.get(key);
    if (attempt && !attempt.retryDue) return;
    const entry = { failures: attempt?.failures || 0, retryDue: false, settled: false };
    attempts.current.set(key, entry);

    const settle = () => {
      entry.settled = true;
      if (currentKey.current === key) void refresh();
    };
    codingApi.runQueued(session.id, queuedInstructionId).then(
      settle,
      (reason) => {
        if (attempts.current.get(key) !== entry) return;
        if ((reason as { status?: number }).status === 409) {
          settle();
          return;
        }
        entry.failures += 1;
        if (currentKey.current === key) {
          onError(reason instanceof Error ? reason.message : 'Could not resume the queued instruction.');
        }
        window.setTimeout(() => {
          if (attempts.current.get(key) !== entry) return;
          entry.retryDue = true;
          entry.settled = true;
          if (currentKey.current === key) setRetryTick((value) => value + 1);
        }, Math.min(30_000, 1_000 * (2 ** (entry.failures - 1))));
      },
    );
  }, [onError, queuedInstructionId, refresh, retryTick, session?.id, session?.status]);
}
