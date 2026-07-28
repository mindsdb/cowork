// Canonical build-channel model — the single source of truth mapping each build
// "kind" (dev / preview / stable / prod) to its isolated data home, MindsHub API
// host, env slug (stamped on the cowork-server subprocess as ENV), and default
// cowork-server/anton branch. Both the runtime and CI derive from — and validate
// against — this one table.
//
// It exists because those axes used to drift: `buildKind` (build-config.json)
// and the API host (a baked VITE_MINDS_API_URL) had nothing tying them together,
// so a build could ship `preview` while pointed at the PRODUCTION API.
//
// Intentionally PURE (no electron / fs / env) so it is trivially testable and
// cycle-free. Which kind is THIS process? — see cowork-home.ts.

export const BUILD_KINDS = ['dev', 'preview', 'stable', 'prod'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];

export interface ChannelSpec {
  readonly kind: BuildKind;
  /** Directory name under $HOME for this channel's isolated data home. prod
   *  keeps the historical `~/.cowork`; every other kind is `~/.cowork-<kind>`. */
  readonly homeDirName: string;
  /** Canonical MindsHub API origin this channel is meant to target. */
  readonly apiHost: string;
  /** Env slug embedded in the API host ('staging' | 'dev'); '' for prod. Kept
   *  in lockstep with `apiHost` — see envSlugForApiHost. */
  readonly envSlug: string;
  /** Default cowork-server / anton git branch this channel builds from. */
  readonly serverRef: string;
}

const API_PROD = 'https://api.mindshub.ai';
const API_STAGING = 'https://api.staging.mindshub.ai';

// The one table. Change an environment mapping HERE and every layer follows.
export const CHANNELS: Record<BuildKind, ChannelSpec> = {
  // Local `npm run dev` only — never produced by CI. Points at STAGING so a bare
  // `npm run dev` never authenticates against production; the sibling-source
  // server it runs is stamped ENV=staging to match.
  dev: { kind: 'dev', homeDirName: '.cowork-dev', apiHost: API_STAGING, envSlug: 'staging', serverRef: 'main' },
  // Ephemeral per-PR installers. Isolated home so a tester's PR build never
  // touches their prod/staging data; talks to STAGING (not prod — the old bug).
  preview: { kind: 'preview', homeDirName: '.cowork-preview', apiHost: API_STAGING, envSlug: 'staging', serverRef: 'staging' },
  // Rolling builds off the `staging` branch. Kept the historical kind name
  // "stable" (its data home is ~/.cowork-stable); it targets the staging env.
  stable: { kind: 'stable', homeDirName: '.cowork-stable', apiHost: API_STAGING, envSlug: 'staging', serverRef: 'staging' },
  // Released builds off `main`. The only kind that uses the historical ~/.cowork.
  prod: { kind: 'prod', homeDirName: '.cowork', apiHost: API_PROD, envSlug: '', serverRef: 'main' },
};

/** Coerce a raw string (env / build-config.json / CI input) to a BuildKind.
 *  Fail-closed: an ABSENT value (empty) → "prod" (legacy releases carry no
 *  signal); a PRESENT but unrecognized value THROWS rather than defaulting to
 *  prod, so a typo can't silently point non-prod code at the production data
 *  home and API. Callers pass only values that were actually present (see
 *  resolveBuildKind). */
export function normalizeBuildKind(raw: string, source: string): BuildKind {
  const kind = raw.trim().toLowerCase();
  if (kind === '') return 'prod';
  if ((BUILD_KINDS as readonly string[]).includes(kind)) return kind as BuildKind;
  throw new Error(
    `[channels] invalid build kind "${raw}" from ${source}. Expected one of: ` +
      `${BUILD_KINDS.join(', ')}. Refusing to fall back to prod so a typo can't ` +
      `point a non-prod build at the production data home.`,
  );
}

/** The env slug ('staging' | 'dev' | '') encoded in a MindsHub API host —
 *  mirrors how minds-urls.ts derives MINDS_ENV_SLUG so the two never disagree.
 *  NOTE: this returns '' for BOTH the prod host and any non-MindsHub host, so it
 *  must NOT be used to decide consistency (an unknown host would look like prod).
 *  checkChannelConsistency compares full origins for exactly that reason. */
export function envSlugForApiHost(apiHost: string): string {
  const m = apiHost.match(/^https?:\/\/api\.([a-z0-9-]+)\.mindshub\.ai/i);
  return m ? m[1] : '';
}

/** Normalize an API host to a bare, lowercased origin for exact comparison. An
 *  empty/blank input normalizes to '' (an unset CI minds_api_url = the
 *  intentional prod default). A value carrying a path or trailing slash is
 *  reduced to its origin so it compares equal to the canonical host. */
export function normalizeApiOrigin(apiHost: string): string {
  const s = (apiHost || '').trim();
  if (s === '') return '';
  try {
    return new URL(s).origin.toLowerCase();
  } catch {
    return s.replace(/\/+$/, '').toLowerCase();
  }
}

export interface ChannelConsistency {
  readonly ok: boolean;
  readonly kind: BuildKind;
  readonly expectedSlug: string;
  readonly actualSlug: string;
  readonly expectedApiHost: string;
  readonly actualApiHost: string;
}

/** Cross-check that the API host a build actually points at matches the env its
 *  build kind is supposed to target. Guards the defect class where the two axes
 *  disagree — a `preview` build aimed at the prod API, or a `prod` build aimed
 *  at staging. Pure: the caller supplies the resolved host (from minds-urls),
 *  so this stays testable and import-cycle-free. */
export function checkChannelConsistency(kind: BuildKind, actualApiHost: string): ChannelConsistency {
  const spec = CHANNELS[kind];
  const actualOrigin = normalizeApiOrigin(actualApiHost);
  const expectedOrigin = normalizeApiOrigin(spec.apiHost);
  // An empty host means no API was explicitly configured — the intentional prod
  // default (an unset CI minds_api_url). That is consistent ONLY for prod; a
  // non-prod build with no explicit host is a misconfiguration. Otherwise
  // require an EXACT origin match. The previous slug-only check returned "ok"
  // for ANY unrecognized host (its slug was '' == prod's slug), so a mistyped
  // or unintended host was indistinguishable from prod.
  const ok = actualOrigin === '' ? kind === 'prod' : actualOrigin === expectedOrigin;
  return {
    ok,
    kind,
    expectedSlug: spec.envSlug,
    actualSlug: envSlugForApiHost(actualApiHost),
    expectedApiHost: spec.apiHost,
    actualApiHost,
  };
}
