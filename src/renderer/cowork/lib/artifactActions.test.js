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
  // Org mode now answers from the authenticated draft URL instead, which the
  // callers compute with `canPreviewOrgDraft`.
  it('previews an org click in the app, even once the artifact is shared', () => {
    // The click means "show me this artifact". Sending it to the shared page
    // instead put a browser tab between the user and their own work.
    expect(artifactOpenTarget({
      orgMode: true,
      published: true,
      canPreviewInline: true,
      canPreviewDraft: true,
      hasBridge: true,
    })).toBe('preview');
  });

  it('previews an org click before the artifact is shared at all', () => {
    // The draft URL carries its own access check, so the preview does not wait
    // on a publish the user may never do.
    expect(artifactOpenTarget({
      orgMode: true, published: false, canPreviewDraft: true, hasBridge: false,
    })).toBe('preview');
  });

  it('falls back to the shared page for a draft org mode cannot render', () => {
    // Fullstack apps and images: the draft endpoint refuses both, so the
    // published page is the only destination left. `canPreviewInline` is the
    // desktop answer and must not leak into this branch.
    expect(artifactOpenTarget({
      orgMode: true,
      published: true,
      canPreviewInline: true,
      canPreviewDraft: false,
      hasBridge: true,
    })).toBe('published');
  });

  it('is not clickable in org mode without a preview or a published URL', () => {
    // Nothing to open: the draft cannot be rendered, and the OS handoff needs
    // bytes this deployment does not serve.
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
  // Deleting a published artifact must not leave an orphaned public copy, and
  // which side enforces that depends on the deployment. Getting it backwards is
  // not cosmetic: in org mode `DELETE /publish` answers 501, and the await threw
  // before the delete was ever attempted — the user saw
  // "Delete failed: not available in org deployments" and the artifact stayed.
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
