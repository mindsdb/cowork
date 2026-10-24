import {
  needsRestartConfirmation,
  type RestartConfirmation,
  type RestartRequestResult,
} from '../../shared/restart-confirmation';

// The renderer side of the restart confirmation (ENG-3291).
//
// Main answers an install or apply request with either the legacy boolean or a
// `{ confirm, runningTasks }` report. `guardRestart` turns that two-step
// exchange back into one boolean for every caller: it asks the mounted dialog,
// and re-sends the request with `force` only after the person confirms. It
// lives in the platform layer so every restart button inherits it through
// `host.installShellAutoUpdate` / `host.applyUpdate`, including buttons added
// later, rather than each one wiring its own dialog.
//
// The dialog itself is React (RestartConfirmHost, mounted once in App.tsx).
// This module only carries the pending question to it and the answer back.

export interface PendingRestartConfirmation extends RestartConfirmation {
  resolve: (confirmed: boolean) => void;
}

type Listener = (pending: PendingRestartConfirmation | null) => void;

let pending: PendingRestartConfirmation | null = null;
const listeners = new Set<Listener>();

function publish(): void {
  listeners.forEach(listener => listener(pending));
}

/** Listen for the pending question. Called at once with the current state. */
export function subscribeRestartConfirmation(listener: Listener): () => void {
  listeners.add(listener);
  listener(pending);
  return () => { listeners.delete(listener); };
}

/** Ask the person. Resolves false when nothing is mounted to ask: a restart
 *  that cannot be confirmed does not happen. A second question while one is
 *  open is answered no as well, so two buttons cannot race into one restart. */
export function confirmRestart(report: RestartConfirmation): Promise<boolean> {
  if (listeners.size === 0 || pending) return Promise.resolve(false);
  return new Promise<boolean>(resolve => {
    pending = {
      ...report,
      resolve(confirmed) {
        if (pending?.resolve !== this.resolve) return;
        pending = null;
        publish();
        resolve(confirmed);
      },
    };
    publish();
  });
}

/** `'cancelled'` and `'stale'` are not failures: callers that show an error on
 *  `false` must not show one for them. */
export type GuardedRestartResult = boolean | 'cancelled' | 'stale';

/** Run a restart request through the confirmation. `invoke` sends the request
 *  to main; it is called again with `force` after a yes. Boolean answers pass
 *  straight through, which is also what every shell before this contract
 *  returns. */
export async function guardRestart(
  invoke: (options: { force?: boolean }) => Promise<RestartRequestResult>,
  hooks: {
    /** Called once the person has said yes, right before the forced request.
     *  A caller that shows progress for the restart starts it here, not
     *  before the first request, so the dialog never opens over a banner
     *  that already says the update is being applied. */
    onProceed?: () => void;
  } = {},
): Promise<GuardedRestartResult> {
  const first = await invoke({});
  if (first === 'stale') return 'stale';
  if (!needsRestartConfirmation(first)) return Boolean(first);
  const confirmed = await confirmRestart(first);
  if (!confirmed) return 'cancelled';
  hooks.onProceed?.();
  const second = await invoke({ force: true });
  if (second === 'stale') return 'stale';
  // Main does not ask twice when forced; a report here means an older shell
  // that ignores `force`, and the safe reading of that is "not restarted".
  return needsRestartConfirmation(second) ? false : Boolean(second);
}

/** Test seam: drop any pending question. */
export function resetRestartConfirmationForTests(): void {
  pending = null;
  listeners.clear();
}
