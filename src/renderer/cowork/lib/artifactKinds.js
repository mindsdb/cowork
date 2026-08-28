// Shared artifact file-type predicates.
//
// Kept in one place so every surface that renders an artifact — the artifact
// list (ArtifactsView), the inline chat card, the Working folder rail and the
// viewer itself — agrees on what's previewable vs publishable. They used to
// drift, which let the viewer offer Publish for files the list (and the
// backend) reject, and left each click handler with its own extension list.

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

/*
 * Text formats the in-app viewer renders without an iframe: markdown inline,
 * CSV as a table, anything else preformatted. Matched against the declared
 * `ext` and the path, same convention as isHtmlArtifact.
 */
const TEXT_PREVIEW_EXTS = new Set(['.md', '.txt', '.csv']);

/** Text artifact the viewer renders inline rather than in an iframe. */
export function isTextPreviewArtifact(a) {
  if (!a) return false;
  return TEXT_PREVIEW_EXTS.has(_ext(a)) || [...TEXT_PREVIEW_EXTS].some((e) => _path(a).endsWith(e));
}

/**
 * Everything the viewer renders from the artifact's own markup or text —
 * HTML through the sandboxed iframe, .md/.txt/.csv through the text path.
 * Images are deliberately absent: they load from the serve URL instead, so
 * the two callers that can reach one ask for it separately.
 */
export function isInlinePreviewable(a) {
  return isHtmlArtifact(a) || isTextPreviewArtifact(a);
}

/** Everything the viewer can render from local bytes, images included. */
export function canPreviewLocally(a) {
  return isInlinePreviewable(a) || isImageArtifact(a);
}

/**
 * What the viewer can render in an org deployment, where the only source of
 * bytes is the authenticated draft URL (`GET /artifacts/drafts/...`).
 *
 * Narrower than canPreviewLocally in two ways. A fullstack app needs the
 * loopback proxy only Desktop runs, and an image would be fetched from
 * `/artifacts/serve`, which org-mode tenancy refuses. Offering either would
 * open a window that can only fail.
 */
export function canPreviewOrgDraft(a) {
  return !!a?.draftUrl && !isBackendArtifact(a) && isInlinePreviewable(a);
}
