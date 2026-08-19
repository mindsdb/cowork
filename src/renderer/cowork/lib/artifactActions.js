// Which artifact card actions exist, per deployment mode.
//
// In an org deployment the server serves no artifact content at all: `serveUrl` is
// empty and the preview/serve endpoints answer 501. So the only route to an
// artifact's content is its published URL, which carries an access check — and the
// actions that assume local content (Show in Finder, Download, the iframe preview)
// or owner-side publish control (Share, Update, Stop sharing) have nothing to act
// on there.
//
// Open and Copy link need a published URL to point at; without one only Delete is
// left. An action that cannot work is not offered rather than offered disabled —
// there is nothing the user could do to enable it from the card.

const ORG_MODE_ALWAYS = new Set(['delete']);
const ORG_MODE_NEEDS_URL = new Set(['open', 'copy-url']);
// These reach the local filesystem through the Electron bridge.
const NEEDS_BRIDGE = new Set(['reveal', 'download']);

export function isArtifactActionAvailable(id, { orgMode, hasBridge, published } = {}) {
  if (orgMode) {
    if (ORG_MODE_ALWAYS.has(id)) return true;
    if (ORG_MODE_NEEDS_URL.has(id)) return Boolean(published);
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
 * shell, `'published'` opens the public URL, `null` means the body is not
 * clickable at all.
 *
 * Separate from `isArtifactActionAvailable` because this is a choice between
 * mutually exclusive destinations rather than a per-action yes/no, and every
 * surface that renders an artifact body has to make it: the inline chat card,
 * the rail's Working-folder list and the artifacts grid each had their own
 * copy, keyed only on the file extension. In org mode all three then opened a
 * local preview of content that deployment does not serve.
 *
 * `canPreviewInline` stays the caller's to compute — the extension rules differ
 * slightly per surface and are not what this decides.
 */
export function artifactOpenTarget({ orgMode, published, canPreviewInline, hasBridge } = {}) {
  if (orgMode) return published ? 'published' : null;
  if (canPreviewInline) return 'preview';
  return hasBridge ? 'os' : null;
}
