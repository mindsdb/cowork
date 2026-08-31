export const MINDS_RESUME_READY_TIMEOUT_MS = 25_000;

interface ResumeCredentialGate {
  promise: Promise<boolean>;
  resolve: (ready: boolean) => void;
}

let _resumeCredentialGate: ResumeCredentialGate | null = null;
let _resumeCredentialBlocked = false;

export function isMindsResumeCredentialGateActive(): boolean {
  return _resumeCredentialBlocked;
}

/**
 * Hold response creation while a wake-up refresh replaces the credential that
 * may have expired during sleep. Calling this twice keeps the first barrier:
 * every waiter must observe the same refresh/handoff outcome.
 */
export function beginMindsResumeCredentialGate(): void {
  _resumeCredentialBlocked = true;
  if (_resumeCredentialGate) return;
  let resolve!: (ready: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  _resumeCredentialGate = { promise, resolve };
}

/** Release response creation after the sidecar has accepted the replacement. */
export function settleMindsResumeCredentialGate(ready: boolean): void {
  if (!_resumeCredentialBlocked && !_resumeCredentialGate) return;
  const gate = _resumeCredentialGate;
  _resumeCredentialGate = null;
  _resumeCredentialBlocked = !ready;
  gate?.resolve(ready);
}

/**
 * Wait for the wake-up refresh without hanging a renderer request forever.
 * A timeout means the caller must abort locally rather than forward a turn
 * behind the credential known to be stale.
 */
export async function waitForMindsResumeCredential(
  timeoutMs = MINDS_RESUME_READY_TIMEOUT_MS,
): Promise<boolean> {
  const gate = _resumeCredentialGate;
  if (!gate) return !_resumeCredentialBlocked;
  if (timeoutMs <= 0) return false;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      gate.promise,
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
