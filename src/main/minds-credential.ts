// The MindsHub credential the sidecar runs on, held in this process and pushed
// over loopback instead of written to disk.
//
// The sidecar is a separate Python process, so a credential has to cross that
// boundary somehow. It used to cross as a file: a minted `mdb_` key written to
// `~/.cowork/.env` and to the settings table, where it sat with no expiry. A
// 10-minute access token cannot live there, and this is what replaces it —
// main holds the value and pushes it to `PUT /api/v1/runtime-credential/minds`,
// which the sidecar keeps in memory and overlays onto its settings.
//
// The same hand-over carries both credentials the app supports. A user who
// supplies their own `mdb_` key gets it stored in the OS keychain and pushed
// down the same path, so choosing BYOK does not put a long-lived bearer back on
// disk either.
//
// **Nothing here survives the sidecar restarting**, which is the point and also
// the trap. The sidecar restarts for an auto-update, a health failure, a crash
// and every app launch, and a credential held only in its memory is gone each
// time. Every one of those paths has to call `syncMindsCredential` again; the
// callers are the sign-in finalize handler, the token-refresh path, and the
// boot sequence in index.ts.
//
// This module deliberately does not import from minds-auth: that module calls
// into this one after every token refresh, and importing back would be a cycle.
// The current token is read straight from the store, which minds-auth has
// already written by the time it calls.

import { getAccessToken } from './token-store';
import { getServerPort, isServerRunning, isServerStarting } from './server-process';
import { authHeader } from './server-auth';
import { getMindsApiKey, setMindsApiKey, deleteMindsApiKey } from './keychain-service';

const PUSH_TIMEOUT_MS = 10_000;

/**
 * The credential the sidecar should present, or null when there is none.
 *
 * A key the user supplied by hand wins over the session credential: it is an
 * explicit choice, and someone who pasted their own key expects their turns to
 * run on it even while they are also signed in.
 */
export async function resolveMindsCredential(): Promise<string | null> {
  const supplied = await getMindsApiKey();
  if (supplied) return supplied;
  return getAccessToken();
}

/**
 * Hand `value` to the sidecar. A null or empty value clears it there.
 *
 * Returns whether the push landed. Callers that are establishing the credential
 * (sign-in, boot) care about the answer; the refresh timer does not, because the
 * next tick pushes again anyway.
 */
export async function pushMindsCredential(value: string | null): Promise<boolean> {
  if (!isServerRunning() && !isServerStarting()) return false;
  const port = getServerPort();
  if (!port) return false;
  try {
    // authHeader(): a main-process fetch never passes through the renderer's
    // webRequest injection hook, so with COWORK_REQUIRE_AUTH=true a bare PUT
    // would 401 and the app would look unconfigured with no visible cause.
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/runtime-credential/minds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ value: value ?? '' }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Never log the value, only the outcome.
      console.warn('[minds-credential] hand-over returned', res.status);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[minds-credential] hand-over failed', error);
    return false;
  }
}

/** Resolve the current credential and push it. The one call every trigger uses. */
export async function syncMindsCredential(): Promise<boolean> {
  return pushMindsCredential(await resolveMindsCredential());
}

/** Store a user-supplied MindsHub key and hand it to the sidecar immediately. */
export async function setUserSuppliedMindsKey(key: string): Promise<boolean> {
  await setMindsApiKey(key);
  return pushMindsCredential(key);
}

/**
 * Forget a user-supplied key and fall back to the session credential.
 *
 * The push is not optional: without it the sidecar keeps running on the key the
 * user just removed until something else happens to push.
 */
export async function clearUserSuppliedMindsKey(): Promise<boolean> {
  await deleteMindsApiKey();
  return syncMindsCredential();
}

/**
 * Sign-out: forget every MindsHub credential this process can hand over.
 *
 * Both halves are load-bearing. Clearing the sidecar alone would leave the
 * keychain entry behind, and the next sidecar start would push it straight back
 * — a signed-out install quietly running on a credential again. Deleting the
 * keychain entry alone would leave the sidecar holding the value it already has
 * until something else pushed.
 */
export async function forgetMindsCredential(): Promise<void> {
  await deleteMindsApiKey();
  await pushMindsCredential(null);
}
