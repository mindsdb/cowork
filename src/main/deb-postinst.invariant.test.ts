import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: our deb postinst silently disabled Electron's own Linux
// install steps.
//
// `deb.afterInstall` does not ADD a maintainer script — electron-builder passes
// exactly one `--after-install` to fpm, and naming our own file REPLACES the
// stock after-install.tpl. Pointing it at a script that only staged credentials
// therefore dropped the /usr/bin symlink, the chrome-sandbox mode Electron needs
// in order to start at all, the AppArmor profile Ubuntu 24 wants, and both
// desktop-database updates. The deb still built, so CI saw nothing; it only
// surfaces on an installed machine.
//
// The fix is to carry upstream's script verbatim and append to it, which is
// only safe while the copy stays in step. Upstream added the AppArmor block in
// a recent release; without this test the next such addition is lost in the
// same silent way.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const POSTINST = path.join(REPO, 'build/deb-scripts/postinst.sh');
const TEMPLATE = path.join(
  REPO,
  'node_modules/app-builder-lib/templates/linux/after-install.tpl',
);

/** Macros electron-builder defines for maintainer scripts; anything else throws at build time. */
const DEFINED_MACROS = ['executable', 'sanitizedProductName', 'productFilename'];
const MACRO = /\$\{([a-zA-Z]+)\}/g;

const postinst = (): string => readFileSync(POSTINST, 'utf8');

describe('the deb postinst carries electron-builder\'s own install steps', () => {
  // Anti-vacuous: a moved template would otherwise make every assertion below
  // pass against an empty string.
  it('finds the upstream after-install template', () => {
    expect(
      existsSync(TEMPLATE),
      `upstream template not at ${path.relative(REPO, TEMPLATE)} — electron-builder may have moved it; re-sync the postinst by hand`,
    ).toBe(true);
    expect(readFileSync(TEMPLATE, 'utf8').length).toBeGreaterThan(500);
  });

  // THE regression. A prefix check, so an upstream edit anywhere fails.
  it('begins with the upstream template, byte for byte', () => {
    const template = readFileSync(TEMPLATE, 'utf8');
    expect(
      postinst().startsWith(template),
      'build/deb-scripts/postinst.sh no longer starts with electron-builder\'s after-install.tpl. '
        + 'Upstream changed it (check the diff for a NEW step, e.g. the AppArmor block added recently): '
        + 're-copy the template and re-append the MindsHub block below it.',
    ).toBe(true);
  });

  // The other direction: keeping them identical would "fix" the test above by
  // dropping the credential staging the script exists for.
  it('appends the credential staging after that, not instead of it', () => {
    const template = readFileSync(TEMPLATE, 'utf8');
    const ours = postinst().slice(template.length);
    expect(ours).toMatch(/stage_cowork_credentials/);
    expect(ours).toMatch(/server-credentials\.json/);
  });

  // Our early exits must end the block, never the steps above it.
  it('runs the staging last and in a subshell', () => {
    const text = postinst();
    expect(text).toMatch(/stage_cowork_credentials\(\)\s*\(/); // `name() (` = subshell body
    expect(text.trimEnd().endsWith('stage_cowork_credentials || true')).toBe(true);
  });

  // electron-builder text-substitutes macros over this file and THROWS on an
  // unknown one — comments included. A stray shell reference fails the build.
  it('uses no macro electron-builder cannot resolve', () => {
    const used = [...postinst().matchAll(MACRO)].map((m) => m[1]);
    const unknown = [...new Set(used)].filter((name) => !DEFINED_MACROS.includes(name)).sort();
    expect(unknown, `undefined macro(s) would fail the build: ${unknown.join(', ')}`).toEqual([]);
  });
});
