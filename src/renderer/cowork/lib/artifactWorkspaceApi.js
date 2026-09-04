import { authFetch, BASE } from '../api';
import { host } from '../../platform/host';
import { artifactIdentity } from './artifactIdentity';

function artifactRef(artifact) {
  const artifactId = artifactIdentity(artifact);
  if (!artifactId) return null;
  const projectRef = artifact?.projectId || 'local';
  return {
    artifactId,
    projectRef: String(projectRef),
    base: `/artifacts/workspace/${encodeURIComponent(projectRef)}/${encodeURIComponent(artifactId)}`,
  };
}

async function request(path, options = {}) {
  const response = await authFetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch { /* response may be empty */ }
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : (detail?.message || payload?.message || `Request failed (${response.status})`);
    const error = new Error(message);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  if (response.status === 204) return { ok: true };
  return response.json();
}

export function canUseArtifactWorkspace(artifact) {
  return !!artifactRef(artifact);
}

/*
 * Same ceiling the desktop preview endpoint applies (cowork-server
 * `preview_artifact`). The draft endpoint streams whatever the file is, so the
 * cut has to happen on this side, and it has to be reported: the viewer's
 * "Preview is truncated" strip reads `truncated`, and a hardcoded `false` sent
 * a multi-MB log or dataset whole into one text render with nothing on screen
 * to say the rest existed. That mattered once a click, on every surface, was
 * what opened this.
 */
const DRAFT_TEXT_MAX = 200_000;

/*
 * Both draft loaders below attach the web Keycloak bearer via `authFetch`,
 * which sends it to whatever URL it is given regardless of origin. The viewer
 * already gates on this before calling either function (`canFetchDraftWithCredentials`
 * in artifactPreviewUtils.js — data:/blob: and cross-origin draft URLs never
 * reach here), but the credential attachment happens in this file, so the
 * invariant has to be enforced here too, not just at the one call site that
 * currently respects it.
 */
const EMBEDDED_DRAFT_URL_RE = /^(?:blob|data):/i;

function resolveSameOriginDraftUrl(draftUrl) {
  if (!draftUrl) throw new Error('Artifact has no private draft URL');
  /*
   * Embedded content is refused by name rather than by accident. A data: or
   * blob: URL used to fail here only because it was concatenated onto the
   * origin and the result would not parse, so the reader was told the URL was
   * invalid when the real answer is that it carries its own payload and needs
   * no credential (ENG-2319). `data:1234/x,hi` even parsed, and was reported
   * as cross-origin instead.
   */
  if (EMBEDDED_DRAFT_URL_RE.test(draftUrl)) {
    throw new Error('Refusing to send credentials to an embedded draft URL');
  }
  /*
   * The same origin `BASE` is built from — asking the host beats stripping the
   * path back off with a regex, and it is what ArtifactViewer already uses to
   * absolutize this very URL for the preview iframe.
   */
  const apiOrigin = host.getApiOrigin();
  let origin;
  let url;
  try {
    /*
     * Resolve against the origin rather than concatenating onto it, so this
     * agrees with `canFetchDraftWithCredentials`, the gate the viewer applies
     * before calling either loader. Concatenation read a protocol-relative
     * `//other.example/x` as same-origin; the two now answer alike.
     */
    const resolved = new URL(draftUrl, apiOrigin);
    url = resolved.toString();
    origin = resolved.origin;
  } catch {
    throw new Error('Artifact draft URL is invalid');
  }
  if (origin !== new URL(apiOrigin).origin) {
    throw new Error('Refusing to send credentials to a cross-origin draft URL');
  }
  return url;
}

/*
 * `withCredentials: false` is the text path's equivalent of the draft-HTML
 * branch's plain `src=` navigation: embedded (data:/blob:) and cross-origin
 * draft URLs carry their own payload or origin and must not receive the web
 * Keycloak bearer, but they can still be read without one. Fetching them
 * bare is what makes a data: CSV render instead of erroring where the same
 * URL renders fine as HTML (ENG-2319). The viewer decides which mode applies
 * with `canFetchDraftWithCredentials`; the credentialed path keeps its
 * same-origin backstop below.
 */
