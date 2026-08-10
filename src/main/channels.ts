// Canonical build-channel model: the single source of truth mapping each build
// "kind" (dev / preview / stable / prod) to its data home, MindsHub API host, env
// slug (stamped on cowork-server as ENV), and default server/anton branch. Both
// runtime and CI derive from — and validate against — this table.
//
// It exists because those axes used to drift: nothing tied `buildKind` to the
// baked API host, so a build could ship `preview` while pointed at PROD.
// Pure (no electron/fs/env) so it's testable and cycle-free; which kind is THIS
// process is resolved in cowork-home.ts.

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
  /** Electron app name → the userData dir, set via app.setName so build kinds get
   *  separate localStorage / consent / token-store state and install as distinct
   *  apps. prod is FROZEN to 'anton' (applied by NOT calling setName — see
   *  app-identity.ts). Build-time identity lives in scripts/channel-identity.mjs. */
  readonly appName: string;
  /** Basename (under assets/) of the RUNTIME window/dock icon. Non-prod kinds ship
   *  a badged icon-<kind>.png; prod/dev use the base icon.png. Set at runtime
   *  because the window/dock icon is chosen in code (the packaged bundle icon
   *  alone doesn't govern it); channels.test.ts drift-guards it against the
   *  build-time icon in channel-identity.mjs. */
  readonly iconName: string;
}

const API_PROD = 'https://api.mindshub.ai';
const API_STAGING = 'https://api.staging.mindshub.ai';

// The one table. Change an environment mapping HERE and every layer follows.
export const CHANNELS: Record<BuildKind, ChannelSpec> = {
  // Local `npm run dev` only (never built by CI). STAGING, so a bare dev run
  // never authenticates against prod.
  dev: { kind: 'dev', homeDirName: '.cowork-dev', apiHost: API_STAGING, envSlug: 'staging', serverRef: 'main', appName: 'MindsHub Cowork (Dev)', iconName: 'icon.png' },
  // Ephemeral per-PR installers. Isolated home + STAGING (not prod — the old bug).
  preview: { kind: 'preview', homeDirName: '.cowork-preview', apiHost: API_STAGING, envSlug: 'staging', serverRef: 'staging', appName: 'MindsHub Cowork (Preview)', iconName: 'icon-preview.png' },
  // Rolling builds off `staging`. Keeps the historical kind name "stable"
  // (home ~/.cowork-stable) but targets the staging env; user-facing label "Staging".
  stable: { kind: 'stable', homeDirName: '.cowork-stable', apiHost: API_STAGING, envSlug: 'staging', serverRef: 'staging', appName: 'MindsHub Cowork (Staging)', iconName: 'icon-staging.png' },
  // Released builds off `main` — the only kind on the historical ~/.cowork and the
  // historical 'anton' userData name (never re-set — see app-identity.ts).
  prod: { kind: 'prod', homeDirName: '.cowork', apiHost: API_PROD, envSlug: '', serverRef: 'main', appName: 'anton', iconName: 'icon.png' },
};

/** Coerce a raw string (env / build-config.json / CI input) to a BuildKind.
 *  Fail-closed: an empty value → "prod" (legacy releases carry no signal); a
 *  present but unrecognized value THROWS rather than defaulting to prod, so a
 *  typo can't silently point non-prod code at the production home and API. */
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

/** The env slug ('staging' | 'dev' | '') encoded in a MindsHub API host; mirrors
 *  minds-urls.ts's MINDS_ENV_SLUG so the two never disagree. Returns '' for BOTH
 *  the prod host and any non-MindsHub host, so it must NOT decide consistency (an
 *  unknown host would look like prod) — checkChannelConsistency compares origins. */
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
  // An empty host = no API explicitly configured (unset CI minds_api_url), the
  // intentional prod default — consistent ONLY for prod. Otherwise require an
  // EXACT origin match: the old slug-only check called any unrecognized host
  // "ok" (its slug was '' == prod's), making a typo indistinguishable from prod.
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
