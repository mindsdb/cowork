// Boot-update gate (ENG-749).
//
// The renderer holds the loading screen until the boot sequence settles: the
// sidecar start decision plus the boot-time update poll. A boot server update
// stops the sidecar, reinstalls it, and restarts it — during which the server is
// down — so the gate must stay closed until that finishes, or it flashes the
// chat UI in a "Connect a provider" state.
//
// The gate resolves on the boot poll's ACTUAL completion — there is deliberately
// no wall-clock budget racing the work. An earlier version raced a guessed
// budget (2× reinstall + 2× restart + slack); that both duplicated the operation
// caps and omitted phases (detection, version checks, shutdown, PyPI metadata,
// restart preflight/cleanup), so a slow primary attempt + rollback could still
// be running when the timer fired and released the gate mid-reinstall.
//
// Boundedness is instead guaranteed at the operation sites: every network or
// subprocess step the poll runs has its own timeout —
//   hasInternet 5s, fetchManifest / lsRemote / getInstalledVersion 10s,
//   PyPI metadata 5s, runUv reinstall 180s, startServer SERVER_START_CAP 180s,
//   UI download 60s, UI reload health 15s
// — and `initUpdater`'s boot poll always reaches its `finally` (its awaits are
// individually `.catch`-guarded). So the barrier cannot hang while a step runs,
// and cannot open before the full sequence (attempt + any rollback) completes.

/**
 * Resolve once every boot barrier has settled — success or failure — and never
 * before. Rejections are absorbed (a failed boot must still release the gate,
 * never trap the loading screen) and it never rejects.
 *
 * No internal deadline: the release tracks the orchestration's real completion,
 * which is bounded by each operation's own timeout (see file header).
 */
export function awaitBootSettled(barriers: Array<Promise<unknown>>): Promise<void> {
  return Promise.allSettled(barriers).then(() => undefined);
}
