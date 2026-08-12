import { describe, it, expect } from 'vitest';
import {
  downloadManifest,
  installerVersionFromFileName,
} from '../../scripts/write-download-manifest.mjs';

const VALID = {
  fileName: 'mindshub-cowork-2.26.8.10.1.pkg',
  platform: 'mac',
  cdnBase: 'https://downloads.mindshub.ai',
  sizeBytes: 220393119,
  sha256: 'c5fe5c0a81c77a5b9393b8ab671ec86bc5fe5c0a81c77a5b9393b8ab671ec86b',
  publishedAt: '2026-08-12T04:00:00.000Z',
};

describe('installerVersionFromFileName', () => {
  it('reads the version out of a released installer name on both platforms', () => {
    expect(installerVersionFromFileName('mindshub-cowork-2.26.8.10.1.pkg')).toBe('2.26.8.10.1');
    expect(installerVersionFromFileName('mindshub-cowork-2.26.8.10.1.exe')).toBe('2.26.8.10.1');
  });

  it('rejects preview and stable builds, which carry a channel and a commit sha', () => {
    expect(() =>
      installerVersionFromFileName('mindshub-cowork-2.0.1-preview-abc1234.pkg'),
    ).toThrow(/preview/);
    expect(() => installerVersionFromFileName('mindshub-cowork-2.0.1-stable-abc1234.exe')).toThrow(
      /stable/,
    );
  });

  it('rejects the mutable aliases, which sit at the same prefix under a fixed name', () => {
    expect(() => installerVersionFromFileName('mindshub-cowork-latest.pkg')).toThrow(/latest/);
    expect(() => installerVersionFromFileName('mindshub-cowork-staging.exe')).toThrow(/staging/);
  });

  it('rejects anything that is not an installer file name', () => {
    expect(() => installerVersionFromFileName('latest.json')).toThrow(/Not a released installer/);
    expect(() => installerVersionFromFileName('mindshub-cowork-2.0.1.zip')).toThrow(
      /Not a released installer/,
    );
  });
});

describe('downloadManifest', () => {
  it('carries exactly the six published fields, and derives key and url from the file name', () => {
    const manifest = downloadManifest(VALID);
    expect(Object.keys(manifest).sort()).toEqual([
      'key',
      'published_at',
      'sha256',
      'size_bytes',
      'url',
      'version',
    ]);
    expect(manifest.version).toBe('2.26.8.10.1');
    expect(manifest.key).toBe('mindshub-cowork/mac/mindshub-cowork-2.26.8.10.1.pkg');
    expect(manifest.url).toBe(
      'https://downloads.mindshub.ai/mindshub-cowork/mac/mindshub-cowork-2.26.8.10.1.pkg',
    );
    expect(manifest.size_bytes).toBe(220393119);
    expect(manifest.sha256).toBe(VALID.sha256);
    expect(manifest.published_at).toBe('2026-08-12T04:00:00.000Z');
  });

  it('the url is the cdn base joined to the key, with no doubled slash', () => {
    const manifest = downloadManifest({ ...VALID, cdnBase: 'https://downloads.mindshub.ai/' });
    expect(manifest.url).toBe(`https://downloads.mindshub.ai/${manifest.key}`);
  });

  it('puts windows installers under the windows prefix', () => {
    const manifest = downloadManifest({
      ...VALID,
      platform: 'windows',
      fileName: 'mindshub-cowork-2.26.8.10.1.exe',
    });
    expect(manifest.key).toBe('mindshub-cowork/windows/mindshub-cowork-2.26.8.10.1.exe');
  });

  it('rejects a platform that has no published prefix', () => {
    expect(() => downloadManifest({ ...VALID, platform: 'linux' })).toThrow(/Unsupported platform/);
  });

  it('rejects a non-https cdn base, which would advertise a downgradeable download', () => {
    expect(() => downloadManifest({ ...VALID, cdnBase: 'http://downloads.mindshub.ai' })).toThrow(
      /https origin/,
    );
  });

  it('rejects a size that is not a positive whole number of bytes', () => {
    expect(() => downloadManifest({ ...VALID, sizeBytes: 0 })).toThrow(/positive integer/);
    expect(() => downloadManifest({ ...VALID, sizeBytes: -1 })).toThrow(/positive integer/);
    expect(() => downloadManifest({ ...VALID, sizeBytes: 1.5 })).toThrow(/positive integer/);
  });

  it('rejects a digest that is not lowercase hex sha256', () => {
    expect(() => downloadManifest({ ...VALID, sha256: 'not-a-digest' })).toThrow(/sha256/);
    expect(() => downloadManifest({ ...VALID, sha256: VALID.sha256.toUpperCase() })).toThrow(
      /sha256/,
    );
    expect(() => downloadManifest({ ...VALID, sha256: VALID.sha256.slice(0, 63) })).toThrow(
      /sha256/,
    );
  });

  it('rejects a published_at that is not a real timestamp', () => {
    expect(() => downloadManifest({ ...VALID, publishedAt: 'yesterday' })).toThrow(/ISO-8601/);
  });
});
