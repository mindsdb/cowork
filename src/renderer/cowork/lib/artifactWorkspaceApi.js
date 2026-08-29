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

export async function loadArtifactDraftText(draftUrl) {
  if (!draftUrl) throw new Error('Artifact has no private draft URL');
  /*
   * The same origin `BASE` is built from — asking the host beats stripping the
   * path back off with a regex, and it is what ArtifactViewer already uses to
   * absolutize this very URL for the preview iframe.
   */
  const url = /^https?:\/\//i.test(draftUrl) ? draftUrl : `${host.getApiOrigin()}${draftUrl}`;
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
  if (!draftUrl) throw new Error('Artifact has no private draft URL');
  const url = /^https?:\/\//i.test(draftUrl) ? draftUrl : `${host.getApiOrigin()}${draftUrl}`;
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
