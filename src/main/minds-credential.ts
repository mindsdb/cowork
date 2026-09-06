// Push session or user-supplied credentials over loopback; the sidecar holds them only in memory.
// Re-push after every sidecar start via setServerStartedHook, and after sign-in or token refresh.
// Read tokens from the store rather than importing minds-auth, which would create a cycle.

import { getAccessToken, getRefreshToken, isAccessTokenExpired } from './token-store';
import { getServerPort, isServerRunning, isServerStarting } from './server-process';
import { authHeader } from './server-auth';
import { getMindsApiKey, setMindsApiKey, deleteMindsApiKey } from './keychain-service';
import { settleMindsResumeCredentialGate } from './minds-resume-gate';

const PUSH_TIMEOUT_MS = 10_000;

interface ResolvedMindsCredential {
  value: string | null;
  userSupplied: boolean;
  usable: boolean;
}

async function resolveMindsCredentialSelection(): Promise<ResolvedMindsCredential> {
  try {
    const supplied = await getMindsApiKey();
    if (supplied) return { value: supplied, userSupplied: true, usable: true };
  } catch (error) {
    // If both keychain stores fail, fall back to the signed-in session credential.
    console.warn('[minds-credential] could not read the stored key', error);
  }
  const accessToken = getAccessToken();
  return {
    value: accessToken,
    userSupplied: false,
    usable: Boolean(accessToken) && !isAccessTokenExpired(),
  };
}

/** A user-supplied key takes precedence over the session credential. */
export async function resolveMindsCredential(): Promise<string | null> {
  return (await resolveMindsCredentialSelection()).value;
}

/** Whether the selected credential is independent of the Keycloak session. */
export async function hasUserSuppliedMindsCredential(): Promise<boolean> {
  return (await resolveMindsCredentialSelection()).userSupplied;
}

// Serialize PUTs so a late request cannot restore a credential replaced by refresh or sign-out.
let _credentialPushTail: Promise<void> = Promise.resolve();

function enqueueCredentialPush<T>(operation: () => Promise<T>): Promise<T> {
  const queued = _credentialPushTail.then(operation);
  _credentialPushTail = queued.then(() => undefined, () => undefined);
  return queued;
}

/**
 * Push or clear the credential. Report whether it landed so callers do not claim readiness
 * prematurely.
 */
export function pushMindsCredential(value: string | null): Promise<boolean> {
  return enqueueCredentialPush(() => pushMindsCredentialNow(value));
}

/**
 * Distinguish an absent sidecar from a refused push; only the latter needs a timed retry.
 * The start hook handles credentials once a sidecar becomes available.
 */
export function isMindsCredentialSidecarReachable(): boolean {
  return isServerRunning() || isServerStarting();
}

async function pushMindsCredentialNow(value: string | null): Promise<boolean> {
  if (!isServerRunning() && !isServerStarting()) return false;
  const port = getServerPort();
  if (!port) return false;
  try {
    // Main-process fetches bypass renderer header injection, so authenticated sidecars need
    // authHeader explicitly.
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/runtime-credential/minds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ value: value ?? '' }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Log outcomes, never credentials. A 404 means an older sidecar; its next start will retry
      // the handoff.
      if (res.status === 404) {
        console.warn('[minds-credential] the running sidecar has no hand-over route — it predates this build; retrying after it updates');
      } else {
        console.warn('[minds-credential] hand-over returned', res.status);
      }
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[minds-credential] hand-over failed', error);
    return false;
  }
}

/**
 * Resolve and push the current credential. Both steps absorb failures, so lifecycle hooks may call
 * without awaiting.
 */
export interface MindsCredentialSyncResult {
  landed: boolean;
  usable: boolean;
}

/** Resolve and synchronize once, retaining whether the selected value exists. */
export function syncMindsCredentialSelection(): Promise<MindsCredentialSyncResult> {
  // Resolve inside the queue so a slow keychain read cannot enqueue a stale selection after a newer
  // refresh.
  return enqueueCredentialPush(async () => {
    const credential = await resolveMindsCredentialSelection();
    return {
      landed: await pushMindsCredentialNow(credential.value),
      usable: credential.usable,
    };
  });
}

export async function syncMindsCredential(): Promise<boolean> {
  return (await syncMindsCredentialSelection()).landed;
}

/**
 * Report true only when a nonempty credential landed; successfully clearing it does not permit a
 * resumed turn.
 */
export async function syncUsableMindsCredential(): Promise<boolean> {
  const result = await syncMindsCredentialSelection();
  return result.usable && result.landed;
}

/**
 * Refresh and hand off before releasing boot routing, or a signed-in user can be sent to
 * onboarding.
 * Do not require a Keycloak session: BYOK installs also need their credential restored after
 * restart.
 * Inject refresh to avoid the minds-auth import cycle.
 */
export async function establishMindsCredential(
  refresh: () => Promise<unknown>,
): Promise<boolean> {
  // The in-memory access token is process-lifetime only and a laptop may have
  // slept past its expiry, so refresh before handing anything over.
  if (getRefreshToken() && isAccessTokenExpired()) await refresh();
  return enqueueCredentialPush(async () => {
    const credential = await resolveMindsCredentialSelection();
    if (!credential.value) return false;
    return pushMindsCredentialNow(credential.value);
  });
}

/** Store a user-supplied MindsHub key and hand it to the sidecar immediately. */
export async function setUserSuppliedMindsKey(key: string): Promise<boolean> {
  await setMindsApiKey(key);
  const landed = await pushMindsCredential(key);
  if (landed) settleMindsResumeCredentialGate(true);
  return landed;
}

/** Forget the supplied key and always push the session fallback, even if deletion fails. */
export async function clearUserSuppliedMindsKey(): Promise<boolean> {
  await forgetStoredKey();
  const result = await syncMindsCredentialSelection();
  if (result.usable && result.landed) settleMindsResumeCredentialGate(true);
  return result.landed;
}

/**
 * Report deletion failure without throwing: a fallback-file write can fail, but must not skip the
 * sidecar push.
 */
async function forgetStoredKey(): Promise<void> {
  try {
    await deleteMindsApiKey();
  } catch (error) {
    console.warn('[minds-credential] could not delete the stored key', error);
  }
}

/**
 * Clear both the stored key and sidecar credential. A failed delete must not skip the push.
 * Clearing only one lets the current sidecar or a subsequent restart keep using the key.
 */
export async function forgetMindsCredential(): Promise<void> {
  await forgetStoredKey();
  await pushMindsCredential(null);
}
