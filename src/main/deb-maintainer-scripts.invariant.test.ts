import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Custom deb hooks replace electron-builder's maintainer templates rather than extending them.
// Keep the upstream script intact before appending credential work so symlinks, sandbox
// permissions, AppArmor and desktop updates survive.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATES = path.join(REPO, 'node_modules/app-builder-lib/templates/linux');

/**
 * Check both overridden hooks: postrm must retain upstream alternative and AppArmor cleanup just as
 * postinst retains installation.
 */
const SCRIPTS = [
  { name: 'postinst', ours: 'build/deb-scripts/postinst.sh', upstream: 'after-install.tpl', block: 'stage_cowork_credentials' },
  { name: 'postrm', ours: 'build/deb-scripts/postrm.sh', upstream: 'after-remove.tpl', block: 'cleanup_cowork_credentials' },
] as const;

/** Macros electron-builder defines for maintainer scripts; anything else throws at build time. */
const DEFINED_MACROS = ['executable', 'sanitizedProductName', 'productFilename'];
const MACRO = /\$\{([a-zA-Z]+)\}/g;

const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

for (const script of SCRIPTS) {
  const TEMPLATE = path.join(TEMPLATES, script.upstream);
  const ours = (): string => read(script.ours);

  describe(`the deb ${script.name} carries electron-builder's own steps`, () => {
    // Anti-vacuous: a moved template would otherwise make every assertion below
    // pass against an empty string.
    it('finds the upstream template', () => {
      expect(
        existsSync(TEMPLATE),
        `upstream ${script.upstream} not found — electron-builder may have moved it; re-sync ${script.ours} by hand`,
      ).toBe(true);
      expect(readFileSync(TEMPLATE, 'utf8').length).toBeGreaterThan(300);
    });

    // THE regression. A prefix check, so an upstream edit anywhere fails.
    it('begins with the upstream template, byte for byte', () => {
      expect(
        ours().startsWith(readFileSync(TEMPLATE, 'utf8')),
        `${script.ours} no longer starts with electron-builder's ${script.upstream}. `
          + 'Upstream changed it (check the diff for a NEW step): re-copy the template '
          + 'and re-append the MindsHub block below it.',
      ).toBe(true);
    });

    // The other direction: keeping them identical would "fix" the test above by
    // dropping the block the script exists for.
    it('appends our block after that, not instead of it', () => {
      const appended = ours().slice(readFileSync(TEMPLATE, 'utf8').length);
      expect(appended).toMatch(new RegExp(script.block));
      expect(appended).toMatch(/server-credentials\.json/);
    });

    // Our early exits must end the block, never the steps above it.
    it('runs our block last and in a subshell', () => {
      expect(ours()).toMatch(new RegExp(`${script.block}\\(\\)\\s*\\(`));
      expect(ours()).toMatch(new RegExp(`${script.block} \\|\\| true`));
    });

    // Best-effort cleanup must preserve an earlier upstream failure; a final || true would mask it
    // from dpkg.
    it("reports the upstream steps' exit status, not our block's", () => {
      const appended = ours().slice(readFileSync(TEMPLATE, 'utf8').length);
      const firstStatement = appended.split('\n').map((l) => l.trim())
        .find((l) => l && !l.startsWith('#'));
      expect(firstStatement).toBe('upstream_status=$?');
      expect(ours().trimEnd().endsWith('exit "$upstream_status"')).toBe(true);
    });

    // electron-builder text-substitutes macros over these files and THROWS on
    // an unknown one — comments included. A stray shell reference fails the build.
    it('uses no macro electron-builder cannot resolve', () => {
      const used = [...ours().matchAll(MACRO)].map((m) => m[1]);
      const unknown = [...new Set(used)].filter((n) => !DEFINED_MACROS.includes(n)).sort();
      expect(unknown, `undefined macro(s) would fail the build: ${unknown.join(', ')}`).toEqual([]);
    });
  });
}
