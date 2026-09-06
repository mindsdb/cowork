import { AsyncLocalStorage } from 'async_hooks';

// A re-entrant queue lets compound stop/reinstall/start transactions share one lifecycle scope.
const activeLifecycle = new AsyncLocalStorage<boolean>();
let lifecycleTail: Promise<void> = Promise.resolve();

/**
 * Enter before the first async mutation and hold through verification/rollback.
 * Nested lifecycle calls run inline to avoid deadlocking on the same queue.
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
