import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard for the class of bug behind PR #528 (silent OTA analytics
// outage): the desktop renderer is built by more than one CI workflow, and one
// of them (the OTA bundle, publish-ui.yml) drifted out of sync with the
// installer builds — it stopped injecting a VITE_* build var, so the shipped
// bundle silently lost that value with no test/build failure.
//
// Rather than assert one named var, this enforces PARITY: every workflow that
// bakes VITE_* build vars into the renderer must bake the SAME set. Drift in
// either direction (a var added to one build but not another, or dropped from
// one) fails here — for any variable, present or future. A small documented
// contract list additionally catches a var being dropped from *every* build at
// once (which parity alone would see as "consistently absent").
//
// Detection is natural: the desktop builds inject via a step `env:` block,
// while the web/Docker build (Dockerfile.frontend) injects via build-args on
// the `build-push-ecr` action's `with:` — so keying on step-env VITE_*
// injection scopes this to the desktop renderer profile and leaves the web
// build (a legitimately different var profile, tracked in ENG-1163) alone.

// The renderer build-var contract: every VITE_* var the desktop builds inject.
// Update this deliberately when the renderer's build-time inputs change — the
// parity check below then guarantees the change lands in every build.
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

// VITE_* vars injected via a step `env:` — a `VITE_FOO: <value>` line. The
// trailing `\S` requires a value, so the reusable-workflow `secrets:`
// DECLARATION form (`VITE_...:` with nothing after the colon) is not counted.
const injectedViteVars = (text: string): Set<string> =>
  new Set([...text.matchAll(/^[ \t]+(VITE_[A-Z0-9_]+):[ \t]+\S/gm)].map((m) => m[1]));

const rendererBuilds = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((file) => ({ file, vars: injectedViteVars(read(file)) }))
  .filter((w) => w.vars.size > 0);

describe('renderer-build workflows carry the same VITE_ build vars (regression: PR #528)', () => {
  // Guards against a path/detection regression silently emptying `rendererBuilds`
  // and making the parity check pass vacuously.
  it('detects the desktop renderer-build workflows', () => {
    const detected = rendererBuilds.map((w) => w.file).sort();
    expect(detected).toEqual(
      ['build-macos-pkg.yml', 'build-windows-installer.yml', 'publish-ui.yml'].sort(),
    );
  });

  // The general guard: no drift between builds — every build injects the union.
  it('every renderer build injects the same set of VITE_ vars (no drift)', () => {
    const union = new Set(rendererBuilds.flatMap((w) => [...w.vars]));
    const drift = rendererBuilds
      .map((w) => ({ file: w.file, missing: [...union].filter((v) => !w.vars.has(v)).sort() }))
      .filter((w) => w.missing.length > 0);
    expect(drift).toEqual([]); // failure shows exactly which build is missing which var(s)
  });

  // The contract: the shared set is the documented one — catches a var dropped
  // from every build at once, and forces an intentional update when it changes.
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
    // The `secrets:` declaration form (no value) is not an injection.
    expect(injectedViteVars('    secrets:\n      VITE_FOO:\n        required: false').size).toBe(0);
  });
});
