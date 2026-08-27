// The decision that turns "the artifacts list doesn't mention this card" into
// "this artifact was deleted". Every branch here is a fail-open guard: a false
// "Deleted" on a live artifact is worse than the bug this fixes (ENG-1673 §R5),
// so the table below is mostly about the cases that must NOT be reported.
import { describe, it, expect } from 'vitest';

import {
  artifactKeys,
  buildArtifactIndex,
  emptyArtifactIndex,
  isArtifactDeleted,
  matchesIndex,
  mergeArtifactIndex,
} from './artifactLiveness';

// A server card as `/artifacts/` returns it (cowork-server card_for_folder):
// `folder` is the artifact root, `path` the primary file inside it.
const serverCard = (o = {}) => ({
  id: '7db94eb8',
  slug: 'clock-7db94eb8',
  projectId: 'proj-1',
  folder: '/proj/.anton/artifacts/clock-7db94eb8',
  path: '/proj/.anton/artifacts/clock-7db94eb8/index.html',
  ...o,
});

// A chat card as artifactStepToCard produces it: no `folder`, and the path is
// whatever the stream announced.
const chatCard = (o = {}) => ({
  id: '7db94eb8',
  slug: 'clock-7db94eb8',
  projectId: 'proj-1',
  canonicalPath: '/proj/.anton/artifacts/clock-7db94eb8/index.html',
  ...o,
});

const PROJECT_SCOPE = { kind: 'project', projectId: 'proj-1', projectPath: '/proj' };
const GLOBAL_SCOPE = { kind: 'global', projectId: '', projectPath: '' };

const decide = (card, over = {}) => isArtifactDeleted(card, {
  index: buildArtifactIndex([]),
  tombstones: emptyArtifactIndex(),
  born: emptyArtifactIndex(),
  scope: PROJECT_SCOPE,
  live: false,
  ...over,
});

describe('artifactKeys', () => {
  it('pairs project and slug only when both are present', () => {
    expect(artifactKeys(chatCard()).projectSlug).toBe('proj-1/clock-7db94eb8');
    expect(artifactKeys(chatCard({ projectId: '' })).projectSlug).toBe('');
    expect(artifactKeys(chatCard({ slug: '' })).projectSlug).toBe('');
  });

  it('prefers canonicalPath, then file_path, then path', () => {
    expect(artifactKeys({ canonicalPath: '/a', file_path: '/b', path: '/c' }).path).toBe('/a');
    expect(artifactKeys({ file_path: '/b', path: '/c' }).path).toBe('/b');
    expect(artifactKeys({ path: '/c' }).path).toBe('/c');
    expect(artifactKeys({}).path).toBe('');
  });
});

describe('matchesIndex', () => {
  it('matches on id', () => {
    const index = buildArtifactIndex([serverCard({ slug: 'renamed', projectId: 'other' })]);
    expect(matchesIndex(chatCard({ canonicalPath: '' }), index)).toBe(true);
  });

  it('bridges a widened server id to a pre-widening chat card', () => {
    // The widening kept the old eight characters as the new id's prefix. This
    // is the case `id` exists for: the folder moved, so slug and path both
    // changed and only the identity can match. Without the bridge, a desktop
    // card (no projectId, so no projectSlug key) would read as deleted while
    // its files sit on disk.
    const index = buildArtifactIndex([serverCard({
      id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70',
      slug: 'renamed', projectId: '', folder: '/proj/.anton/artifacts/renamed',
    })]);

    expect(matchesIndex(chatCard({ projectId: '', canonicalPath: '' }), index)).toBe(true);
  });

  it('bridges in the other direction too', () => {
    const index = buildArtifactIndex([chatCard({ projectId: '', canonicalPath: '' })]);
    const widened = serverCard({
      id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70',
      slug: 'renamed', projectId: '', folder: '/elsewhere', path: '/elsewhere/index.html',
    });

    expect(matchesIndex(widened, index)).toBe(true);
  });

  it('matches on projectId + slug when ids differ', () => {
    const index = buildArtifactIndex([serverCard({ id: 'different' })]);
    expect(matchesIndex(chatCard({ id: '', canonicalPath: '' }), index)).toBe(true);
  });

  it('matches a primary file against the artifact folder', () => {
    const index = buildArtifactIndex([serverCard()]);
    expect(matchesIndex(chatCard({ id: '', slug: '' }), index)).toBe(true);
  });

  it('matches a primary file nested below the folder (fullstack static/)', () => {
    // cowork-server's _pick_primary puts a fullstack artifact's entry point in
    // `static/`, so path equality with the server card is not enough.
    const index = buildArtifactIndex([serverCard()]);
    const nested = chatCard({
      id: '', slug: '',
      canonicalPath: '/proj/.anton/artifacts/clock-7db94eb8/static/index.html',
    });
    expect(matchesIndex(nested, index)).toBe(true);
  });

  it('derives the folder from path when the card carries no folder', () => {
    // Tombstones and born are built from chat cards, which have no `folder`.
    const index = buildArtifactIndex([chatCard({ id: '', slug: '' })]);
    expect(matchesIndex(chatCard({ id: '', slug: '' }), index)).toBe(true);
  });

  it('normalizes separators and trailing separators', () => {
    const index = buildArtifactIndex([
      serverCard({ id: '', slug: '', folder: 'C:\\proj\\.anton\\artifacts\\clock\\' }),
    ]);
    const card = chatCard({ id: '', slug: '', canonicalPath: 'C:/proj/.anton/artifacts/clock/index.html' });
    expect(matchesIndex(card, index)).toBe(true);
  });

  it('does not let a folder prefix swallow a sibling', () => {
    const index = buildArtifactIndex([serverCard({ id: '', slug: '', folder: '/proj/.anton/artifacts/al' })]);
    const card = chatCard({ id: '', slug: '', canonicalPath: '/proj/.anton/artifacts/alpha/index.html' });
    expect(matchesIndex(card, index)).toBe(false);
  });

  it('is false against a null index', () => {
    expect(matchesIndex(chatCard(), null)).toBe(false);
  });
});

