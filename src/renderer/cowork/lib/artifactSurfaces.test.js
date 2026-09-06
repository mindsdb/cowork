// Guard call-site wiring to shared deployment helpers; unit tests cannot catch a surface that never
// consults them.

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

// Delete surfaces must use the store wrapper so chat cards receive tombstones, not merely remove
// their own local rows.
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

// App owns live streams across navigation and must mark new artifacts born before an older index
// can label them deleted.
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
