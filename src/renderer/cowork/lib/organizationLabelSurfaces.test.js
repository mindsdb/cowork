// Every surface that names an organization must route through
// `organizationLabel`.
//
// The helper is unit-tested in shared/minds-orgs.test.ts, and those tests
// passed throughout ENG-2109: the account menu and the Settings row read
// `org.displayName` inline instead of asking. A test of the label function
// cannot catch a caller that never calls it — and each new surface is a new
// caller, which is how the onboarding screen ended up with the same defect
// nobody had reported yet.
//
// So this asserts the wiring. Source inspection, because the alternative is
// mounting four component trees to observe one import — the same tradeoff
// artifactSurfaces.test.js makes for the artifact gate.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `src/`, not `src/renderer/`. The first version of this file walked only the
// renderer, and that is exactly how the switch-failure toasts in
// `main/minds-auth.ts` kept saying `<email>'s organization` after every
// renderer surface had stopped -- caught in review, not by this guard. The
// main process builds user-facing text too, so a guard scoped to one process
// is a guard with a hole in it.
const SRC = resolve(import.meta.dirname, '../../../');

// `presentationOnly` says whether EVERY `.displayName` read in the file is a
// label. True for the renderer surfaces, which only render. False for
// `minds-auth.ts`, which also *ingests*: `normalizeOrgRef` reads
// `raw.displayName` off the untyped Keycloak payload, and that is the wire
// field, not a label -- banning it would be banning the thing that feeds
// `toMindsOrg` in the first place.
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
     * The defect class, stated exactly: a `.displayName` inside a template
     * literal or JSX expression is a string a person reads. This is what the
     * renderer-only version of this guard could not see, and it is why the
     * switch-failure toasts in `main/minds-auth.ts` still said
     * `<email>'s organization` after every renderer surface had stopped.
     */
    const interpolated = [...src.matchAll(/\$\{[^}]*\.displayName[^}]*\}/g)].map((m) => m[0]);
    expect(interpolated).toEqual([]);
  });

  it('never reads an organization displayName at all', () => {
    /*
     * Stronger, and only fair where every read would be a label. A file that
     * also ingests the raw Keycloak shape is exempt -- the interpolation rule
     * above is what guards it.
     */
    if (!presentationOnly) return;
    const direct = [...src.matchAll(/\.displayName\b/g)].map((m) => m[0]);
    expect(direct).toEqual([]);
  });
});