describe('mergeArtifactIndex', () => {
  it('unions both indices and tolerates a null second operand', () => {
    const a = buildArtifactIndex([serverCard({ id: 'aaa' })]);
    const b = buildArtifactIndex([serverCard({ id: 'bbb' })]);
    const merged = mergeArtifactIndex(a, b);
    expect(merged.ids.has('aaa')).toBe(true);
    expect(merged.ids.has('bbb')).toBe(true);
    expect(mergeArtifactIndex(a, null).ids.has('aaa')).toBe(true);
  });

  it('does not mutate its operands', () => {
    const a = buildArtifactIndex([serverCard({ id: 'aaa' })]);
    mergeArtifactIndex(a, buildArtifactIndex([serverCard({ id: 'bbb' })]));
    expect(a.ids.has('bbb')).toBe(false);
  });
});

describe('isArtifactDeleted', () => {
  it('reports a card the loaded index does not mention', () => {
    expect(decide(chatCard())).toBe(true);
  });

  it('does not report a card the index mentions', () => {
    expect(decide(chatCard(), { index: buildArtifactIndex([serverCard()]) })).toBe(false);
  });

  it('reports a tombstoned card', () => {
    const tombstones = buildArtifactIndex([serverCard()]);
    expect(decide(chatCard(), { index: buildArtifactIndex([serverCard()]), tombstones })).toBe(true);
  });

  it('matches a tombstone built from a server card against a chat card', () => {
    // The three delete call sites hand `noteArtifactDeleted` a SERVER card, and
    // it is checked against a CHAT card whose path is the announced file, not
    // _pick_primary's choice. Exact-string tombstones would miss here.
    const tombstones = buildArtifactIndex([serverCard({ id: '', slug: '' })]);
    const card = chatCard({
      id: '', slug: '',
      canonicalPath: '/proj/.anton/artifacts/clock-7db94eb8/static/index.html',
    });
    expect(decide(card, { tombstones })).toBe(true);
  });

  it('lets a tombstone win over born', () => {
    // Created and deleted inside one session.
    const both = buildArtifactIndex([serverCard()]);
    expect(decide(chatCard(), { tombstones: both, born: both })).toBe(true);
  });

  it('does not report a card of an unfinished turn', () => {
    expect(decide(chatCard(), { live: true })).toBe(false);
  });

  it('does not report a born card against a stale index', () => {
    const born = buildArtifactIndex([chatCard()]);
    expect(decide(chatCard(), { born })).toBe(false);
  });

  it('does not report anything while the index is unloaded', () => {
    expect(decide(chatCard(), { index: null })).toBe(false);
  });

  it('does not report a card of another project (scoped index)', () => {
    // ENG-1678: a card can reference an artifact outside the fetched scope.
    // It is simply absent from a scoped list, which is not evidence of deletion.
    const card = chatCard({ projectId: 'proj-2', canonicalPath: '/other/.anton/artifacts/x/i.html' });
    expect(decide(card)).toBe(false);
  });

  it('does not report a desktop card whose path is outside the project', () => {
    const card = chatCard({ projectId: '', canonicalPath: '/elsewhere/.anton/artifacts/x/i.html' });
    expect(decide(card)).toBe(false);
  });

  it('reports a card of another project against a global index', () => {
    // The unscoped list spans every project the caller can see
    // (artifacts_sources_for_scope), so a miss there is real.
    const card = chatCard({ projectId: 'proj-2', canonicalPath: '/other/.anton/artifacts/x/i.html' });
    expect(decide(card, { scope: GLOBAL_SCOPE })).toBe(true);
  });

  it('does not report a card with no usable key', () => {
    expect(decide({ title: 'Mystery' })).toBe(false);
  });

  it('does not report a missing card', () => {
    expect(decide(null)).toBe(false);
  });
});
