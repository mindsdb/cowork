let maintenanceTail: Promise<void> = Promise.resolve();

/**
 * Serialize update operations that mutate local application/server state.
 * Checks and downloads stay concurrent; UI/server apply and shell installation
 * enter this short shared gate so they cannot race each other.
 */
export function withUpdateMaintenance<T>(operation: () => Promise<T> | T): Promise<T> {
  const run = maintenanceTail.then(operation, operation);
  maintenanceTail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Resolve once every update-maintenance operation queued so far has settled.
 * Operations submitted after this call are not awaited.
 *
 * The quit path uses this before letting the process terminate: an auto-mode
 * shell update installs on quit via electron-updater's `autoInstallOnAppQuit`
 * (Windows installs in the `quit` handler; macOS stages via Squirrel and swaps
 * the bundle on termination), entirely outside this gate. Draining the gate
 * first guarantees an in-flight UI/server apply finishes before the installer's
 * file swap runs, so the two cannot overlap. Never rejects — a failed operation
 * still counts as drained.
 */
export function awaitUpdateMaintenanceIdle(): Promise<void> {
  return maintenanceTail.then(() => undefined, () => undefined);
}
