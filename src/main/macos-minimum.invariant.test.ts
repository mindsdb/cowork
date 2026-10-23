import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MAC_MINIMUM_DARWIN_VERSION } from '../../scripts/update-metadata.mjs';
import { MIN_MACOS_FOR_LATEST_SHELL } from '../shared/shell-support';

// The macOS minimum lives in four places that use two formats: the app's
// LSMinimumSystemVersion and the .pkg take the macOS version, the update feed
// takes the Darwin version, and the UI decides who sees the macOS notice from
// the macOS major. Hand-parsed like the other invariant tests: js-yaml
// is only a transitive dependency.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILDER = readFileSync(path.join(REPO, 'electron-builder.yml'), 'utf8');
const PKG_SCRIPT = readFileSync(path.join(REPO, 'scripts/release-mac-pkg-notarized.sh'), 'utf8');

// Since macOS 26 the "macOS + 9" rule no longer holds, so map explicitly.
const DARWIN_MAJOR_FOR_MACOS: Record<number, number> = { 13: 22, 14: 23, 15: 24, 26: 25 };

describe('macOS minimum', () => {
  const builderMin = /^\s+minimumSystemVersion:\s*"([\d.]+)"/m.exec(BUILDER)?.[1];
  const pkgMin = /^MAC_MINIMUM_MACOS="([\d.]+)"$/m.exec(PKG_SCRIPT)?.[1];

  it('is declared for the app bundle and the .pkg', () => {
    expect(builderMin).toBe('13.0');
    expect(pkgMin).toBe(builderMin);
  });

  it('is what the .pkg distribution actually receives', () => {
    expect(PKG_SCRIPT).toContain('<os-version min=\\"${MAC_MINIMUM_MACOS}\\"/>');
  });

  it('matches the Darwin version in the update feed', () => {
    const macosMajor = Number(builderMin!.split('.')[0]);
    const darwinMajor = DARWIN_MAJOR_FOR_MACOS[macosMajor];
    expect(darwinMajor, `add macOS ${macosMajor} to DARWIN_MAJOR_FOR_MACOS`).toBeDefined();
    expect(MAC_MINIMUM_DARWIN_VERSION).toBe(`${darwinMajor}.0.0`);
  });

  it('matches the macOS major the UI uses to cap shells', () => {
    expect(MIN_MACOS_FOR_LATEST_SHELL).toBe(Number(builderMin!.split('.')[0]));
  });
});
