/**
 * Keep the wake-credential hold below the renderer’s earliest unseen-response reap (~13s).
 * Otherwise abort can silently strand the thinking placeholder. Cancel first so the user gets a
 * retryable error.
 * Token refresh retries continue after the request gate times out.
 */
export const MINDS_RESUME_READY_TIMEOUT_MS = 12_000;

interface ResumeCredentialGate {
  promise: Promise<boolean>;
  resolve: (ready: boolean) => void;
}

let _resumeCredentialGate: ResumeCredentialGate | null = null;
let _resumeCredentialBlocked = false;

export function isMindsResumeCredentialGateActive(): boolean {
  return _resumeCredentialBlocked;
}

/** Repeated calls share the first barrier so every waiter sees the same refresh/handoff outcome. */
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
 * Drop the barrier on sign-out. settle(false) leaves future requests blocked awaiting a credential;
 * that would also block direct-provider turns after the session is gone.
 */
export function resetMindsResumeCredentialGate(): void {
  const gate = _resumeCredentialGate;
  _resumeCredentialGate = null;
  _resumeCredentialBlocked = false;
  gate?.resolve(false);
}

/** On timeout, abort the renderer request locally instead of forwarding it with a stale credential. */
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
