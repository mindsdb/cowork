/*
 * Shared artifact file-type predicates.
 *
 * Kept in one place so every surface that renders an artifact — the artifact
 * list (ArtifactsView), the inline chat card, the Working folder rail and the
 * viewer itself — agrees on what's previewable vs publishable. They used to
 * drift, which let the viewer offer Publish for files the list (and the
 * backend) reject, and left each click handler with its own extension list.
 *
 * The viewer reads TEXT_PREVIEW_EXTS from here through artifactPreviewUtils,
 * so a format added to that set reaches the click gates and the renderer in
 * one edit. It still resolves the extension its own way (declared `ext` wins,
 * then the canonical path), because it addresses the file it is about to
 * fetch rather than the card the click came from.
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
 *
 * Exported because the viewer's own isTextArtifact reads the same set — a
 * format only one of them knew about would be a card that offers a preview
 * the viewer cannot render, or a viewer that renders what no click reaches.
 */
export const TEXT_PREVIEW_EXTS = new Set(['.md', '.txt', '.csv']);

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

/**
 * What an org deployment can hand the user as a FILE through the authenticated
 * draft URL (`?download=1`, ENG-2044). Every artifact with a primary file has a
 * draft URL, so this is nearly "has a draft" — except fullstack apps: their
 * primary is `static/index.html`, which is not the app, so "Download" would
 * save a useless shell and read as if it were. Those keep their shared page
 * (autopublish publishes them on the next turn) or, unshared, the honest
 * "no shared link yet". Same shape as `canPreviewOrgDraft` on purpose: the
 * callers pass this in as `hasDraft` the way they pass that one as
 * `canPreviewDraft`.
 */
export function canDownloadOrgDraft(a) {
  return !!a?.draftUrl && !isBackendArtifact(a);
}
