import { describe, it, expect } from 'vitest';
import {
  downloadManifest,
  installerVersionFromFileName,
} from '../../scripts/write-download-manifest.mjs';

const PROD = {
  key: 'mindshub-cowork/mac/mindshub-cowork-2.26.8.10.1.pkg',
  fileName: 'mindshub-cowork-2.26.8.10.1.pkg',
  channel: 'prod',
  cdnBase: 'https://downloads.mindshub.ai',
  sizeBytes: 220393119,
  sha256: 'c5fe5c0a81c77a5b9393b8ab671ec86bc5fe5c0a81c77a5b9393b8ab671ec86b',
  publishedAt: '2026-08-12T04:00:00.000Z',
};

const STABLE = {
  ...PROD,
  key: 'mindshub-cowork/mac/snapshots/mindshub-cowork-2.260810.1-stable-9021d7b7.pkg',
  fileName: 'mindshub-cowork-2.260810.1-stable-9021d7b7.pkg',
  channel: 'stable',
};

describe('installerVersionFromFileName', () => {
  it('reads a released version on both platforms', () => {
    expect(installerVersionFromFileName('mindshub-cowork-2.26.8.10.1.pkg', 'prod')).toBe(
      '2.26.8.10.1',
    );
    expect(installerVersionFromFileName('mindshub-cowork-2.26.8.10.1.exe', 'prod')).toBe(
      '2.26.8.10.1',
    );
  });

  it('reads a stable build identifier, channel and commit included', () => {
    expect(
      installerVersionFromFileName('mindshub-cowork-2.260810.1-stable-9021d7b7.pkg', 'stable'),
    ).toBe('2.260810.1-stable-9021d7b7');
  });

  it('will not publish a build on the wrong channel, in either direction', () => {
    expect(() =>
      installerVersionFromFileName('mindshub-cowork-2.0.1-stable-abc1234.pkg', 'prod'),
    ).toThrow(/Not a prod installer/);
    expect(() => installerVersionFromFileName('mindshub-cowork-2.26.8.10.1.pkg', 'stable')).toThrow(
      /Not a stable installer/,
    );
  });

  it('rejects preview builds, which get no manifest at all', () => {
    expect(() =>
      installerVersionFromFileName('mindshub-cowork-2.0.1-preview-abc1234.pkg', 'prod'),
    ).toThrow(/Not a prod installer/);
    expect(() =>
      installerVersionFromFileName('mindshub-cowork-2.0.1-preview-abc1234.pkg', 'preview'),
    ).toThrow(/No manifest is published for the preview channel/);
  });

  it('rejects the mutable aliases, which sit at the same prefix under a fixed name', () => {
    expect(() => installerVersionFromFileName('mindshub-cowork-latest.pkg', 'prod')).toThrow(
      /latest alias/,
    );
  });

  it('rejects anything that is not an installer file name', () => {
    expect(() => installerVersionFromFileName('latest.json', 'prod')).toThrow(
      /Not a prod installer/,
    );
    expect(() => installerVersionFromFileName('mindshub-cowork-2.0.1.zip', 'prod')).toThrow(
      /Not a prod installer/,
    );
  });
});

describe('downloadManifest', () => {
  it('carries exactly the six published fields', () => {
    expect(Object.keys(downloadManifest(PROD)).sort()).toEqual([
      'key',
      'published_at',
      'sha256',
      'size_bytes',
      'url',
      'version',
    ]);
  });

  it('describes a prod release', () => {
    const manifest = downloadManifest(PROD);
    expect(manifest.version).toBe('2.26.8.10.1');
    expect(manifest.key).toBe(PROD.key);
    expect(manifest.url).toBe(`https://downloads.mindshub.ai/${PROD.key}`);
    expect(manifest.size_bytes).toBe(220393119);
    expect(manifest.sha256).toBe(PROD.sha256);
    expect(manifest.published_at).toBe('2026-08-12T04:00:00.000Z');
  });

  it('describes a stable snapshot, whose key sits a directory deeper', () => {
    const manifest = downloadManifest(STABLE);
    expect(manifest.version).toBe('2.260810.1-stable-9021d7b7');
    expect(manifest.url).toBe(`https://downloads.mindshub.ai/${STABLE.key}`);
  });

  it('puts windows installers under the windows prefix', () => {
    const manifest = downloadManifest({
      ...PROD,
      key: 'mindshub-cowork/windows/mindshub-cowork-2.26.8.10.1.exe',
      fileName: 'mindshub-cowork-2.26.8.10.1.exe',
    });
    expect(manifest.url).toBe(
      'https://downloads.mindshub.ai/mindshub-cowork/windows/mindshub-cowork-2.26.8.10.1.exe',
    );
  });

  it('the url is the cdn base joined to the key, with no doubled slash', () => {
    const manifest = downloadManifest({ ...PROD, cdnBase: 'https://downloads.mindshub.ai/' });
    expect(manifest.url).toBe(`https://downloads.mindshub.ai/${manifest.key}`);
  });

  it('refuses a key that names a different file than the artifact', () => {
    expect(() =>
      downloadManifest({ ...PROD, key: 'mindshub-cowork/mac/mindshub-cowork-9.9.9.9.9.pkg' }),
    ).toThrow(/names a different file/);
  });

  it('refuses a key outside the published prefixes', () => {
    expect(() =>
      downloadManifest({ ...PROD, key: `mindshub-cowork/linux/${PROD.fileName}` }),
    ).toThrow(/Not an installer key/);
    expect(() =>
      downloadManifest({ ...PROD, key: `mindshub-cowork/mac/previews/${PROD.fileName}` }),
    ).toThrow(/Not an installer key/);
  });

  it('rejects a non-https cdn base, which would advertise a downgradeable download', () => {
    expect(() => downloadManifest({ ...PROD, cdnBase: 'http://downloads.mindshub.ai' })).toThrow(
      /https origin/,
    );
  });

  it('rejects a size that is not a positive whole number of bytes', () => {
    expect(() => downloadManifest({ ...PROD, sizeBytes: 0 })).toThrow(/positive integer/);
    expect(() => downloadManifest({ ...PROD, sizeBytes: -1 })).toThrow(/positive integer/);
    expect(() => downloadManifest({ ...PROD, sizeBytes: 1.5 })).toThrow(/positive integer/);
  });

  it('rejects a digest that is not lowercase hex sha256', () => {
    expect(() => downloadManifest({ ...PROD, sha256: 'not-a-digest' })).toThrow(/sha256/);
    expect(() => downloadManifest({ ...PROD, sha256: PROD.sha256.toUpperCase() })).toThrow(/sha256/);
    expect(() => downloadManifest({ ...PROD, sha256: PROD.sha256.slice(0, 63) })).toThrow(/sha256/);
  });

  it('rejects a published_at that is not a real timestamp', () => {
    expect(() => downloadManifest({ ...PROD, publishedAt: 'yesterday' })).toThrow(/ISO-8601/);
  });
});
