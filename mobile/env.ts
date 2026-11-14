/**
 * Which cloud deployment the shell loads, chosen at build time with
 * `COWORK_ENV=staging|prod` (default: staging). Shared by capacitor.config.ts
 * and scripts/cap-copy-before.mjs (kept as plain JS so the sync hook needs
 * no TypeScript loader); keep the two URL tables identical.
 */
export const COWORK_URLS = {
  prod: 'https://cowork.mindshub.ai',
  staging: 'https://cowork.staging.mindshub.ai',
} as const;

export type CoworkEnv = keyof typeof COWORK_URLS;

export function resolveCoworkEnv(raw: string | undefined): CoworkEnv {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'staging') return 'staging';
  if (value === 'prod' || value === 'production') return 'prod';
  throw new Error(`COWORK_ENV must be "staging" or "prod", got "${raw}"`);
}
