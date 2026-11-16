import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { MAC_MINIMUM_DARWIN_VERSION, updateMetadataYaml } from '../../scripts/update-metadata.mjs';

// Resolve semver from electron-updater's own package so the check below is the
// comparison AppUpdater.checkIfUpdateSupported makes: semver.lt(os.release(), min).
const localRequire = createRequire(import.meta.url);
const semver = createRequire(localRequire.resolve('electron-updater'))('semver') as {
  lt(a: string, b: string): boolean;
};

const base = {
  name: 'app.zip',
  sha512: 'abc',
  size: 10,
  version: '2.26.10.30.1',
  releaseDate: '2026-10-30T00:00:00.000Z',
};

function minimumFrom(yaml: string): string | null {
  return /^minimumSystemVersion: "(.+)"$/m.exec(yaml)?.[1] ?? null;
}

describe('update metadata', () => {
  it('pins macOS 13 as Darwin 22.0.0', () => {
    expect(MAC_MINIMUM_DARWIN_VERSION).toBe('22.0.0');
  });

  it('writes the minimum into latest-mac.yml only', () => {
    expect(minimumFrom(updateMetadataYaml({ platform: 'mac', ...base }))).toBe('22.0.0');
    expect(minimumFrom(updateMetadataYaml({ platform: 'windows', ...base }))).toBeNull();
  });

  it('keeps the existing fields', () => {
    expect(updateMetadataYaml({ platform: 'windows', ...base })).toBe(
      [
        'version: "2.26.10.30.1"',
        'files:',
        '  - url: "app.zip"',
        '    sha512: "abc"',
        '    size: 10',
        'path: "app.zip"',
        'sha512: "abc"',
        'releaseDate: "2026-10-30T00:00:00.000Z"',
        '',
      ].join('\n'),
    );
  });

  it('makes electron-updater skip the update on macOS 12 only', () => {
    const min = minimumFrom(updateMetadataYaml({ platform: 'mac', ...base }))!;
    const skips = (darwinRelease: string) => semver.lt(darwinRelease, min);
    expect(skips('21.6.0')).toBe(true); // macOS 12
    expect(skips('22.0.0')).toBe(false); // macOS 13
    expect(skips('24.1.0')).toBe(false); // macOS 15
    expect(skips('25.0.0')).toBe(false); // macOS 26
  });

  it('documents why a marketing version cannot be used', () => {
    // electron-updater swallows this error and allows the update.
    expect(() => semver.lt('21.6.0', '13.0')).toThrow();
  });
});
