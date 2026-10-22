/**
 * Whether to bring the backend back after its process exits.
 *
 * A backend that was up and then died without being asked to (a crash, the
 * OS killing it for memory, someone ending the process) comes back on its own
 * a moment later. Before this, nothing restarted it: the app looked fine until
 * the person's next action failed, and only the backend panel's Start fixed it.
 *
 * Not restarted: a stop the app asked for (quit, update, sign-out, the Stop
 * button), and a backend that never got as far as answering (that start has
 * already failed with its own diagnostics).
 */

/**
 * The wait before an automatic restart, by how many have already run within
 * AUTO_RESTART_WINDOW_MS: 1 s after the first death, 5 s if the restarted
 * backend came up and then died again, 15 s for the time after that. A death
 * after the third restart in the window leaves the backend down, so one that
 * keeps dying soon after it comes up isn't respawned forever.
 *
 * These are not retries. A restart that fails to bring the backend up is not
 * tried again: it fails the way a Start would, and the backend stays down until
 * it is started again.
 */
export const AUTO_RESTART_DELAYS_MS = [1_000, 5_000, 15_000] as const;
export const AUTO_RESTART_WINDOW_MS = 10 * 60_000;

export type AutoRestartDecision =
  | { action: 'restart'; delayMs: number }
  | { action: 'none'; reason: 'intentional' | 'not-up' | 'crash-loop' };

export function decideAutoRestart(input: {
  /** The exit was caused by a stop the app asked for. */
  intentional: boolean;
  /** The backend had answered /health and was serving when it exited. */
  wasRunning: boolean;
  /** When earlier automatic restarts were started, newest last. */
  recentRestarts: readonly number[];
  now: number;
}): AutoRestartDecision {
  if (input.intentional) return { action: 'none', reason: 'intentional' };
  if (!input.wasRunning) return { action: 'none', reason: 'not-up' };
  const recent = withinWindow(input.recentRestarts, input.now);
  if (recent.length >= AUTO_RESTART_DELAYS_MS.length) return { action: 'none', reason: 'crash-loop' };
  return { action: 'restart', delayMs: AUTO_RESTART_DELAYS_MS[recent.length] };
}

/** The restart times worth remembering after one at `at`: those still inside the window, and it. */
export function recentRestartsAfter(restarts: readonly number[], at: number): number[] {
  return [...withinWindow(restarts, at), at];
}

function withinWindow(restarts: readonly number[], now: number): number[] {
  return restarts.filter((at) => now - at < AUTO_RESTART_WINDOW_MS);
}
