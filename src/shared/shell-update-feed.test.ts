import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  resolveShellUpdateFeed,
  shellUpdaterCacheDirName,
  resolveWindowsPublisherNames,
  withAppUpdateChannel,
  SHELL_UPDATE_CHANNEL,
  WINDOWS_PUBLISHER_CN,
} from './shell-update-feed';
import { calVerToUpdaterSemVer } from './version';

describe('resolveShellUpdateFeed', () => {
  it('keeps prod and stable on separate platform feeds', () => {
    expect(resolveShellUpdateFeed('prod', 'darwin')).toEqual({
      channel: 'prod',
      platform: 'darwin',
      url: 'https://downloads.mindshub.ai/mindshub-cowork/updates/prod/mac',
    });
    expect(resolveShellUpdateFeed('stable', 'win32')).toEqual({
      channel: 'stable',
      platform: 'win32',
      url: 'https://downloads.mindshub.ai/mindshub-cowork/updates/stable/windows',
    });
  });

  it('fails closed for preview, dev, unknown and unsupported platforms', () => {
    expect(resolveShellUpdateFeed('preview', 'darwin')).toBeNull();
    expect(resolveShellUpdateFeed('dev', 'darwin')).toBeNull();
    expect(resolveShellUpdateFeed(null, 'win32')).toBeNull();
    expect(resolveShellUpdateFeed('prod', 'linux')).toBeNull();
  });
});

describe('shellUpdaterCacheDirName', () => {
  it('scopes the OS-cache pending-download dir by channel', () => {
    expect(shellUpdaterCacheDirName('prod')).toBe('anton-updater-prod');
    expect(shellUpdaterCacheDirName('stable')).toBe('anton-updater-stable');
  });

  it('keeps stable and prod on separate cache dirs (no cross-channel eviction)', () => {
    expect(shellUpdaterCacheDirName('prod')).not.toBe(shellUpdaterCacheDirName('stable'));
  });
});

// The updater channel baked into app-update.yml names the manifest the client
// fetches; it must equal the fixed name the publish pipeline writes
// (`latest.yml` / `latest-mac.yml`), never a per-build value derived from the
// version.
describe('SHELL_UPDATE_CHANNEL + withAppUpdateChannel', () => {
  it('is a fixed, ring-stable channel matching the published manifest name', () => {
    expect(SHELL_UPDATE_CHANNEL).toBe('latest');
    // A version-derived channel could be numeric; the fixed pointer never is.
    expect(SHELL_UPDATE_CHANNEL).not.toMatch(/^\d/);
  });

  it('stays independent of the channel electron-builder would derive from the version', () => {
    // An untagged build's updater semver is a prerelease whose first token is the
    // commit distance — what electron-builder would otherwise use as the channel.
    const semver = calVerToUpdaterSemVer('2.26.8.9.1-306-gabc1234');
    expect(semver).toBe('2.260809.1-306.gabc1234');
    const versionDerivedChannel = semver!.split('-')[1].split('.')[0];
    expect(versionDerivedChannel).toBe('306');
    expect(versionDerivedChannel).not.toBe(SHELL_UPDATE_CHANNEL);
  });

  it('replaces an existing channel line with the pinned pointer', () => {
    const manifest = [
      'provider: generic',
      'url: https://downloads.mindshub.ai/mindshub-cowork/updates/stable/windows',
      'channel: 306',
      'updaterCacheDirName: anton-updater-stable',
      '',
    ].join('\n');
    const fixed = withAppUpdateChannel(manifest);
    expect(fixed).toContain('channel: latest');
    expect(fixed).not.toContain('channel: 306');
    // Other lines are left intact.
    expect(fixed).toContain('url: https://downloads.mindshub.ai/mindshub-cowork/updates/stable/windows');
    expect(fixed).toContain('updaterCacheDirName: anton-updater-stable');
  });

  it('appends a channel line when the manifest has none', () => {
    const manifest = 'provider: generic\nurl: https://example.com/feed\n';
    const fixed = withAppUpdateChannel(manifest);
    expect(fixed).toBe(`${manifest}channel: latest\n`);
  });

  it('honours an explicit channel override', () => {
    expect(withAppUpdateChannel('channel: 306\n', 'beta')).toBe('channel: beta\n');
  });
});

