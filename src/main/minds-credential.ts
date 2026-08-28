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

import { getAccessToken, getRefreshToken, isAccessTokenExpired } from './token-store';
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
  try {
    const supplied = await getMindsApiKey();
    if (supplied) return supplied;
  } catch (error) {
    // A keychain that cannot be read must not cost a signed-in user their
    // session credential too. keychain-service already falls back to its
    // encrypted file when keytar throws, so reaching here means both stores
    // failed — fall through and present the token rather than nothing.
    console.warn('[minds-credential] could not read the stored key', error);
  }
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

/**
 * Resolve the current credential and push it. The one call every trigger uses.
 *
 * Never rejects, and there is no try/catch here doing it: both halves already
 * swallow their own failures, so adding one would be a branch nothing can
 * reach. That matters because two callers start this with `void` — the refresh
 * path and the invalid-grant path, neither of which can usefully wait — so a
 * rejection would surface as an unhandled rejection in the main process rather
 * than as a failed push. `minds-credential.test.ts` pins the contract.
 */
export async function syncMindsCredential(): Promise<boolean> {
  return pushMindsCredential(await resolveMindsCredential());
}

/**
 * Get the sidecar onto a credential the gateway will accept, at boot.
 *
 * Boot routing is held across this: `serverConfigured()` reads `config_ready`
 * the moment `bootServerSettled` resolves, and `resolveBootTarget` consults it
 * before it ever reaches `awaitBootReady()`, so a launch that releases the gate
 * first routes a signed-in user into onboarding while the push is in flight.
 *
 * `refresh` is injected rather than imported because it lives in minds-auth,
 * which imports this module — see the note at the top of the file.
 *
 * Two things it deliberately does NOT gate on. Not the refresh token: someone
 * running on a key they supplied by hand has one in the keychain and no
 * Keycloak session, and gating on the session leaves those installs
 * unconfigured after every restart. And not success: having nothing to hand
 * over is a real state, and pushing a blank there would only clear what the
 * sidecar already lacks.
 */
export async function establishMindsCredential(
  refresh: () => Promise<unknown>,
): Promise<boolean> {
  // The in-memory access token is process-lifetime only and a laptop may have
  // slept past its expiry, so refresh before handing anything over.
  if (getRefreshToken() && isAccessTokenExpired()) await refresh();
  const credential = await resolveMindsCredential();
  if (!credential) return false;
  return pushMindsCredential(credential);
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
 * user just removed until something else happens to push. So the delete cannot
 * be allowed to skip it — see `forgetMindsCredential` for why that is possible.
 */
export async function clearUserSuppliedMindsKey(): Promise<boolean> {
  await forgetStoredKey();
  return syncMindsCredential();
}

/**
 * Drop the stored key, reporting failure rather than raising it.
 *
 * `keychain-service` swallows every keytar error and falls through to its
 * encrypted file, but that file's WRITE is unguarded, so on a machine with no
 * OS secure store a delete can still throw. Both callers below have a second
 * step that matters more than this one, and neither may be skipped by it.
 */
async function forgetStoredKey(): Promise<void> {
  try {
    await deleteMindsApiKey();
  } catch (error) {
    console.warn('[minds-credential] could not delete the stored key', error);
  }
}

/**
 * Sign-out: forget every MindsHub credential this process can hand over.
 *
 * Both halves are load-bearing. Clearing the sidecar alone would leave the
 * keychain entry behind, and the next sidecar start would push it straight back
 * — a signed-out install quietly running on a credential again. Deleting the
 * keychain entry alone would leave the sidecar holding the value it already has
 * until something else pushed. So a failing delete must not skip the push, which
 * is what `forgetStoredKey` is for.
 */
export async function forgetMindsCredential(): Promise<void> {
  await forgetStoredKey();
  await pushMindsCredential(null);
}
