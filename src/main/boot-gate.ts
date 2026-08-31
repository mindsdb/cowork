// Boot-update gate (ENG-749). The renderer holds the loading screen until the
// boot sequence settles — the sidecar start decision plus the boot-time update
// poll — so a boot update that restarts the sidecar can't first flash the chat
// UI in a server-down "Connect a provider" state.

/**
 * Resolve once every boot barrier has settled — success or failure. Deliberately
 * has no wall-clock deadline: it tracks the poll's real completion, which is
 * bounded because every operation the poll runs has its own absolute timeout. A
 * rejected barrier is absorbed so a failed boot still releases the gate.
 */
export function awaitBootSettled(barriers: Array<Promise<unknown>>): Promise<void> {
  return Promise.allSettled(barriers).then(() => undefined);
}
