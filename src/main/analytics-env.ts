// Where the anton inside the spawned cowork-server sends its analytics, and how
// it labels them. `analyticsEnv` is pure, so the rule is tested per build kind
// without a spawn; `antonDotenvNames` is the one part that reads files.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BuildKind } from './channels';

// The non-production PostHog project. A project token can only write events
// and ships in every page that loads PostHog, so it is not a secret.
export const NON_PROD_POSTHOG_KEY = 'phc_zBzpZzh8kCPVpKeVyRRLNSfyTisRfLCq8SPhtiTHZway';

// What anton stamps on each event as `environment`. `stable` is the staging
// ring, so it says so.
const DEPLOYMENT_LABEL: Record<BuildKind, string> = {
  dev: 'dev',
  preview: 'preview',
  stable: 'staging',
  prod: 'prod',
};

/** Only prod builds count as real users' turns: every other kind sends to the
 *  non-production project instead of anton's built-in production one. A value
 *  already set, in `env` or in one of anton's dotenv files (`dotenvNames`), is
 *  left alone, even an empty one, so a developer can still point a run
 *  elsewhere or switch the PostHog sink off. */
export function analyticsEnv(
  kind: BuildKind,
  env: NodeJS.ProcessEnv,
  dotenvNames: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const isSet = (name: string) => env[name] !== undefined || dotenvNames.has(name);
  const out: Record<string, string> = {};
  if (kind !== 'prod' && !isSet('ANTON_POSTHOG_KEY')) out.ANTON_POSTHOG_KEY = NON_PROD_POSTHOG_KEY;
  if (!isSet('ANTON_DEPLOYMENT_ENV')) out.ANTON_DEPLOYMENT_ENV = DEPLOYMENT_LABEL[kind];
  return out;
}

/** The names set in the dotenv files anton reads, upper-cased. Mirrors anton's
 *  `_build_env_files`: `.env` and `.anton/.env` under the server's working
 *  directory, then `~/.anton/.env` and `~/.cowork/.env`. anton ranks the
 *  process environment above all of them, so anything injected at spawn would
 *  silently override what they say. pydantic-settings matches names without
 *  regard to case and accepts an `export ` prefix, so both are normalised. */
export function antonDotenvNames(cwd: string, home: string = os.homedir()): Set<string> {
  const files = [
    path.join(cwd, '.env'),
    path.join(cwd, '.anton', '.env'),
    path.join(home, '.anton', '.env'),
    path.join(home, '.cowork', '.env'),
  ];
  const names = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      if (!fs.existsSync(file)) continue;
      text = String(fs.readFileSync(file, 'utf-8'));
    } catch {
      continue;
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim().replace(/^export\s+/, '');
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq > 0) names.add(line.slice(0, eq).trim().toUpperCase());
    }
  }
  return names;
}
