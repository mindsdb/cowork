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

// Raster/vector image extensions a `create_artifact(type="image")` output
// can carry (anton/core/tools/tool_defs.py). Matched against both the
// declared `ext` and the path, same convention as isHtmlArtifact.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/** Image artifact — gates the inline thumbnail / <img> preview (ENG-1998). */
export function isImageArtifact(a) {
  if (!a) return false;
  return IMAGE_EXTS.has(_ext(a)) || [...IMAGE_EXTS].some((e) => _path(a).endsWith(e));
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
