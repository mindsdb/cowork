/*
 * SheetJS comes from a tarball checked into vendor/, downloaded from
 * https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz. The npm registry's xlsx
 * stops at 0.18.5, which carries two high advisories, and a self-contained
 * deployment's build reaches only the npm registry, not cdn.sheetjs.com.
 *
 * These tests fail when the tarball's bytes change, and when the lock resolves
 * any xlsx from a registry, whether directly or through another package.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const TARBALL = 'vendor/xlsx-0.20.3.tgz';
const TARBALL_SHA256 = '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8';
const TARBALL_SPEC = `file:${TARBALL}`;

interface LockPackage {
  name?: string;
  version?: string;
  resolved?: string;
}

interface PackageLock {
  packages: Record<string, LockPackage>;
}

interface PackageManifest {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as T;
}

/* Every lock entry that installs xlsx, under its own name or an alias. */
function xlsxEntries(lock: PackageLock): [string, LockPackage][] {
  return Object.entries(lock.packages).filter(
    ([key, entry]) => key === 'node_modules/xlsx' || key.endsWith('/node_modules/xlsx') || entry.name === 'xlsx',
  );
}

describe('vendored SheetJS', () => {
  it('matches the recorded sha256', () => {
    const digest = createHash('sha256').update(readFileSync(join(REPO_ROOT, TARBALL))).digest('hex');
    expect(digest).toBe(TARBALL_SHA256);
  });

  it('is what package.json installs as xlsx', () => {
    const manifest = readJson<PackageManifest>('package.json');
    expect(manifest.devDependencies?.xlsx).toBe(TARBALL_SPEC);
    expect(manifest.dependencies?.xlsx).toBeUndefined();
  });

  it('is the only xlsx the lock resolves', () => {
    const entries = xlsxEntries(readJson<PackageLock>('package-lock.json'));
    expect(entries.map(([key]) => key)).toEqual(['node_modules/xlsx']);
    for (const [, entry] of entries) {
      expect(entry.resolved).toBe(TARBALL_SPEC);
      expect(entry.version).toBe('0.20.3');
    }
  });

  it('resolves no xlsx from a registry, 0.18.5 included', () => {
    const lock = readJson<PackageLock>('package-lock.json');
    const fromRegistry = Object.entries(lock.packages)
      .filter(([, entry]) => /\/xlsx\/-\/xlsx-[^/]+\.tgz$/.test(entry.resolved ?? ''))
      .map(([key]) => key);
    expect(fromRegistry).toEqual([]);
    expect(xlsxEntries(lock).filter(([, entry]) => entry.version === '0.18.5')).toEqual([]);
  });
});
