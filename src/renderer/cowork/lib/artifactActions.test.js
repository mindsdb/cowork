import { describe, expect, it } from 'vitest';
import { artifactOpenTarget, isArtifactActionAvailable } from './artifactActions';

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

describe('artifactOpenTarget', () => {
  // The click destination, not a yes/no per action. Three surfaces render an
  // artifact body — the inline chat card, the rail's Working-folder list and the
  // artifacts grid — and each used to decide from the file extension alone, so
  // all three opened a local preview on a deployment that serves no content.
  it('opens the published URL in org mode, whatever the extension says', () => {
    expect(artifactOpenTarget({
      orgMode: true, published: true, canPreviewInline: true, hasBridge: true,
    })).toBe('published');
    expect(artifactOpenTarget({
      orgMode: true, published: true, canPreviewInline: false, hasBridge: true,
    })).toBe('published');
  });

  it('is not clickable in org mode without a published URL', () => {
    // Nothing to open: the local preview and the OS handoff both need bytes
    // this deployment does not serve.
    expect(artifactOpenTarget({
      orgMode: true, published: false, canPreviewInline: true, hasBridge: true,
    })).toBeNull();
  });

  it('keeps the desktop behaviour unchanged', () => {
    expect(artifactOpenTarget({
      orgMode: false, published: false, canPreviewInline: true, hasBridge: true,
    })).toBe('preview');
    expect(artifactOpenTarget({
      orgMode: false, published: false, canPreviewInline: false, hasBridge: true,
    })).toBe('os');
  });

  it('does not hand a path to a shell that is not there', () => {
    // Web build, non-previewable type: there is no bridge to open it with.
    expect(artifactOpenTarget({
      orgMode: false, published: false, canPreviewInline: false, hasBridge: false,
    })).toBeNull();
  });
});
