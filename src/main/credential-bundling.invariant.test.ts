import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: the Linux deb shipped with no OAuth credentials at all.
//
// `getCandidateStagingPaths()` returned a `process.resourcesPath` location for
// EVERY non-darwin platform, but electron-builder.yml declared the matching
// `extraResources` entry only under `win:`. So the file the CI job faithfully
// generated was never packaged into the .deb, the runtime lookup found nothing,
// and `provisionCredentialsFromStaging()` took its deliberately-silent
// "nothing staged" return. Every OAuth connector was dead on Linux with no log
// line, and no unit test could see it — the defect lived entirely in the seam
// between build config and runtime path resolution.
//
// So this asserts that seam: every platform whose runtime reads a staged file
// has a build that actually produces one, and the platforms that must NOT
// carry plaintext secrets in their payload still don't.
//
// Deliberately hand-parsed: js-yaml is only present transitively (via
// electron-builder) and could disappear on any bump, which is not a dependency
// this guard should own — matching minds-urls.workflows.test.ts.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = readFileSync(path.join(REPO, 'electron-builder.yml'), 'utf8');

const STAGED_FILE = 'server-credentials.json';

/**
 * The lines belonging to one top-level key, which in this file is any key at
 * column 0. Full-line comments are dropped so prose mentioning the filename
 * (there is plenty) can never satisfy an assertion.
 */
function topLevelBlock(text: string, key: string): string {
  const lines = text.split('\n').filter((line) => !/^\s*#/.test(line));
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const nextTopLevel = rest.findIndex((line) => /^\S/.test(line));
  return [lines[start], ...(nextTopLevel === -1 ? rest : rest.slice(0, nextTopLevel))].join('\n');
}

const bundlesStagedFile = (block: string): boolean => block.includes(STAGED_FILE);

describe('staged-credential bundling matches what the runtime looks for', () => {
  // Guards every assertion below against a silent vacuous pass if a key is
  // ever renamed: an absent block is '' and would trivially "not bundle".
  it('finds every electron-builder block it asserts on', () => {
    for (const key of ['mac', 'win', 'linux', 'deb', 'extraResources']) {
      expect(topLevelBlock(CONFIG, key), `no top-level "${key}:" block found`).not.toBe('');
    }
  });

  // THE regression. Windows was fine; Linux silently was not.
  it('bundles the staged file for every platform that reads one from resourcesPath', () => {
    const missing = ['win', 'linux'].filter((p) => !bundlesStagedFile(topLevelBlock(CONFIG, p)));
    expect(missing).toEqual([]);
  });

  // ENG-1241: Contents/Resources is root-owned, so a copy left inside the
  // signed bundle could never be cleaned up. macOS stages via pkgbuild
  // --scripts instead, and must never carry the file in its payload.
  it('never bundles the staged file into the macOS app payload', () => {
    expect(bundlesStagedFile(topLevelBlock(CONFIG, 'mac'))).toBe(false);
  });

  // The root-level list is additive across ALL platforms, so an entry here
  // would put plaintext secrets back inside the signed macOS bundle — the
  // exact thing the per-platform overrides exist to avoid.
  it('never bundles the staged file via the root-level extraResources', () => {
    expect(bundlesStagedFile(topLevelBlock(CONFIG, 'extraResources'))).toBe(false);
  });

  // A .deb unpacks into root-owned /opt, so the app cannot delete the file
  // itself. Without a postinst to stage a user-owned copy and remove the
  // /opt one, the plaintext secrets persist world-readable forever and every
  // launch logs a failed cleanup.
  it('gives the deb a postinst to stage the file out of root-owned /opt', () => {
    const deb = topLevelBlock(CONFIG, 'deb');
    const afterInstall = deb.match(/^\s*afterInstall:\s*(\S+)\s*$/m);
    expect(afterInstall, 'deb.afterInstall is not declared').not.toBeNull();

    const script = path.join(REPO, afterInstall![1]);
    expect(existsSync(script), `deb.afterInstall points at a missing file: ${afterInstall![1]}`).toBe(true);
    // fpm copies the script's mode into the package's control archive; a
    // non-executable postinst is skipped by dpkg without failing the install.
    expect(statSync(script).mode & 0o111, `${afterInstall![1]} is not executable`).not.toBe(0);
  });

  // Self-check: prove the parser isolates blocks and ignores comment prose,
  // independent of the real file.
  it('scopes to one block and does not read full-line comments as config', () => {
    const sample = ['mac:', '  # mentions server-credentials.json in prose', '  icon: a.png', 'win:', '  x: 1'].join(
      '\n',
    );
    expect(bundlesStagedFile(topLevelBlock(sample, 'mac'))).toBe(false);
    expect(topLevelBlock(sample, 'mac')).not.toContain('x: 1');
    expect(topLevelBlock(sample, 'absent')).toBe('');
  });
});
