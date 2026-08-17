import { describe, expect, it } from 'vitest';
import { isArtifactActionAvailable } from './artifactActions';

const ALL = ['open', 'reveal', 'download', 'copy-url', 'update', 'publish', 'unpublish', 'delete'];

function available(opts) {
  return ALL.filter((id) => isArtifactActionAvailable(id, opts));
}

describe('org mode', () => {
  it('offers only open, copy link and delete for a published artifact', () => {
    expect(available({ orgMode: true, hasBridge: false, published: true }))
      .toEqual(['open', 'copy-url', 'delete']);
  });

  it('leaves only delete while the artifact has no URL yet', () => {
    // Autopublish has not landed (or failed): there is nothing to open or copy,
    // and no action on the card could change that.
    expect(available({ orgMode: true, hasBridge: false, published: false }))
      .toEqual(['delete']);
  });

  it('never offers publish control or local-content actions', () => {
    const ids = available({ orgMode: true, hasBridge: true, published: true });
    for (const hidden of ['reveal', 'download', 'update', 'publish', 'unpublish']) {
      expect(ids).not.toContain(hidden);
    }
  });
});

describe('desktop mode', () => {
  it('keeps every action when the bridge is present', () => {
    expect(available({ orgMode: false, hasBridge: true, published: true })).toEqual(ALL);
  });

  it('hides filesystem actions without the bridge', () => {
    // The second gate: an unresolved orgMode must not be what decides whether we
    // try to reach a local filesystem.
    const ids = available({ orgMode: false, hasBridge: false, published: true });
    expect(ids).not.toContain('reveal');
    expect(ids).not.toContain('download');
    expect(ids).toContain('publish');
  });

  it('does not gate publish control on a published URL', () => {
    // Desktop decides those from its own state (the caller already filters
    // Share/Update/Stop sharing by published-ness); this predicate must not
    // second-guess it.
    expect(available({ orgMode: false, hasBridge: true, published: false })).toEqual(ALL);
  });
});

describe('defaults', () => {
  it('treats a missing options object as desktop without a bridge', () => {
    expect(isArtifactActionAvailable('open')).toBe(true);
    expect(isArtifactActionAvailable('reveal')).toBe(false);
  });
});
