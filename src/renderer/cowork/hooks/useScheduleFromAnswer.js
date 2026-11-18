import { useCallback, useRef, useState } from 'react';
import { createScheduleForAnswer } from '../lib/scheduledAnswers';

/**
 * Saves the schedule made from an answer's "Run this on a schedule" step,
 * one at a time. A second submit while one is out (a double click on
 * Schedule or "Save and run once") gets the same pending result instead of
 * creating a second schedule. The guard is a ref, set before the create
 * call, so even a submit that lands before the re-render is caught; `busy`
 * drives the form's disabled, saving state. A failed create releases it, so
 * the person can retry.
 *
 * @param {object} options
 * @param {(payload: object) => Promise<{ id?: string } | undefined>} options.create
 * @param {(id: string) => Promise<unknown>} options.runNow The trial run.
 * @param {(payload: object, created: unknown) => void} [options.onSaved]
 * @param {(payload: object, error: unknown) => void} [options.onRunFailed]
 */
export function useScheduleFromAnswer({ create, runNow, onSaved, onRunFailed }) {
  const pendingRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback((payload, answerKey, { runOnce = false } = {}) => {
    if (pendingRef.current) return pendingRef.current;
    const run = (async () => {
      try {
        const created = await createScheduleForAnswer(create, payload, answerKey);
        onSaved?.(payload, created);
        if (runOnce && created?.id) {
          // Saved already: a failed trial run must not fail the save.
          try {
            await runNow(created.id);
          } catch (err) {
            onRunFailed?.(payload, err);
          }
        }
        return created;
      } finally {
        pendingRef.current = null;
        setBusy(false);
      }
    })();
    pendingRef.current = run;
    setBusy(true);
    return run;
  }, [create, runNow, onSaved, onRunFailed]);

  return { submit, busy };
}
