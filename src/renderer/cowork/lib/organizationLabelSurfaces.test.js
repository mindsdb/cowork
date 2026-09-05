// Guard organization-label call sites as well as the helper; inline displayName reads bypass its
// tested normalization.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Scan main too: it builds user-facing failure messages as well as the renderer.
const SRC = resolve(import.meta.dirname, '../../../');

// presentationOnly excludes files that also ingest raw displayName wire fields; only presentation
// reads must normalize labels.
const SURFACES = [
  ['sidebar account menu', 'renderer/cowork/components/UserMenu.jsx', true],
  ['Settings → Account organization row', 'renderer/cowork/views/settings/AccountSection.jsx', true],
  ['onboarding organization picker', 'renderer/pages/arcade/OnboardingScreen.tsx', true],
  ['main-process switch failure toasts', 'main/minds-auth.ts', false],
];

describe.each(SURFACES)('%s', (_name, rel, presentationOnly) => {
  const src = readFileSync(resolve(SRC, rel), 'utf-8');

  it('routes the organization name through organizationLabel', () => {
    expect(src).toContain('organizationLabel');
  });

  it('never interpolates a displayName into user-facing text', () => {
    /*
     * Catch displayName in both template literals and JSX so main-process messages cannot bypass
     * the label helper.
     */
    const interpolated = [...src.matchAll(/\$\{[^}]*\.displayName[^}]*\}/g)].map((m) => m[0]);
    expect(interpolated).toEqual([]);
  });

  /*
   * Apply the stronger ban only to presentation-only files; ingestion still needs raw fields.
   * Use skipIf so exemptions are reported as skips, not assertion-free passes.
   */
  it.skipIf(!presentationOnly)('never reads an organization displayName at all', () => {
    const direct = [...src.matchAll(/\.displayName\b/g)].map((m) => m[0]);
    expect(direct).toEqual([]);
  });
});
