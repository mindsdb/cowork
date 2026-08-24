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

// An artifact the agent creates mid-session is absent from an index loaded
// before it existed, and would be reported as deleted. The live stream is the
// only place that knows it was just born, and App owns every live stream — a
// signal hung on ChatView would miss a turn that finishes while the user is
// looking at another chat or another route.
describe('live stream', () => {
  const src = readFileSync(resolve(ROOT, 'cowork/App.jsx'), 'utf-8');

  it('registers artifacts of the live turn with the liveness store', () => {
    expect(src).toContain('noteArtifactsFromSteps');
  });

  it('registers them from the shared live-steps collector', () => {
    // Not from one of the four onEvent bodies: a fifth stream loop added later
    // would silently skip it.
    const collector = src.slice(src.indexOf('const updateLiveStepsAndDrainQueue'));
    const body = collector.slice(0, collector.indexOf('\n  };'));
    expect(body).toContain('noteArtifactsFromSteps');
  });
});