describe('resolveWindowsPublisherNames', () => {
  it('pins the exact full CN of our cert — no comma-truncated fallback', () => {
    expect(resolveWindowsPublisherNames()).toEqual(['Mindsdb, Inc.']);
    expect(WINDOWS_PUBLISHER_CN).toBe('Mindsdb, Inc.');
  });

  it('honours an override and trims it', () => {
    expect(resolveWindowsPublisherNames('  Acme, LLC  ')).toEqual(['Acme, LLC']);
  });

  it('falls back to the default for blank/empty overrides', () => {
    expect(resolveWindowsPublisherNames('')).toEqual(['Mindsdb, Inc.']);
    expect(resolveWindowsPublisherNames('   ')).toEqual(['Mindsdb, Inc.']);
    expect(resolveWindowsPublisherNames(null)).toEqual(['Mindsdb, Inc.']);
  });
});

// Guards the signer pin: prove the pinned publisherName satisfies
// electron-updater's own signature matching (builder-util-runtime's parseDn) for
// the subject the client actually observes, and REJECTS both a foreign signer
// AND a near-match with the same short CN but a different identity. Runs in CI
// without Windows.
describe('windows publisher pin (electron-updater parseDn semantics)', () => {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseDn } = require('builder-util-runtime') as {
    parseDn: (dn: string) => Map<string, string>;
  };

  // Verbatim from windowsExecutableCodeSignatureVerifier.verifySignature.
  const accepts = (publisherNames: string[], signerSubject: string): boolean => {
    const subject = parseDn(signerSubject);
    return publisherNames.some(name => {
      const dn = parseDn(name);
      if (dn.size) return Array.from(dn.keys()).every(key => dn.get(key) === subject.get(key));
      return name === subject.get('CN');
    });
  };

  const pin = resolveWindowsPublisherNames();

  // What the client actually sees: Get-AuthenticodeSignature.Subject, which .NET
  // emits with the comma-bearing RDN double-quoted → CN parses to "Mindsdb, Inc.".
  const WINDOWS_SUBJECT = 'CN="Mindsdb, Inc.", O="Mindsdb, Inc.", L=San Francisco, S=California, C=US';

  it('accepts our real signer subject (the .NET quoted form the client observes)', () => {
    expect(accepts(pin, WINDOWS_SUBJECT)).toBe(true);
  });

  it('rejects a valid signature from a different publisher', () => {
    expect(accepts(pin, 'CN="Acme, Inc.", O="Acme, Inc.", C=US')).toBe(false);
  });

  it('rejects a near-match: same short CN but a distinct identity', () => {
    // A cert whose CN is the bare "Mindsdb" (not our full "Mindsdb, Inc.") under
    // an unrelated org. The dropped comma-truncated fallback would have admitted
    // this; the exact-CN pin does not.
    expect(accepts(pin, 'CN=Mindsdb, O=Unrelated Company, C=US')).toBe(false);
    expect(accepts(pin, 'CN="Mindsdb", O="Unrelated Company"')).toBe(false);
  });
});

// Guards the Blocking config finding: electron-builder 26's schema rejects
// win.publisherName but accepts it on the publish provider config (where the
// generated app-update.yml reads it). If this contract ever changes, eligible
// Windows builds would fail validateConfiguration before packaging — catch it here.
describe('electron-builder publisherName config contract (v26 schema)', () => {
  const require = createRequire(import.meta.url);
  /* eslint-disable @typescript-eslint/no-var-requires */
  const Ajv = require('ajv') as typeof import('ajv').default;
  const nodePath = require('node:path') as typeof import('node:path');
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const schemePath = nodePath.join(
    nodePath.dirname(require.resolve('app-builder-lib/package.json')),
    'scheme.json',
  );
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  const validate = ajv.compile(JSON.parse(readFileSync(schemePath, 'utf8')));

  it('rejects win.publisherName (the regression) and accepts publish.publisherName', () => {
    expect(validate({ win: { publisherName: resolveWindowsPublisherNames() } })).toBe(false);
    expect(validate({
      publish: {
        provider: 'generic',
        url: 'https://downloads.mindshub.ai/mindshub-cowork/updates/stable/windows',
        publisherName: resolveWindowsPublisherNames(),
      },
    })).toBe(true);
  });
});
