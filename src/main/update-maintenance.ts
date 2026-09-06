let maintenanceTail: Promise<void> = Promise.resolve();

/** Serialize UI/server apply and shell installation; checks and downloads remain concurrent. */
export function withUpdateMaintenance<T>(operation: () => Promise<T> | T): Promise<T> {
  const run = maintenanceTail.then(operation, operation);
  maintenanceTail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Await operations already queued, including failures; later work is not included.
 * Quit drains this gate before shell installation swaps files outside it.
 */
export function awaitUpdateMaintenanceIdle(): Promise<void> {
  return maintenanceTail.then(() => undefined, () => undefined);
}
