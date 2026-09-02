/**
 * How long response creation may be held while a wake refresh replaces the
 * credential that expired during sleep.
 *
 * The ceiling comes from the RENDERER, not from the refresh. `startConversation`
 * reserves the stream slot before the POST leaves, and `reconcileInFlight`
 * releases a reservation the server never reported after `unseenThreshold` (4)
 * unseen polls on a 5-second heartbeat. That release calls `ctrl.abort()`, and
 * `_streamResponse` swallows `AbortError` without calling `onError`, so a hold
 * that outlives the reap loses the user's message with the thinking placeholder
 * still on screen. The earliest reap is around 13 seconds, so stay under it: a
 * gate that gives up first cancels the request outright, which surfaces as a
 * real error the user can retry rather than a task stuck "active" forever.
 *
 * The trade-off is deliberate. A wake refresh slower than this bound now fails
 * fast instead of waiting, because it cannot win the race against the reap
 * either way. `scheduleRefreshRetry` keeps retrying underneath, so the next
 * message goes out on the refreshed credential.
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
 * Drop the barrier entirely, whether or not one is armed.
 *
 * `settleMindsResumeCredentialGate(false)` leaves `_resumeCredentialBlocked`
 * true with no gate promise, so every later `waitForMindsResumeCredential`
 * returns false immediately and response creation is cancelled indefinitely.
 * That is correct while a session still expects a credential to arrive. It is
 * wrong after sign-out: there is no resumed credential to wait for, nothing in
 * the signed-out state can call `settle(true)`, and a user who signs out and
 * then configures a direct provider would never start another turn.
 */
export function resetMindsResumeCredentialGate(): void {
  const gate = _resumeCredentialGate;
  _resumeCredentialGate = null;
  _resumeCredentialBlocked = false;
  gate?.resolve(false);
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
