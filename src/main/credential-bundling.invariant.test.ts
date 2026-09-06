import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Check the build/runtime seam: every platform that reads staged credentials must package them,
// while macOS must exclude plaintext from its signed bundle.
// Hand-parse config rather than depend on electron-builder's transitive js-yaml dependency.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = readFileSync(path.join(REPO, 'electron-builder.yml'), 'utf8');

const STAGED_FILE = 'server-credentials.json';

/**
 * Read one column-zero YAML section, excluding comment-only lines so prose cannot satisfy packaging
 * assertions.
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

  it('bundles the staged file for every platform that reads one from resourcesPath', () => {
    const missing = ['win', 'linux'].filter((p) => !bundlesStagedFile(topLevelBlock(CONFIG, p)));
    expect(missing).toEqual([]);
  });

  // macOS stages through pkgbuild scripts; a root-owned signed-bundle copy cannot be cleaned up by
  // the app.
  it('never bundles the staged file into the macOS app payload', () => {
    expect(bundlesStagedFile(topLevelBlock(CONFIG, 'mac'))).toBe(false);
  });

  // Root-level extraResources applies to every platform and would reintroduce plaintext into the
  // signed macOS bundle.
  it('never bundles the staged file via the root-level extraResources', () => {
    expect(bundlesStagedFile(topLevelBlock(CONFIG, 'extraResources'))).toBe(false);
  });

  // The app cannot delete root-owned /opt credentials; postinst must stage a user-owned copy and
  // remove the original.
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
