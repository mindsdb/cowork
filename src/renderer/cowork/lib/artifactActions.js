/*
 * Which artifact card actions exist, per deployment mode.
 *
 * In an org deployment the in-app preview/review reads the authenticated draft
 * URL, so it is offered wherever an artifact is rendered; OS/file actions and
 * owner-side publish controls remain desktop-only.
 *
 * Open and Copy link need a published URL to point at. Download needs the
 * authenticated draft URL: on an org deployment it is the only route to the
 * bytes, and it is set for every artifact with a primary file — so a .xlsx or
 * .docx the viewer cannot render is downloadable rather than a dead end
 * (ENG-2044). An action that cannot work is not offered rather than offered
 * disabled — there is nothing the user could do to enable it from the card.
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
 * What a click on the artifact's own body should do.
 *
 * `'preview'` opens the in-app viewer, `'os'` hands the path to the desktop
 * shell, `'published'` opens the public URL, `'download'` saves the file, and
 * `null` means the body is not clickable at all.
 *
 * Separate from `isArtifactActionAvailable` because this is a choice between
 * mutually exclusive destinations rather than a per-action yes/no, and every
 * surface that renders an artifact body has to make it: the inline chat card,
 * the rail's Working-folder list and the artifacts grid each had their own
 * copy, keyed only on the file extension.
 *
 * A click means "show me this artifact" in both deployments, so org mode
 * previews whatever the draft URL can render and keeps the shared URL as a
 * named action beside it. Sending the click to the shared page instead put a
 * browser tab between the user and their own artifact, and the artifacts whose
 * draft cannot be rendered — a fullstack app, an image — still go there.
 *
 * An org artifact the draft cannot render and nobody has shared still has its
 * bytes behind the draft URL, so the click saves the file instead of dying
 * with "no shared link yet" (ENG-2044). Only when there is no primary file at
 * all is there genuinely nowhere to go.
 *
 * `canPreviewInline` and `canPreviewDraft` stay the caller's to compute: the
 * extension rules differ slightly per surface and are not what this decides.
 * `canPreviewOrgDraft` in `artifactKinds.js` is the shared org-mode answer.
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
 * Whether the CLIENT has to unpublish before deleting.
 *
 * Deleting a published artifact must never leave an orphaned public copy, and
 * two paths enforce that. On desktop the client unpublishes first, because its
 * delete goes to the path-addressed `DELETE /artifacts/?path=`, which only
 * removes the folder. In org mode the client must NOT: `DELETE /publish` is
 * desktop-only (it addresses artifacts by absolute server path and resolves the
 * credential from stored provider settings, neither of which exists on an org
 * deployment) and answers 501, which aborted the whole delete before it started.
 *
 * Nothing is lost by skipping it there — `services/artifacts.delete_artifact`
 * unpublishes first itself, with the acting user's turn key rather than a stored
 * provider key, and leaves the folder on disk if that fails.
 *
 * This only became reachable when auto-publishing was switched on: the client
 * step is guarded by `published`, so before then no artifact ever had a URL for
 * it to act on.
 */
export function needsClientUnpublishBeforeDelete({ orgMode, published } = {}) {
  return !orgMode && Boolean(published);
}