export async function loadArtifactDraftText(draftUrl, { withCredentials = true } = {}) {
  if (!draftUrl) throw new Error('Artifact has no private draft URL');
  const url = withCredentials ? resolveSameOriginDraftUrl(draftUrl) : draftUrl;
  const response = withCredentials ? await authFetch(url) : await fetch(url);
  if (!response.ok) {
    // The status has to travel on the error, not only inside its message: the
    // viewer maps 401 and 403 to their own copy and cannot read a number back
    // out of a sentence.
    const error = new Error(`Could not load private draft (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const body = await response.text();
  return {
    content: body.slice(0, DRAFT_TEXT_MAX),
    truncated: body.length > DRAFT_TEXT_MAX,
    mime: response.headers.get('Content-Type') || '',
  };
}

/*
 * Same fetch as loadArtifactDraftText, uncapped: this one feeds an iframe's
 * `srcdoc` (ArtifactViewer's draft-HTML preview branch), and DRAFT_TEXT_MAX
 * above would silently truncate any HTML document over 200KB before it ever
 * reached the DOM. `isHtml` lets the caller fall back to the old direct-`src`
 * behavior for a non-HTML draft content type — org mode's draft preview only
 * ever offers .html here (md/txt/csv take the text-preview branch), so that
 * fallback is Desktop-only and effectively theoretical.
 */
export async function loadArtifactDraftDocument(draftUrl) {
  const url = resolveSameOriginDraftUrl(draftUrl);
  const response = await authFetch(url);
  if (!response.ok) {
    const error = new Error(`Could not load private draft (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get('Content-Type') || '';
  return {
    content: await response.text(),
    contentType,
    isHtml: contentType.toLowerCase().startsWith('text/html'),
  };
}

export function loadArtifactSource(artifact, path = null) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request(`${ref.base}${query}`);
}

export function saveArtifactSource(artifact, { content, expectedRevisionId, path, summary }) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(ref.base, {
    method: 'PUT',
    body: JSON.stringify({ content, expectedRevisionId, path, summary }),
  });
}

export function loadArtifactRevisions(artifact, path = null) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request(`${ref.base}/revisions${query}`);
}

export function loadArtifactRevision(artifact, revisionId) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/revisions/${encodeURIComponent(revisionId)}`);
}

export function restoreArtifactRevision(artifact, revisionId, expectedRevisionId) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/revisions/${encodeURIComponent(revisionId)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ expectedRevisionId }),
  });
}

// The read-only way in: capabilities plus the revision to anchor comments to,
// and nothing that reveals the source. Safe for a reviewer to call, unlike the
// provisioning POST below — 404 means this draft was never shared with us (a
// private draft is deliberately indistinguishable from a missing one).
export function loadArtifactReview(artifact) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/review`);
}

// Owner-only: this mints the auth rule that lets co-members comment on the
// draft, so it is the owner's decision to make and answers 403 to anyone else.
export function enableDraftComments(artifact) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/comments-access`, { method: 'POST', body: '{}' });
}

// Owner-only, like enableDraftComments above.
//
// On Cloud an artifact autopublishes to its owner alone; these two are how the
// owner then chooses an audience. The read exists because the artifact CARD
// withholds `accessEmails`/`accessPassword` in org mode — one artifacts root is
// shared by the whole organization, so a card cannot tell owner from co-member
// and must assume the worst. This route can, so the Share dialog pre-fills from
// here rather than from the card (ENG-2316).
export function loadArtifactAccess(artifact) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/access`);
}

// Setting an audience is a re-publish server-side: the target stores access
// alongside the bundle and reuses the existing report_id, so the shared URL
// survives the change and nothing has to be unpublished first.
export function setArtifactAccess(artifact, access) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/access`, {
    method: 'PUT',
    body: JSON.stringify({ access }),
  });
}

export function requestAgentRepair(artifact, payload) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/agent-repairs`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function loadAgentRepair(artifact, repairId) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/agent-repairs/${encodeURIComponent(repairId)}`);
}

export function cancelAgentRepair(artifact, repairId) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/agent-repairs/${encodeURIComponent(repairId)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
}

export function decideAgentRepair(artifact, repairId, status) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  return request(`${ref.base}/agent-repairs/${encodeURIComponent(repairId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export { artifactRef };
