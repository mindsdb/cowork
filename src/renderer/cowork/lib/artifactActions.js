/*
 * Org deployments preview and download through authenticated draft URLs.
 * OS/file and owner-publish controls require desktop; omit actions with no usable target.
 */

const ORG_MODE_ALWAYS = new Set(['preview', 'delete']);
const ORG_MODE_NEEDS_URL = new Set(['open', 'copy-url']);
const ORG_MODE_NEEDS_DRAFT = new Set(['download']);
// These reach the local filesystem through the Electron bridge. `download` is
// here for DESKTOP: there it streams the local serve URL, which the web build
// against a local server also has — org mode answers it from the draft above.
const NEEDS_BRIDGE = new Set(['reveal', 'download']);

export function isArtifactActionAvailable(id, { orgMode, hasBridge, published, hasDraft } = {}) {
  if (orgMode) {
    if (ORG_MODE_ALWAYS.has(id)) return true;
    if (ORG_MODE_NEEDS_URL.has(id)) return Boolean(published);
    if (ORG_MODE_NEEDS_DRAFT.has(id)) return Boolean(hasDraft);
    return false;
  }
  // Second, independent gate: if /health was unreachable at boot then orgMode is a
  // guess, and these two need a real filesystem either way.
  if (NEEDS_BRIDGE.has(id)) return Boolean(hasBridge);
  return true;
}

/**
 * Choose one body-click destination: preview, os, published, download, or null (not clickable).
 * Org mode prefers an in-app draft preview, then a shared URL, then a file download.
 * Callers own preview eligibility; artifactKinds.canPreviewOrgDraft supplies the shared org-mode
 * rule.
 */
export function artifactOpenTarget({
  orgMode, published, canPreviewInline, canPreviewDraft, hasBridge, hasDraft,
} = {}) {
  if (orgMode) {
    if (canPreviewDraft) return 'preview';
    if (published) return 'published';
    return hasDraft ? 'download' : null;
  }
  if (canPreviewInline) return 'preview';
  return hasBridge ? 'os' : null;
}

/**
 * Desktop's path-addressed delete only removes the folder, so the client must unpublish first.
 * Org-mode delete unpublishes server-side with the acting user's key; its client DELETE /publish
 * would return 501.
 */
export function needsClientUnpublishBeforeDelete({ orgMode, published } = {}) {
  return !orgMode && Boolean(published);
}
