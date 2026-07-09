import { AsyncLocalStorage } from 'async_hooks';

// All local server lifecycle mutations share one queue. This is deliberately
// re-entrant: a recovery/update transaction may stop, reinstall, and restart
// the server without queueing behind itself.
const activeLifecycle = new AsyncLocalStorage<boolean>();
let lifecycleTail: Promise<void> = Promise.resolve();

/**
 * Serialize a complete server lifecycle transition.
 *
 * The caller must enter before its first async step that can lead to a venv
 * mutation or process transition, and retain the scope through verification
 * and rollback. Calls made inside an active scope run immediately, so compound
 * operations can safely call the public start/stop helpers.
 */
export async function withServerLifecycle<T>(fn: () => Promise<T>): Promise<T> {
  if (activeLifecycle.getStore()) return fn();

  const previous = lifecycleTail;
  let release!: () => void;
  lifecycleTail = new Promise<void>((resolve) => { release = resolve; });

  await previous;
  try {
    return await activeLifecycle.run(true, fn);
  } finally {
    release();
  }
}
