// Scrub shared .env credentials during sign-out; the DB clear remains authoritative.

import * as fs from 'fs';
import { writeEnvFileAtomic } from './minds-auth';

// Preserve CLI model choices in .env; only credentials are scrubbed here. Product settings are
// cleared in the DB.
export const LOGOUT_ENV_KEYS = [
  'ANTON_MINDS_API_KEY',
  'ANTON_MINDS_URL',
  'ANTON_MINDS_ENABLED',
  'ANTON_OPENAI_API_KEY',
  'ANTON_OPENAI_BASE_URL',
  'ANTON_OPENAI_API_KEY_CUSTOM',
  'ANTON_ANTHROPIC_API_KEY',
  'ANTON_GEMINI_API_KEY',
  'ANTON_PLANNING_PROVIDER',
  'ANTON_CODING_PROVIDER',
];

// Always clear process.env, even if the file write fails. Reject exhausted write retries so callers
// can log them.
// This scrub protects the standalone CLI; DB credential clearing is the authoritative product
// sign-out.
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
