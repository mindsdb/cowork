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
