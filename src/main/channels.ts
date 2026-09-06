// Shared channel mapping for runtime and CI. cowork-home.ts resolves the current build kind.

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
  /**
   * Runtime app name isolates userData. Leave prod named "anton"; see app-identity.ts.
   * Packaged identity lives in scripts/channel-identity.mjs.
   */
  readonly appName: string;
  /** Runtime window/dock icon under assets/. Keep aligned with channel-identity.mjs. */
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

/** Missing kind means legacy prod; reject unknown values to avoid using production state by mistake. */
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

/**
 * Returns an empty slug for both prod and unknown hosts. Use checkChannelConsistency for
 * validation.
 */
export function envSlugForApiHost(apiHost: string): string {
  const m = apiHost.match(/^https?:\/\/api\.([a-z0-9-]+)\.mindshub\.ai/i);
  return m ? m[1] : '';
}

/** Normalize to a lowercased origin, ignoring paths. Blank means the default prod host. */
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

/**
 * Require the API origin to match the build kind; a slug alone cannot distinguish prod from an
 * unknown host.
 */
export function checkChannelConsistency(kind: BuildKind, actualApiHost: string): ChannelConsistency {
  const spec = CHANNELS[kind];
  const actualOrigin = normalizeApiOrigin(actualApiHost);
  const expectedOrigin = normalizeApiOrigin(spec.apiHost);
  // An unset host is the prod default. Every explicit host must match the channel origin exactly.
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
