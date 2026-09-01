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

const RENDERER = resolve(import.meta.dirname, '../../');

const SURFACES = [
  ['sidebar account menu', 'cowork/components/UserMenu.jsx'],
  ['Settings → Account organization row', 'cowork/views/settings/AccountSection.jsx'],
  ['onboarding organization picker', 'pages/arcade/OnboardingScreen.tsx'],
];

describe.each(SURFACES)('%s', (_name, rel) => {
  const src = readFileSync(resolve(RENDERER, rel), 'utf-8');

  it('routes the organization name through organizationLabel', () => {
    expect(src).toContain('organizationLabel');
  });

  it('never reads an organization displayName directly', () => {
    /*
     * `organizationLabel` substitutes PERSONAL_ORG_LABEL for a personal
     * organization, whose Keycloak displayName is auth's generated
     * `<email>'s organization`. A surface reading displayName itself gets the
     * long label and, where the token claim is also in play, disagrees with
     * the other reader for as long as the listing takes to resolve.
     *
     * Matches the property access on an organization only. `user.name` and a
     * React component's own `Component.displayName` are unrelated.
     */
    const direct = [...src.matchAll(/\b(?:org|activeOrg|mintedOrg|organization)\??\.displayName\b/g)];
    expect(direct.map((m) => m[0])).toEqual([]);
  });
});
