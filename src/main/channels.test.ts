import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BUILD_KINDS,
  CHANNELS,
  normalizeBuildKind,
  envSlugForApiHost,
  checkChannelConsistency,
} from './channels';
import { EXPECTED_API_ORIGIN } from '../../scripts/channel-origins.mjs';
import { channelIdentity } from '../../scripts/channel-identity.mjs';

describe('channels — canonical table', () => {
  it('every build kind has a spec whose envSlug matches its apiHost', () => {
    for (const kind of BUILD_KINDS) {
      const spec = CHANNELS[kind];
      expect(spec.kind).toBe(kind);
      expect(envSlugForApiHost(spec.apiHost)).toBe(spec.envSlug);
    }
  });

  it('only prod uses the historical ~/.cowork home; others are ~/.cowork-<kind>', () => {
    expect(CHANNELS.prod.homeDirName).toBe('.cowork');
    expect(CHANNELS.dev.homeDirName).toBe('.cowork-dev');
    expect(CHANNELS.preview.homeDirName).toBe('.cowork-preview');
    expect(CHANNELS.stable.homeDirName).toBe('.cowork-stable');
  });

  it('preview points at staging, not prod (regression: the old cross-env bug)', () => {
    expect(CHANNELS.preview.apiHost).toBe('https://api.staging.mindshub.ai');
    expect(CHANNELS.preview.serverRef).toBe('staging');
  });

  it('prod app name is frozen to "anton"; non-prod kinds are distinct', () => {
    expect(CHANNELS.prod.appName).toBe('anton'); // real users' userData lives here — never change
    const names = [CHANNELS.dev, CHANNELS.preview, CHANNELS.stable].map((c) => c.appName);
    expect(new Set(names).size).toBe(3); // all distinct
    expect(names).not.toContain('anton'); // no non-prod kind collides with prod's userData
  });

  it('non-prod kinds ship a badged runtime icon; prod/dev use the base icon', () => {
    // The runtime window/dock icon (resolveChannelIconPath) reads these.
    expect(CHANNELS.prod.iconName).toBe('icon.png'); // unchanged from historical prod icon
    expect(CHANNELS.dev.iconName).toBe('icon.png'); // never packaged
    expect(CHANNELS.preview.iconName).toBe('icon-preview.png');
    expect(CHANNELS.stable.iconName).toBe('icon-staging.png');
  });
});

describe('normalizeBuildKind', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('passes through canonical kinds (case/space-insensitive)', () => {
    expect(normalizeBuildKind('dev', 't')).toBe('dev');
    expect(normalizeBuildKind('  PREVIEW ', 't')).toBe('preview');
    expect(normalizeBuildKind('Stable', 't')).toBe('stable');
    expect(normalizeBuildKind('prod', 't')).toBe('prod');
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats an absent/empty value as prod (legacy builds carry no signal)', () => {
    expect(normalizeBuildKind('', 't')).toBe('prod');
    expect(normalizeBuildKind('   ', 't')).toBe('prod');
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails closed on an explicitly present but unrecognized value', () => {
    // A typo must NOT silently resolve to prod (which would point non-prod code
    // at the production data home / API). It aborts instead.
    expect(() => normalizeBuildKind('typo', 't')).toThrow(/invalid build kind/i);
    expect(() => normalizeBuildKind('prd', 'COWORK_BUILD_KIND')).toThrow(/invalid build kind/i);
  });
});

describe('envSlugForApiHost', () => {
  it('extracts the slug for non-prod hosts and empty for prod', () => {
    expect(envSlugForApiHost('https://api.mindshub.ai')).toBe('');
    expect(envSlugForApiHost('https://api.staging.mindshub.ai')).toBe('staging');
    expect(envSlugForApiHost('https://api.dev.mindshub.ai')).toBe('dev');
  });

  it('returns empty for a non-matching host', () => {
    expect(envSlugForApiHost('https://example.com')).toBe('');
    expect(envSlugForApiHost('')).toBe('');
  });
});

