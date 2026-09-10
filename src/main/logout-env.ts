// Sign-out credential scrub for the shared .env (see AUTH_LOGOUT in index.ts).
// Extracted so the permanent-write-failure path is unit-testable.

import * as fs from 'fs';
import { CREDENTIAL_ENV_KEYS } from './credential-env-keys';
import { writeEnvFileAtomic } from './minds-auth';

// Keys stripped from the .env on sign-out — for the standalone anton CLI and
// the next-boot migration. Preserving a model on sign-in but deleting it on
// sign-out would break the same "a `latest:` value may be a deliberate choice,
// never silently mutate it" rule the sign-in path follows, so the model keys are
// deliberately not in this list. A model is CLI-only in .env; the DB (product)
// is cleared separately.
export const LOGOUT_ENV_KEYS = CREDENTIAL_ENV_KEYS;

// Remove the credential keys from the .env file and from this process's
// inherited copies. The file write goes through writeEnvFileAtomic, which
// retries transient Windows share-mode locks (the server holds this same file
// open — ENG-1209) so the scrub actually lands rather than silently skipping.
//
// Contract, by design (ENG-1206):
//   * process.env is cleared in `finally` — always, even if the file write
//     fails — so the parent can never hand a restarted server stale keys.
//   * A write that still fails after retries REJECTS rather than resolving, so
//     the caller can log/observe it. Note this is NOT the authoritative
//     sign-out step: since ENG-941 the DB is authoritative for credentials and
//     config_ready, and the .env is never re-read on restart, so the .env scrub
//     is best-effort (it only keeps stale keys from the standalone anton CLI).
//     The logout handler therefore logs a rejection and presses on rather than
//     failing an otherwise-complete sign-out.
export async function scrubEnvCredentials(envPath: string, keys: string[] = LOGOUT_ENV_KEYS): Promise<void> {
  try {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
        .filter((l) => !keys.some((k) => l.startsWith(k + '=')));
      await writeEnvFileAtomic(envPath, lines.join('\n'));
    }
  } finally {
    for (const key of keys) {
      delete process.env[key];
    }
  }
}
