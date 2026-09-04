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
function resolveSameOriginDraftUrl(draftUrl) {
  if (!draftUrl) throw new Error('Artifact has no private draft URL');
  /*
   * The same origin `BASE` is built from — asking the host beats stripping the
   * path back off with a regex, and it is what ArtifactViewer already uses to
   * absolutize this very URL for the preview iframe.
   */
  const apiOrigin = host.getApiOrigin();
  const url = /^https?:\/\//i.test(draftUrl) ? draftUrl : `${apiOrigin}${draftUrl}`;
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error('Artifact draft URL is invalid');
  }
  if (origin !== new URL(apiOrigin).origin) {
    throw new Error('Refusing to send credentials to a cross-origin draft URL');
  }
  return url;
}

export async function loadArtifactDraftText(draftUrl) {
  const url = resolveSameOriginDraftUrl(draftUrl);
  const response = await authFetch(url);
  if (!response.ok) {
    throw new Error(`Could not load private draft (${response.status})`);
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

export function decideAgentRepair(artifact, repairId, status, { expectedHeadRevisionId = null } = {}) {
  const ref = artifactRef(artifact);
  if (!ref) return Promise.reject(new Error('Artifact has no full identity'));
  // Rejecting restores over whatever is head now, so the server needs the head
  // the user was actually shown, not the one the repair was computed against.
  return request(`${ref.base}/agent-repairs/${encodeURIComponent(repairId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ status, expectedHeadRevisionId }),
  });
}

export { artifactRef };