describe('checkChannelConsistency', () => {
  it('accepts each kind pointed at its canonical host', () => {
    for (const kind of BUILD_KINDS) {
      expect(checkChannelConsistency(kind, CHANNELS[kind].apiHost).ok).toBe(true);
    }
  });

  it('flags a preview build pointed at the prod API (the shipped bug)', () => {
    const c = checkChannelConsistency('preview', 'https://api.mindshub.ai');
    expect(c.ok).toBe(false);
    expect(c.expectedSlug).toBe('staging');
    expect(c.actualSlug).toBe('');
  });

  it('flags a prod build pointed at staging', () => {
    const c = checkChannelConsistency('prod', 'https://api.staging.mindshub.ai');
    expect(c.ok).toBe(false);
    expect(c.expectedSlug).toBe('');
    expect(c.actualSlug).toBe('staging');
  });

  it('rejects an unknown host instead of treating it as prod (regression)', () => {
    // The old slug-based check returned ok:true here because example.com's slug
    // was '' — the same slug prod has. An unknown host must NOT pass as prod.
    expect(checkChannelConsistency('prod', 'https://example.com').ok).toBe(false);
    expect(checkChannelConsistency('stable', 'https://example.com').ok).toBe(false);
  });

  it('treats an empty host as the intentional prod default (unset CI input)', () => {
    expect(checkChannelConsistency('prod', '').ok).toBe(true);
    // …but a non-prod build with no explicit host is a misconfiguration.
    expect(checkChannelConsistency('stable', '').ok).toBe(false);
  });

  it('ignores a path / trailing slash when comparing origins', () => {
    expect(checkChannelConsistency('stable', 'https://api.staging.mindshub.ai/v1/').ok).toBe(true);
  });
});

// Build scripts can't import the TS channel table, so they carry .mjs mirrors.
// These tests are the sync mechanism: edit CHANNELS without the mirror (or
// vice versa) and the suite fails, instead of CI quietly validating builds
// against a stale copy.
describe('build-script mirrors of the channel table', () => {
  it('scripts/channel-origins.mjs (build-time guard) matches CHANNELS exactly', () => {
    expect(Object.keys(EXPECTED_API_ORIGIN).sort()).toEqual([...BUILD_KINDS].sort());
    for (const kind of BUILD_KINDS) {
      expect(EXPECTED_API_ORIGIN[kind]).toBe(CHANNELS[kind].apiHost);
    }
  });

  it('scripts/channel-identity.mjs (bundle identity) matches CHANNELS exactly', () => {
    for (const kind of ['stable', 'preview'] as const) {
      const id = channelIdentity(kind);
      expect(id).not.toBeNull();
      // The packaged productName must equal the runtime appName: the userData
      // dir (app.setName → appName) and the on-disk app the user sees
      // (productName) have to agree, and reset-onboarding.sh derives the
      // Electron dir from this same name.
      expect(id!.productName).toBe(CHANNELS[kind].appName);
      expect(id!.appId).toBe(`com.mindshub.cowork.${kind}`);
      // Build-time bundle icon must match the runtime icon (CHANNELS[kind].iconName)
      // so the packaged icon and the running window/dock icon can't drift apart.
      // Bare basename (resolved under directories.buildResources = assets/), the
      // same convention electron-builder.yml uses for `icon: icon.png`.
      expect(id!.macIcon).toBe(CHANNELS[kind].iconName);
      expect(id!.winIcon).toBe(CHANNELS[kind].iconName);
    }
    // prod/dev (and unset) get NO overrides — prod must keep the
    // electron-builder.yml identity byte-for-byte; dev is never packaged.
    expect(channelIdentity('prod')).toBeNull();
    expect(channelIdentity('dev')).toBeNull();
    expect(channelIdentity('')).toBeNull();
    expect(channelIdentity(undefined)).toBeNull();
  });
});
