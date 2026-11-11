// Writes that must reach disk before the process exits register here. The quit
// drain and the shell-update install both run them without importing the
// modules that own the writes.

type QuitFlush = () => Promise<void>;
/** Stops a source of new writes and returns the function that restarts it. */
type QuitHold = () => () => void;

export const QUIT_FLUSH_CEILING_MS = 2_000;

const flushes: QuitFlush[] = [];
const holds: QuitHold[] = [];

export function registerQuitFlush(flush: QuitFlush): void {
  flushes.push(flush);
}

export function registerQuitHold(hold: QuitHold): void {
  holds.push(hold);
}

/** Stops every registered write source, so nothing new is queued after the
 *  flush. The returned function restarts them for an exit that did not happen. */
export function holdQuitWriters(): () => void {
  const resumes = holds.map((hold) => hold());
  return () => { for (const resume of resumes) resume(); };
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
