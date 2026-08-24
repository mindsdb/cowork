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

// Deleting must also TELL someone. Every surface used to call the api helper
// directly and then patch its own local list, so the conversation's inline
// cards never learned the artifact was gone (ENG-1673). The wrapper is what
// records the tombstone, and a surface that skips it silently reintroduces the
// bug — the same "a caller that never asks" failure this file already guards
// against for the deployment gate.
const DELETE_SURFACES = [
  ['artifacts panel', 'cowork/views/ArtifactsView.jsx'],
  ['rail working-folder list', 'cowork/components/rail/WorkingFolderLive.jsx'],
  ['artifact viewer', 'cowork/components/artifact/ArtifactViewer.jsx'],
];

describe.each(DELETE_SURFACES)('%s deletion', (_name, rel) => {
  const src = readFileSync(resolve(ROOT, rel), 'utf-8');

  it('deletes through the store wrapper', () => {
    expect(src).toContain('deleteArtifactAndSync');
  });

  it('does not reach for the bare api helper', () => {
    // `\b` cannot match between `deleteArtifact` and `AndSync` — both sides are
    // word characters — so the wrapper's own name is excluded for free.
    expect(src).not.toMatch(/\bdeleteArtifact\b/);
  });
});
