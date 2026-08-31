import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: a PR platform that is not label-gated publishes on every push.
//
// The upload jobs in build-installers.yml carry no `if:` of their own — they
// only `needs:` their build — so a platform's label gate is what stops the
// upload too. `upload-installer-to-s3.yml` runs on `mdb-prod` and writes a
// preview build into `previews/` in the production installer bucket, then the
// PR comment posts its public CloudFront URL. Leaving linux ungated therefore
// published two downloadable debs from the prod bucket on every internal push,
// which reads as a build-cost question and is not one.
//
// An earlier version of this file's gate also looked for a label name that did
// not exist (`linux-deb` vs `build-linux-deb`), so the job silently never ran.
// Both failures are invisible in a green CI run, hence a test.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CALLER = path.join(REPO, '.github/workflows/dev-build-deploy.yml');
const ORCHESTRATOR = path.join(REPO, '.github/workflows/build-installers.yml');

/** Every platform toggle build-installers.yml accepts. */
const platformInputs = (): string[] => {
  const text = readFileSync(ORCHESTRATOR, 'utf8');
  const inputs = text.slice(text.indexOf('inputs:'), text.indexOf('outputs:'));
  // Intermediate lines must be nested deeper, or a lazy match runs past the
  // next key and silently skips the input in between.
  return [...inputs.matchAll(/^ {6}(\w+):\n(?: {8}.*\n)*? {8}type: boolean/gm)].map((m) => m[1]).sort();
};

/** What the PR caller passes for each of them. */
const callerBlock = (): string => {
  const text = readFileSync(CALLER, 'utf8');
  const start = text.indexOf('  build-installers:');
  return text.slice(start, text.indexOf('secrets: inherit', start));
};

describe('every PR installer platform is gated by a label', () => {
  // Anti-vacuous: an empty list would pass the assertion below trivially.
  it('finds the platform toggles', () => {
    expect(platformInputs()).toEqual(['linux_amd64', 'linux_arm64', 'macos', 'windows']);
  });

  // THE regression: an omitted input inherits `default: true` and publishes.
  it('passes a label-derived value for each, never relying on the default', () => {
    const block = callerBlock();
    const ungated = platformInputs().filter(
      (name) => !new RegExp(`^\\s*${name}:\\s*\\$\\{\\{\\s*contains\\(`, 'm').test(block),
    );
    expect(
      ungated,
      'these inherit default:true, so a PR push builds AND publishes them from the prod bucket',
    ).toEqual([]);
  });

  // The job itself must still skip when no installer was asked for, or the
  // reusable workflow spins up only to skip every job inside it.
  it('skips the whole job unless some installer label is present', () => {
    const text = readFileSync(CALLER, 'utf8');
    const gate = text.slice(text.indexOf('  build-installers:'), text.indexOf('uses:', text.indexOf('  build-installers:')));
    for (const label of ['signed-macos-pkg', 'signed-windows-ev', 'build-linux-deb']) {
      expect(gate, `job-level if: does not mention ${label}`).toContain(label);
    }
  });

  // Every label the caller names must be spelled the same in both places, so a
  // typo cannot leave a platform permanently unbuilt.
  it('uses the same label names in the job gate and the inputs', () => {
    const block = callerBlock();
    const inGate = new Set([...block.matchAll(/labels\.\*\.name,\s*'([^']+)'/g)].map((m) => m[1]));
    expect([...inGate].sort()).toEqual(['build-linux-deb', 'signed-macos-pkg', 'signed-windows-ev']);
  });
});
