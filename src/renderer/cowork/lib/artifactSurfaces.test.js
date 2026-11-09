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
import { load } from 'js-yaml';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '../..');
const { surfaces: SURFACES, gates: GATES } = load(
  readFileSync(resolve(import.meta.dirname, 'artifactSurfaces.yaml'), 'utf-8'),
);

/*
 * The identifiers a source names and the ones it calls, read from its syntax
 * tree. A name inside a comment or a string is neither, so a surface that only
 * mentions a gate, or imports it and never calls it, does not pass.
 */
function identifierUse(src) {
  const named = new Set();
  const called = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) named.add(node.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) called.add(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('surface.jsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX));
  return { named, called };
}

/* The gates a source names without calling, and whether it calls any gate. */
function gateWiring(src) {
  const { named, called } = identifierUse(src);
  return {
    namedNotCalled: GATES.filter((gate) => named.has(gate) && !called.has(gate)),
    callsAGate: GATES.some((gate) => called.has(gate)),
    callsDocumentGate: called.has('canPreviewDocument'),
  };
}

describe('the gate wiring check', () => {
  it('fails a surface that imports a gate and only mentions it', () => {
    const src = [
      "import { artifactOpenTarget } from '../lib/artifactActions';",
      '// artifactOpenTarget(card) decides the click.',
      "const label = 'isArtifactActionAvailable(id)';",
    ].join('\n');
    expect(gateWiring(src)).toEqual({
      namedNotCalled: ['artifactOpenTarget'],
      callsAGate: false,
      callsDocumentGate: false,
    });
  });

  it('passes a surface that calls what it names', () => {
    const src = [
      "import { artifactOpenTarget } from '../lib/artifactActions';",
      "import { canPreviewDocument } from '../preview/kinds';",
      'const target = artifactOpenTarget({ canPreviewInline: canPreviewDocument(card, host) });',
    ].join('\n');
    expect(gateWiring(src)).toEqual({ namedNotCalled: [], callsAGate: true, callsDocumentGate: true });
  });
});

describe.each(SURFACES.map(({ name, file }) => [name, file]))('%s', (_name, rel) => {
  const src = readFileSync(resolve(ROOT, rel), 'utf-8');
  const wiring = gateWiring(src);

  it('reads the deployment mode', () => {
    expect(src).toContain('useOrgMode');
  });

  it('routes artifact actions through the shared gate', () => {
    /*
     * Either helper counts: the panel gates a menu, the others resolve a click
     * destination. What must not happen is a surface deciding on its own, or
     * naming a helper it never asks.
     */
    expect(wiring.namedNotCalled).toEqual([]);
    expect(wiring.callsAGate).toBe(true);
  });

  it('asks the document preview gate', () => {
    /* The four document types preview wherever this one gate allows them, so
       a surface that skips it treats them as files with no preview. */
    expect(wiring.callsDocumentGate).toBe(true);
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

// The "Another member" marker (ENG-2979) must come from the shared helper. A
// surface deciding on its own would key it on canEdit (wrong for an owner
// without artifact.manage) or miss ownerUnknown. The inline chat card is not
// listed: it belongs to the conversation that created the artifact.
const AUTHORSHIP_SURFACES = [
  ['artifacts panel (grid + list)', 'cowork/views/ArtifactsView.jsx'],
  ['rail working-folder list', 'cowork/components/rail/WorkingFolderLive.jsx'],
  ['artifact viewer', 'cowork/components/artifact/ArtifactViewer.jsx'],
];

describe.each(AUTHORSHIP_SURFACES)('%s authorship marker', (_name, rel) => {
  const src = readFileSync(resolve(ROOT, rel), 'utf-8');

  it('derives the marker from the shared helper', () => {
    expect(src).toContain('artifactAuthorship(');
  });

  it('does not test the reviewer role itself', () => {
    expect(src).not.toMatch(/role\s*===\s*['"]reviewer['"]/);
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
