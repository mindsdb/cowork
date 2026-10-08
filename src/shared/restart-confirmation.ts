// A restart that stops the sidecar ends every running turn (ENG-3291). Before
// main does that on a user's click, it reports how many tasks are running and
// lets the renderer ask. This is the shape of that report and the copy the
// renderer shows for it. Shared so the main-process handlers and the renderer
// guard agree on one contract.

export interface RestartConfirmation {
  confirm: true;
  /** Running tasks, or null when the sidecar did not answer in time. */
  runningTasks: number | null;
}

/** What a restart request resolves to: the legacy boolean (installed or
 *  applied, or not), a request to confirm first, or `'stale'` when the action
 *  the renderer clicked is no longer what the current state offers (nothing
 *  ran; re-render from the fresh state). Old shells only ever return the
 *  boolean, so callers must treat a non-object as the old contract. */
export type RestartRequestResult = boolean | RestartConfirmation | 'stale';

export function needsRestartConfirmation(result: unknown): result is RestartConfirmation {
  return typeof result === 'object' && result !== null && (result as { confirm?: unknown }).confirm === true;
}

export interface RestartConfirmationCopy {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** The dialog copy. One running task is named in the singular; an unknown
 *  count says so instead of guessing. */
export function restartConfirmationCopy(runningTasks: number | null): RestartConfirmationCopy {
  const confirmLabel = 'Restart anyway';
  const cancelLabel = 'Cancel';
  if (runningTasks === null) {
    return {
      title: 'Restart now?',
      body: 'Cowork cannot tell whether any tasks are running. Restarting stops every running task.',
      confirmLabel,
      cancelLabel,
    };
  }
  const noun = runningTasks === 1 ? 'running task' : 'running tasks';
  return {
    title: `Stop ${runningTasks} ${noun} and restart?`,
    body: 'Restarting stops the tasks mid-answer. You can restart later from Settings or the update banner.',
    confirmLabel,
    cancelLabel,
  };
}
