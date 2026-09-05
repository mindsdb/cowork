/*
 * Shared preview/publish eligibility. Keep click gates and viewer support aligned through
 * TEXT_PREVIEW_EXTS.
 * The viewer resolves declared ext before canonical path because it classifies the file being
 * fetched.
 */

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

/** A fullstack artifact's displayed path is its root folder, not the entry HTML under static/. */
export const BACKEND_ARTIFACT_TYPES = new Set([
  'fullstack-stateless-app',
  'fullstack-stateful-app',
]);

/** True for fullstack apps, whose displayed path should be the slug folder. */
export function isBackendArtifact(a) {
  return !!a && BACKEND_ARTIFACT_TYPES.has(a.type);
}

/**
 * Keep aligned with cowork-server PUBLISHABLE_STATIC_SUFFIXES.
 * Markdown is publishable via server rendering but cannot use the HTML iframe preview.
 */
export function isPublishableArtifact(a) {
  if (!a) return false;
  const ext = _ext(a);
  const path = _path(a);
  return ext === '.html' || path.endsWith('.html')
    || ext === '.md' || path.endsWith('.md');
}

/* Shared with artifactPreviewUtils so click gates and the viewer support the same text formats. */
export const TEXT_PREVIEW_EXTS = new Set(['.md', '.txt', '.csv']);

/** Text artifact the viewer renders inline rather than in an iframe. */
export function isTextPreviewArtifact(a) {
  if (!a) return false;
  return TEXT_PREVIEW_EXTS.has(_ext(a)) || [...TEXT_PREVIEW_EXTS].some((e) => _path(a).endsWith(e));
}

/** Images use a separate serve-URL path, so they are excluded from markup/text preview eligibility. */
export function isInlinePreviewable(a) {
  return isHtmlArtifact(a) || isTextPreviewArtifact(a);
}

/** Everything the viewer can render from local bytes, images included. */
export function canPreviewLocally(a) {
  return isInlinePreviewable(a) || isImageArtifact(a);
}

/**
 * Org drafts cannot preview fullstack apps (desktop loopback proxy required) or images (serve route
 * rejects org tenancy).
 */
export function canPreviewOrgDraft(a) {
  return !!a?.draftUrl && !isBackendArtifact(a) && isInlinePreviewable(a);
}

/** Exclude fullstack drafts: downloading static/index.html alone would omit the app's backend. */
export function canDownloadOrgDraft(a) {
  return !!a?.draftUrl && !isBackendArtifact(a);
}
