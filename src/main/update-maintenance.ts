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
