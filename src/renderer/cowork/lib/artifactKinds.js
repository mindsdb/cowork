// Shared artifact file-type predicates.
//
// Kept in one place so the artifact list (ArtifactsView) and the artifact
// viewer (ArtifactViewer) agree on what's previewable vs publishable —
// they used to drift, which let the viewer offer Publish for files the
// list (and the backend) reject.

function _ext(a) {
  return (a?.ext || '').toLowerCase();
}
function _path(a) {
  return (a?.path || '').toLowerCase();
}

/** HTML artifact — gates HTML-only behaviour like live iframe preview. */
export function isHtmlArtifact(a) {
  if (!a) return false;
  return _ext(a) === '.html' || _path(a).endsWith('.html');
}

/**
 * Backend (fullstack) artifact types. For these the artifact's "thing" the
 * user points at is the artifact folder (the slug dir) — the backend,
 * requirements.txt and the static frontend all live there — not the entry
 * HTML file (which for fullstack apps sits one level down in `static/`).
 */
export const BACKEND_ARTIFACT_TYPES = new Set([
  'fullstack-stateless-app',
  'fullstack-stateful-app',
]);

/** True for fullstack apps, whose displayed path should be the slug folder. */
export function isBackendArtifact(a) {
  return !!a && BACKEND_ARTIFACT_TYPES.has(a.type);
}

/**
 * Artifact types the user can publish to a 4nton.ai page. HTML is served
 * as-is; Markdown is rendered to a styled HTML page server-side (see
 * cowork-server PUBLISHABLE_STATIC_SUFFIXES). Broader than isHtmlArtifact()
 * — Markdown is publishable but NOT live-previewable as an iframe.
 */
export function isPublishableArtifact(a) {
  if (!a) return false;
  const ext = _ext(a);
  const path = _path(a);
  return ext === '.html' || path.endsWith('.html')
    || ext === '.md' || path.endsWith('.md');
}

// Artifact *types* we deliberately refuse to publish even though their entry
// file would otherwise pass isPublishableArtifact(). A fullstack stateful app
// keeps server-side state the static publish pipeline can't carry, so a
// published copy would be broken or misleading. Keyed on the artifact's
// declared `type` (the metadata source of truth), NOT its file extension.
const PUBLISH_BLOCKED_TYPES = new Set(['fullstack-stateful-app']);

/**
 * Human-readable reason this artifact's type is forbidden from publishing, or
 * '' when publishing is allowed. Layered on top of isPublishableArtifact():
 * a non-empty reason means render the Publish control disabled with this string
 * as its tooltip, rather than hiding it.
 */
export function publishBlockedReason(a) {
  if (a && PUBLISH_BLOCKED_TYPES.has(a.type)) {
    return "Fullstack stateful apps can't be shared.";
  }
  return '';
}
