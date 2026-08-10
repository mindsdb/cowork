import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  resolveShellUpdateFeed,
  shellUpdaterCacheDirName,
  resolveWindowsPublisherNames,
  WINDOWS_PUBLISHER_CN,
} from './shell-update-feed';

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

describe('resolveWindowsPublisherNames', () => {
  it('emits both the full CN and the comma-truncated CN for our cert', () => {
    expect(resolveWindowsPublisherNames()).toEqual(['Mindsdb, Inc.', 'Mindsdb']);
    expect(WINDOWS_PUBLISHER_CN).toBe('Mindsdb, Inc.');
  });

  it('honours an override and trims it', () => {
    expect(resolveWindowsPublisherNames('  Acme, LLC  ')).toEqual(['Acme, LLC', 'Acme']);
  });

  it('returns a single entry when the CN has no comma', () => {
    expect(resolveWindowsPublisherNames('Acme Corp')).toEqual(['Acme Corp']);
  });

  it('falls back to the default for blank/empty overrides', () => {
    expect(resolveWindowsPublisherNames('')).toEqual(['Mindsdb, Inc.', 'Mindsdb']);
    expect(resolveWindowsPublisherNames('   ')).toEqual(['Mindsdb, Inc.', 'Mindsdb']);
    expect(resolveWindowsPublisherNames(null)).toEqual(['Mindsdb, Inc.', 'Mindsdb']);
  });
});

// Guards the Blocking finding: prove the pinned publisherNames actually satisfy
// electron-updater's own signature matching (builder-util-runtime's parseDn) for
// BOTH ways a host can format our signer subject, and REJECT a foreign signer.
// This is the "wrong-signer is rejected" smoke, runnable in CI without Windows.
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

  // openssl / RFC2253 splits the unquoted comma → CN parses to "Mindsdb".
  const RFC2253_SUBJECT =
    'C=US, ST=California, L=San Francisco, O=Mindsdb, Inc., serialNumber=6520534, CN=Mindsdb, Inc., businessCategory=Private Organization';
  // Windows Get-AuthenticodeSignature.Subject quotes the RDN → CN = "Mindsdb, Inc.".
  const WINDOWS_SUBJECT = 'CN="Mindsdb, Inc.", O="Mindsdb, Inc.", L=San Francisco, S=California, C=US';

  it('accepts our real signer subject in both comma-quoting forms', () => {
    expect(accepts(pin, RFC2253_SUBJECT)).toBe(true);
    expect(accepts(pin, WINDOWS_SUBJECT)).toBe(true);
  });

  it('rejects a valid signature from a different publisher', () => {
    expect(accepts(pin, 'CN="Acme, Inc.", O="Acme, Inc.", C=US')).toBe(false);
    expect(accepts(pin, 'C=US, O=Acme, Inc., CN=Acme, Inc.')).toBe(false);
  });
});
