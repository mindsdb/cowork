import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const DEV_OAUTH_CREDENTIAL_KEYS = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
] as const;

type DevOAuthCredential = (typeof DEV_OAUTH_CREDENTIAL_KEYS)[number];

function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const quoted = rawValue.length >= 2
      && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
        || (rawValue.startsWith("'") && rawValue.endsWith("'")));
    values[key] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
  return values;
}

/**
 * Load the developer-owned GitHub and Linear OAuth clients for an unpackaged
 * Electron build. Local QA often overrides COWORK_DEV_HOME to isolate its DB,
 * so these credentials deliberately live in the stable ~/.cowork-dev/.env
 * rather than being copied into every temporary QA home.
 *
 * Only the four OAuth client fields are admitted. Provider tokens, MindsHub
 * credentials, and arbitrary dotenv values never cross this boundary.
 */
export function loadDevOAuthCredentials({
  isPackaged,
  env = process.env,
  envFile = path.join(os.homedir(), '.cowork-dev', '.env'),
}: {
  isPackaged: boolean;
  env?: NodeJS.ProcessEnv;
  envFile?: string;
}): Partial<Record<DevOAuthCredential, string>> {
  if (isPackaged) return {};

  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseDotenv(fs.readFileSync(envFile, 'utf8'));
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[credentials] could not read the local developer OAuth file at ${envFile}`);
    }
  }

  const credentials: Partial<Record<DevOAuthCredential, string>> = {};
  for (const key of DEV_OAUTH_CREDENTIAL_KEYS) {
    const value = String(env[key] || fileValues[key] || '').trim();
    if (value) credentials[key] = value;
  }
  return credentials;
}
