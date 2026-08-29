import { describe, expect, it } from 'vitest';

import { artifactCommentsKey, artifactIdentity, fullArtifactId } from './artifactIdentity';

const FULL = '7db94eb8f0a54c7e9c1d2b3a4f5e6d70';
const DASHED = '7db94eb8-f0a5-4c7e-9c1d-2b3a4f5e6d70';

// One artifact identity, in the two spellings that reach the client.
describe('artifact identity', () => {
  it('normalizes both spellings to bare hex', () => {
    expect(fullArtifactId(FULL)).toBe(FULL);
    expect(fullArtifactId(DASHED)).toBe(FULL);
    expect(fullArtifactId(FULL.toUpperCase())).toBe(FULL);
  });

  it('reads the identity off a server card', () => {
    expect(artifactIdentity({ id: FULL })).toBe(FULL);
  });

  // A conversation recorded before the widening replays cards carrying the
  // short id plus the retired `stableId`. The server adopts that field as the
  // artifact's id, so the client has to as well — otherwise reopening an old
  // conversation shows preview-only for a fully migrated artifact, and Delete
  // sends an id the endpoint cannot resolve.
  it('adopts a replayed card\'s stableId when its id is still short', () => {
    expect(artifactIdentity({ id: '7db94eb8', stableId: DASHED })).toBe(FULL);
  });

  it('yields nothing when a card carries no resolvable identity', () => {
    expect(artifactIdentity({ id: '7db94eb8' })).toBe('');
    expect(artifactIdentity({ id: '' })).toBe('');
    expect(artifactIdentity({})).toBe('');
    expect(artifactIdentity(null)).toBe('');
    // A slug is not an identity, however long it is.
    expect(artifactIdentity({ id: 'q3-launch-readiness-7db94eb8' })).toBe('');
  });
});

// The comments key is the one string that binds a thread across the private
// draft and every published version. The server, the publish response and the
// upload lambda all spell it as a dashed UUID; a client-derived key that used
// bare hex would fork the threads.
describe('artifact comments key', () => {
  it('derives the canonical dashed key from a bare-hex id', () => {
    expect(artifactCommentsKey(FULL)).toBe(`artifact/${DASHED}`);
  });

  it('is spelling-independent', () => {
    expect(artifactCommentsKey(DASHED)).toBe(artifactCommentsKey(FULL));
  });

  it('yields nothing for a pre-widening id rather than a wrong key', () => {
    expect(artifactCommentsKey('7db94eb8')).toBe('');
    expect(artifactCommentsKey('')).toBe('');
    expect(artifactCommentsKey(undefined)).toBe('');
  });
});
