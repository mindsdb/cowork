import { describe, expect, it } from 'vitest';
import { artifactOpenTarget, isArtifactActionAvailable, needsClientUnpublishBeforeDelete } from './artifactActions';

const ALL = ['open', 'preview', 'reveal', 'download', 'copy-url', 'update', 'publish', 'unpublish', 'delete'];

function available(opts) {
  return ALL.filter((id) => isArtifactActionAvailable(id, opts));
}

describe('org mode', () => {
  it('offers private preview, open, copy link and delete for a published artifact', () => {
    expect(available({ orgMode: true, hasBridge: false, published: true }))
      .toEqual(['open', 'preview', 'copy-url', 'delete']);
  });

  it('keeps private preview before an artifact has a shared URL', () => {
    expect(available({ orgMode: true, hasBridge: false, published: false }))
      .toEqual(['preview', 'delete']);
  });

  it('never offers publish control or local-filesystem actions', () => {
    const ids = available({ orgMode: true, hasBridge: true, published: true });
    for (const hidden of ['reveal', 'update', 'publish', 'unpublish']) {
      expect(ids).not.toContain(hidden);
    }
  });

  it('offers download for any artifact whose draft URL exists, shared or not', () => {
    /* Nonpreviewable org artifacts with a primary file still download through their draft URL. */
    expect(available({ orgMode: true, hasBridge: false, published: false, hasDraft: true }))
      .toEqual(['preview', 'download', 'delete']);
    expect(available({ orgMode: true, hasBridge: false, published: true, hasDraft: true }))
      .toEqual(['open', 'preview', 'download', 'copy-url', 'delete']);
  });

  it('does not offer download without a draft URL, bridge or not', () => {
    // A bridge is a desktop fact; it must not be what decides an org action.
    expect(available({ orgMode: true, hasBridge: true, published: true, hasDraft: false }))
      .not.toContain('download');
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
    // Desktop callers already gate publish state; this deployment predicate must not override them.
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
  /*
   * Test exclusive click destinations, separate from per-action availability; org draft eligibility
   * comes from the caller.
   */
  it('previews an org click in the app, even once the artifact is shared', () => {
    /* Prefer the in-app draft preview over leaving the app for the shared page. */
    expect(artifactOpenTarget({
      orgMode: true,
      published: true,
      canPreviewInline: true,
      canPreviewDraft: true,
      hasBridge: true,
    })).toBe('preview');
  });

  it('previews an org click before the artifact is shared at all', () => {
    /* Authenticated draft access must not depend on publication. */
    expect(artifactOpenTarget({
      orgMode: true, published: false, canPreviewDraft: true, hasBridge: false,
    })).toBe('preview');
  });

  it('falls back to the shared page for a draft org mode cannot render', () => {
    /*
     * Do not reuse desktop preview capability for org fullstack/image artifacts; use their
     * published page when available.
     */
    expect(artifactOpenTarget({
      orgMode: true,
      published: true,
      canPreviewInline: true,
      canPreviewDraft: false,
      hasBridge: true,
    })).toBe('published');
  });

  it('saves the file for an org draft the viewer cannot render and nobody shared', () => {
    /*
     * An unpublished, nonpreviewable org file still downloads through its draft; desktop inline
     * capability must not leak into this branch.
     */
    expect(artifactOpenTarget({
      orgMode: true, published: false, canPreviewInline: true, canPreviewDraft: false,
      hasBridge: true, hasDraft: true,
    })).toBe('download');
  });

  it('prefers the shared page over a download when both exist', () => {
    // A collaborator's view of the artifact is the thing the user asked to "open".
    expect(artifactOpenTarget({
      orgMode: true, published: true, canPreviewDraft: false, hasDraft: true,
    })).toBe('published');
  });

  it('is not clickable in org mode with no preview, no published URL and no draft', () => {
    /* Without a preview, published URL or downloadable draft, there is no click target. */
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

describe('needsClientUnpublishBeforeDelete', () => {
  // Desktop must unpublish before delete; org mode delegates it server-side because client DELETE
  // /publish returns 501.
  it('is the client job on desktop, for a published artifact', () => {
    expect(needsClientUnpublishBeforeDelete({ orgMode: false, published: 'https://x' }))
      .toBe(true);
  });

  it('is nobody job when there is nothing published', () => {
    expect(needsClientUnpublishBeforeDelete({ orgMode: false, published: '' }))
      .toBe(false);
  });

  it('is the server job in org mode, published or not', () => {
    // services/artifacts.delete_artifact unpublishes first itself, with the
    // acting user's turn key — the credential the client does not have there.
    expect(needsClientUnpublishBeforeDelete({ orgMode: true, published: 'https://x' }))
      .toBe(false);
    expect(needsClientUnpublishBeforeDelete({ orgMode: true, published: '' }))
      .toBe(false);
  });
});
