// Writes that must reach disk before the process exits register here. The quit
// drain and the shell-update install both run them without importing the
// modules that own the writes.

type QuitFlush = () => Promise<void>;

export const QUIT_FLUSH_CEILING_MS = 2_000;

const flushes: QuitFlush[] = [];

export function registerQuitFlush(flush: QuitFlush): void {
  flushes.push(flush);
}

/** True when every registered flush settled within `timeoutMs`, false at the
 *  ceiling. Never rejects: a quit must not stall on a failed write. */
export async function runQuitFlushes(timeoutMs = QUIT_FLUSH_CEILING_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = Promise.allSettled(flushes.map((flush) => Promise.resolve().then(flush))).then(() => true);
  const ceiling = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([settled, ceiling]);
  } finally {
    clearTimeout(timer);
  }
}
