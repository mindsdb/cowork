// Every surface that renders an artifact must consult the deployment gate.
//
// The gate itself is unit-tested in artifactActions.test.js, and that passed
// throughout two separate regressions: the artifacts grid menu offered Preview /
// Show in Finder / Share in org mode, and the inline chat card opened a local
// preview of content the deployment does not serve. A test of the predicate
// cannot catch a caller that never asks — and each new surface is a new caller.
//
// So this asserts the wiring instead: each file that renders an artifact reads
// the mode and routes through the shared helpers. Source inspection, because the
// alternative is mounting four component trees to observe one import.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

const SURFACES = [
  ['artifacts panel (grid + list)', 'cowork/views/ArtifactsView.jsx'],
  ['inline chat card', 'cowork/views/ChatView.jsx'],
  ['rail working-folder list', 'cowork/components/rail/WorkingFolderLive.jsx'],
];

describe.each(SURFACES)('%s', (_name, rel) => {
  const src = readFileSync(resolve(ROOT, rel), 'utf-8');

  it('reads the deployment mode', () => {
    expect(src).toContain('useOrgMode');
  });

  it('routes artifact actions through the shared gate', () => {
    // Either helper counts: the panel gates a menu, the others resolve a click
    // destination. What must not happen is a surface deciding on its own.
    expect(
      src.includes('isArtifactActionAvailable') || src.includes('artifactOpenTarget'),
    ).toBe(true);
  });
});
