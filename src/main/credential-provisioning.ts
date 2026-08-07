// Provisions the 15 static OAuth client id/secret values into the OS-native
// secure store, and reads them back out on every server start (ENG-1241).
//
// Previously these shipped in a plaintext, world-readable server-credentials.json
// inside the signed app bundle. The installer's only remaining job is staging
// a short-lived copy of that file *outside* the bundle (Contents/Resources is
// root-owned on macOS, so this process could never delete anything inside it
// after provisioning); this module is what actually moves values from that
// staged file into the secure store and cleans up after itself.
//
// Runs from loadBundledServerCredentials() on every startServer() call — not
// gated behind "first launch" — for two reasons: (1) there is no cheaper
// "is this the first launch" signal than doing this exact check, since
// runInstaller() (the real first-run wizard) is not on the path every launch
// takes; (2) a later app update can ship rotated secrets, and only an
// every-launch check can pick that up for an already-provisioned install.
//
// Keep STATIC_CREDENTIAL_KEYS in sync with the CI steps that generate the
// staged file: .github/workflows/build-macos-pkg.yml and
// .github/workflows/build-windows-installer.yml.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getStaticCredential,
  setStaticCredential,
  getGenerationMarker,
  setGenerationMarker,
} from './keychain-service';

export const STATIC_CREDENTIAL_KEYS = [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ANALYTICS_CLIENT_ID',
  'GOOGLE_ANALYTICS_CLIENT_SECRET',
  'GOOGLE_PICKER_API_KEY',
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

/**
 * Deterministic fingerprint of a credential set — sorted so key order in the
 * staged JSON never affects the hash, only content does. Lets us detect
 * whether a staged file is newer than what's already in the secure store
 * without a human-maintained version number (so a future secret rotation
 * "just works" the next time an affected install launches).
 */
export function computeGeneration(values: Record<string, string>): string {
  const lines = STATIC_CREDENTIAL_KEYS.slice()
    .sort()
    .map((key) => `${key}=${values[key] ?? ''}`);
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Every path this process might find a staged file at, most-specific first.
 * Pure and platform-based (no filesystem access), so it's cheap to unit test.
 */
export function getCandidateStagingPaths(): string[] {
  if (process.platform === 'darwin') {
    return [
      // Normal case: postinstall identified a console user and staged here,
      // owned by them, mode 600.
      path.join(os.homedir(), '.cowork-provision', 'server-credentials.json'),
      // Fallback: no console user at install time (headless/MDM/pre-login) —
      // postinstall staged a group-readable copy here instead.
      '/Library/Application Support/MindsHub Cowork/.provision/server-credentials.json',
    ];
  }
  // Windows: no separate staging step. electron-builder.yml gives Windows its
  // own extraResources override, so the file lands directly in the app's own
  // installed Resources folder — already owned by the current user (per-user
  // install), so this process can read and delete it in place.
  return [path.join(process.resourcesPath || '', 'server-credentials.json')];
}

function findExistingStagingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Unexpected error probing this candidate (e.g. a permission issue on
      // an intermediate directory) — treat it as absent and keep checking
      // the rest rather than letting one bad path abort provisioning.
    }
  }
  return null;
}

function isCredentialRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads a staged credentials file (if one exists), writes any values whose
 * generation is newer than what's already in the secure store, and deletes
 * the file once it's no longer needed. Never throws — every failure mode is
 * logged and left for the next launch to retry, since this runs on every
 * server start and a thrown error here must never block the app from
 * starting with whatever credentials are already provisioned.
 */
