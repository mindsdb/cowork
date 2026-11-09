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

/** The account dotenv's switch for the agent's anonymous usage events, the
 *  shared browser's included (desktop Settings). Absent means on, the default;
 *  only `false` turns them off. */
export const USAGE_EVENTS_PREF = 'COWORK_USAGE_EVENTS';

export function usageEventsOn(accountVars: Record<string, string>): boolean {
  return accountVars[USAGE_EVENTS_PREF] !== 'false';
}

/** Writes the switch into the account dotenv at `envPath`: off adds
 *  `COWORK_USAGE_EVENTS=false`, on removes that line, and the other lines stay.
 *  The sidecar reads it at its next start. Throws when the file cannot be
 *  written. */
export function writeUsageEventsPref(envPath: string, enabled: boolean): void {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const lines = existing.split('\n').filter((l) => l.length > 0 && !l.startsWith(`${USAGE_EVENTS_PREF}=`));
  if (!enabled) lines.push(`${USAGE_EVENTS_PREF}=false`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

/** Only prod builds count as real users' turns: every other kind sends to the
 *  non-production project instead of anton's built-in production one. A value
 *  already set, in `env` or in one of anton's dotenv files (`dotenvNames`), is
 *  left alone, even an empty one, so a developer can still point a run
 *  elsewhere or switch the PostHog sink off.
 *
 *  When the person turned the agent's usage events off in Settings
 *  (`usageEvents: false`), anton gets `ANTON_ANALYTICS_ENABLED=false` at spawn,
 *  above any dotenv file, so it sends none. */
export function analyticsEnv(
  kind: BuildKind,
  env: NodeJS.ProcessEnv,
  dotenvNames: ReadonlySet<string> = new Set(),
  { usageEvents = true }: { usageEvents?: boolean } = {},
): Record<string, string> {
  const isSet = (name: string) => env[name] !== undefined || dotenvNames.has(name);
  const out: Record<string, string> = {};
  if (!usageEvents) out.ANTON_ANALYTICS_ENABLED = 'false';
  if (kind !== 'prod' && !isSet('ANTON_POSTHOG_KEY')) out.ANTON_POSTHOG_KEY = NON_PROD_POSTHOG_KEY;
  if (!isSet('ANTON_DEPLOYMENT_ENV')) out.ANTON_DEPLOYMENT_ENV = DEPLOYMENT_LABEL[kind];
  return out;
}

// python-dotenv's grammar (dotenv/parser.py), which is what decides whether a
// line sets anything for anton. A line-by-line reader gets it wrong both ways:
// it misses a single-quoted name, and it counts a line that sits inside a
// multi-line quoted value.
const DOTENV = {
  multilineWhitespace: /\s*/y,
  whitespace: /[^\S\r\n]*/y,
  export: /(?:export[^\S\r\n]+)?/y,
  singleQuotedKey: /'([^']+)'/y,
  unquotedKey: /([^=#\s]+)/y,
  equalSign: /(=[^\S\r\n]*)/y,
  singleQuotedValue: /'((?:\\'|[^'])*)'/y,
  doubleQuotedValue: /"((?:\\"|[^"])*)"/y,
  unquotedValue: /([^\r\n]*)/y,
  comment: /(?:[^\S\r\n]*#[^\r\n]*)?/y,
  endOfLine: /[^\S\r\n]*(?:\r\n|\n|\r|$)/y,
  restOfLine: /[^\r\n]*(?:\r|\n|\r\n)?/y,
};

/** The names a dotenv text assigns, as python-dotenv parses it. A name with
 *  no `=` gets no value, and a statement that fails to parse sets nothing;
 *  anton ignores both, so they are left out. */
function dotenvAssignedNames(text: string): string[] {
  let pos = 0;
  const read = (re: RegExp): string | undefined => {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw new Error('unparsable');
    pos = re.lastIndex;
    return m[1];
  };
  const names: string[] = [];
  while (pos < text.length) {
    const start = pos;
    try {
      read(DOTENV.multilineWhitespace);
      if (pos >= text.length) break;
      read(DOTENV.export);
      const c = text[pos];
      const key = c === '#' ? undefined
        : read(c === "'" ? DOTENV.singleQuotedKey : DOTENV.unquotedKey);
      read(DOTENV.whitespace);
      let assigned = false;
      if (text[pos] === '=') {
        read(DOTENV.equalSign);
        const v = text[pos];
        if (v === "'") read(DOTENV.singleQuotedValue);
        else if (v === '"') read(DOTENV.doubleQuotedValue);
        else if (v !== undefined && v !== '\n' && v !== '\r') read(DOTENV.unquotedValue);
        assigned = true;
      }
      read(DOTENV.comment);
      read(DOTENV.endOfLine);
      if (key !== undefined && assigned) names.push(key);
    } catch {
      // Like python-dotenv, skip the rest of the line from where parsing
      // failed, not from where the statement began.
      read(DOTENV.restOfLine);
    }
    // A match that consumes nothing at the end of the text would loop forever.
    if (pos === start) break;
  }
  return names;
}

/** The names set in the dotenv files anton reads, upper-cased. Mirrors anton's
 *  `_build_env_files`: `.env` and `.anton/.env` under the server's working
 *  directory, then `~/.anton/.env` and `~/.cowork/.env`. anton ranks the
 *  process environment above all of them, so anything injected at spawn would
 *  silently override what they say. pydantic-settings matches names without
 *  regard to case, so they are normalised. */
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
    for (const name of dotenvAssignedNames(text)) names.add(name.toUpperCase());
  }
  return names;
}
