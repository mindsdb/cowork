// Provision staged OAuth credentials into the secure store on every server start, including
// rotations.
// Installers stage outside root-owned bundles so the app can delete the plaintext after
// provisioning.
// Keep STATIC_CREDENTIAL_KEYS aligned with the macOS, Windows and Linux installer workflows.
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
  'SUPABASE_CLIENT_ID',
  'SUPABASE_CLIENT_SECRET',
] as const;

/** Hash sorted contents so a rotated credential set is detected independently of JSON key order. */
export function computeGeneration(values: Record<string, string>): string {
  const lines = STATIC_CREDENTIAL_KEYS.slice()
    .sort()
    .map((key) => `${key}=${values[key] ?? ''}`);
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Candidate staging paths, most-specific first. */
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
  if (process.platform === 'linux') {
    return [
      // The deb stages user-owned credentials here because the app cannot delete its root-owned
      // /opt copy.
      path.join(os.homedir(), '.cowork-provision', 'server-credentials.json'),
      // Headless installs may retain the resources copy when no installing user can be identified.
      path.join(process.resourcesPath || '', 'server-credentials.json'),
    ];
  }
  // Windows installs per-user, so the app can read and delete the resources copy directly.
  return [path.join(process.resourcesPath || '', 'server-credentials.json')];
}

function findExistingStagingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Skip inaccessible candidates so one bad path does not abort provisioning.
    }
  }
  return null;
}

function isCredentialRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Provision changed staged credentials, deleting the file only after success.
 * Failures are logged and retried on the next server start without blocking startup.
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
    // The secure store is current; failure to delete the redundant file is cleanup-only.
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
    // Keep the staged file if the marker write fails; the next launch can safely repeat the
    // credential upserts.
    console.error('[credentials] wrote all values but failed to update the generation marker:', err);
    return;
  }

  try {
    fs.unlinkSync(stagingPath);
  } catch (err) {
    // The marker is current; the next launch can remove any leftover staged file.
    console.error(`[credentials] provisioning succeeded but failed to delete staged file at ${stagingPath}:`, err);
  }
}

/** Read provisioned credentials, omitting missing or unreadable values. */
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

/** Provision staged rotations, then return stored credentials for the server environment. */
export async function loadBundledServerCredentials(): Promise<Record<string, string>> {
  try {
    await provisionCredentialsFromStaging();
  } catch (err) {
    // Unexpected provisioning failures must not prevent startup with existing credentials.
    console.error('[credentials] unexpected error while provisioning from staging:', err);
  }
  const credentials = await loadStaticCredentials();

  // No staged file and no stored credentials indicates a broken install.
  // This can happen when a different user launches the app than the installer staged credentials
  // for.
  if (Object.keys(credentials).length === 0) {
    console.warn(
      '[credentials] no OAuth credentials are provisioned for this user. If this machine was set up'
        + ' by a different user account, the installer staged them into that account instead;'
        + ' reinstall as this user to provision them here.',
    );
  }
  return credentials;
}