export async function provisionCredentialsFromStaging(): Promise<void> {
  const stagingPath = findExistingStagingPath(getCandidateStagingPaths());
  if (!stagingPath) return; // already provisioned, or nothing staged (dev mode) — expected, silent

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(stagingPath, 'utf8'));
  } catch (err) {
    console.error(`[credentials] failed to read/parse staged file at ${stagingPath}:`, err);
    return; // could be a transient read error — leave the file for the next launch to retry
  }
  if (!isCredentialRecord(parsed)) {
    console.error(`[credentials] staged file at ${stagingPath} is not a JSON object — ignoring it`);
    return;
  }
  const values = parsed;

  const generation = computeGeneration(values);

  let storedGeneration: string | null;
  try {
    storedGeneration = await getGenerationMarker();
  } catch (err) {
    console.error('[credentials] failed to read the stored generation marker from the secure store:', err);
    return; // can't safely decide whether a write is needed — retry next launch
  }

  if (storedGeneration === generation) {
    // Already up to date — the file is redundant. Failing to delete it isn't
    // a provisioning failure (the secure store is already correct), just a
    // cleanup nicety, so log and move on rather than retrying forever.
    try {
      fs.unlinkSync(stagingPath);
    } catch (err) {
      console.error(
        `[credentials] values already current; failed to remove redundant staged file at ${stagingPath}:`,
        err,
      );
    }
    return;
  }

  const results = await Promise.allSettled(
    STATIC_CREDENTIAL_KEYS.map((key) => setStaticCredential(key, values[key] ?? '')),
  );
  type StaticKey = (typeof STATIC_CREDENTIAL_KEYS)[number];
  const failed = results
    .map((result, i) => ({ result, key: STATIC_CREDENTIAL_KEYS[i] }))
    .filter(
      (entry): entry is { result: PromiseRejectedResult; key: StaticKey } => entry.result.status === 'rejected',
    );

  if (failed.length > 0) {
    console.error(
      `[credentials] failed to write ${failed.length}/${STATIC_CREDENTIAL_KEYS.length} values to the secure` +
        ` store (${failed.map((f) => f.key).join(', ')}); leaving the staged file in place to retry next launch.`,
    );
    for (const { key, result } of failed) {
      console.error(`[credentials]   ${key}:`, result.reason);
    }
    return; // do not update the marker, do not delete the file — next launch retries all 15 from scratch
  }

  try {
    await setGenerationMarker(generation);
  } catch (err) {
    // All 15 values are safely written; only the marker update failed.
    // Leaving the file in place is still correct: next launch will see the
    // stored marker hasn't changed and re-run this same write — harmless,
    // since keytar.setPassword is an upsert — then try the marker update
    // again.
    console.error('[credentials] wrote all values but failed to update the generation marker:', err);
    return;
  }

  try {
    fs.unlinkSync(stagingPath);
  } catch (err) {
    // Provisioning fully succeeded — this is just cleanup. The next launch
    // will see the marker already matches and quietly delete the leftover
    // file itself (the branch above), so nothing is lost.
    console.error(`[credentials] provisioning succeeded but failed to delete staged file at ${stagingPath}:`, err);
  }
}

/**
 * Reads all 15 static values back out of the secure store. A value that was
 * never provisioned (or fails to read) is omitted from the result, matching
 * the original file-based behavior of returning {} when nothing is
 * configured — an absent key and an empty-string key behave identically once
 * merged into a spawned process's env.
 */
export async function loadStaticCredentials(): Promise<Record<string, string>> {
  const entries = await Promise.all(
    STATIC_CREDENTIAL_KEYS.map(async (key) => {
      try {
        return [key, await getStaticCredential(key)] as const;
      } catch (err) {
        console.error(`[credentials] failed to read ${key} from the secure store:`, err);
        return [key, null] as const;
      }
    }),
  );
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value !== null) result[key] = value;
  }
  return result;
}

/**
 * Drop-in async replacement for the old synchronous, file-based
 * loadBundledServerCredentials(). Provisions from a staged file if one
 * exists and is newer, then returns whatever's currently in the secure
 * store, for the caller to merge into the spawned server's environment.
 */
export async function loadBundledServerCredentials(): Promise<Record<string, string>> {
  try {
    await provisionCredentialsFromStaging();
  } catch (err) {
    // provisionCredentialsFromStaging is written to catch everything itself;
    // this is a last-resort guard so a truly unexpected failure (e.g. an
    // OS-level keytar crash) can never stop the server from starting with
    // whatever's already provisioned.
    console.error('[credentials] unexpected error while provisioning from staging:', err);
  }
  return loadStaticCredentials();
}
