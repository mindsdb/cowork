import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard for PR #528: the desktop renderer is built by several CI
// workflows, and the OTA bundle (publish-ui.yml) drifted from the installers —
// it dropped a VITE_* var, silently gutting the shipped bundle with no failure.
//
// Enforces PARITY: every workflow that bakes VITE_* vars into the renderer must
// bake the SAME set, so any drift fails (for any var). The contract list also
// catches a var dropped from every build at once. Scoped to the desktop builds
// by keying on step-`env:` injection; the web/Docker build passes build-args
// via `build-push-ecr` (a different profile, tracked in ENG-1163).

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

// VITE_* vars injected via a step `env:`. The trailing `\S` requires a value,
// so a reusable-workflow `secrets:` declaration (`VITE_...:` with nothing after
// the colon) is not counted.
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
      ['build-macos-pkg.yml', 'build-windows-installer.yml', 'publish-ui.yml'].sort(),
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
