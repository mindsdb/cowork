import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Require identical VITE_* inputs across desktop installer and OTA workflows, plus the contract
// list to detect omissions from every build.
// Web/Docker uses a separate build-arg profile.

// The renderer build-var contract. Update deliberately when the renderer's
// build-time inputs change; the parity check then enforces it everywhere.
const EXPECTED_RENDERER_BUILD_VARS = [
  'VITE_APP_VERSION', // → __APP_VERSION__; fallback: git describe / package.json
  'VITE_MINDS_API_URL', // API/auth base; fallback: prod (mindsUrls.ts)
  'VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN', // analytics; NO fallback — silent if missing
].sort();

const WORKFLOWS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows',
);

const read = (file: string): string => readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');

// Require a nonempty step-env value so reusable-workflow secret declarations do not count as
// injected variables.
const injectedViteVars = (text: string): Set<string> =>
  new Set([...text.matchAll(/^[ \t]+(VITE_[A-Z0-9_]+):[ \t]+\S/gm)].map((m) => m[1]));

const rendererBuilds = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((file) => ({ file, vars: injectedViteVars(read(file)) }))
  .filter((w) => w.vars.size > 0);

describe('renderer-build workflows carry the same VITE_ build vars (regression: PR #528)', () => {
  // Guards against detection silently emptying the list (vacuous parity pass).
  it('detects the desktop renderer-build workflows', () => {
    const detected = rendererBuilds.map((w) => w.file).sort();
    expect(detected).toEqual(
      ['build-linux-deb.yml', 'build-macos-pkg.yml', 'build-windows-installer.yml', 'publish-ui.yml'].sort(),
    );
  });

  // The general guard: every build injects the union — no drift.
  it('every renderer build injects the same set of VITE_ vars (no drift)', () => {
    const union = new Set(rendererBuilds.flatMap((w) => [...w.vars]));
    const drift = rendererBuilds
      .map((w) => ({ file: w.file, missing: [...union].filter((v) => !w.vars.has(v)).sort() }))
      .filter((w) => w.missing.length > 0);
    expect(drift).toEqual([]); // failure shows exactly which build is missing which var(s)
  });

  // Catches a var dropped from every build at once, and forces an intentional
  // update when the contract changes.
  it('the shared VITE_ set matches the documented contract', () => {
    const union = [...new Set(rendererBuilds.flatMap((w) => [...w.vars]))].sort();
    expect(union).toEqual(EXPECTED_RENDERER_BUILD_VARS);
  });

  // Self-checks: prove the guard has teeth, independent of the real files.
  it('detects drift and does not count a secrets declaration as an injection', () => {
    const withVar = injectedViteVars('    env:\n      VITE_FOO: ${{ inputs.foo }}');
    const withoutVar = injectedViteVars('    env:\n      VITE_BAR: ${{ inputs.bar }}');
    // A build missing VITE_FOO relative to the union is flagged.
    const union = new Set([...withVar, ...withoutVar, 'VITE_FOO']);
    expect([...union].filter((v) => !withoutVar.has(v)).sort()).toEqual(['VITE_FOO']);
    // A `secrets:` declaration (no value) is not an injection.
    expect(injectedViteVars('    secrets:\n      VITE_FOO:\n        required: false').size).toBe(0);
  });
});
