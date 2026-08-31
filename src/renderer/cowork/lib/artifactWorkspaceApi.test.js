import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ authFetch: vi.fn(), BASE: '/api/v1' }));

import {
  artifactRef,
  canUseArtifactWorkspace,
  loadArtifactDraftText,
  loadArtifactDraftDocument,
} from './artifactWorkspaceApi';
import { authFetch } from '../api';

// The workspace API addresses an artifact by its one identity. A card built
// before ids were widened cannot address it at all, so the viewer has to fall
// back to preview instead of issuing a request that would 404.
describe('artifact workspace addressing', () => {
  it('addresses the workspace by the artifact id', () => {
    const ref = artifactRef({
      id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70',
      projectId: 'proj-1',
    });

    expect(ref.base).toBe('/artifacts/workspace/proj-1/7db94eb8f0a54c7e9c1d2b3a4f5e6d70');
  });

  it('falls back to the local project ref on desktop', () => {
    const ref = artifactRef({ id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70' });

    expect(ref.base).toBe('/artifacts/workspace/local/7db94eb8f0a54c7e9c1d2b3a4f5e6d70');
  });

  it('addresses a replayed pre-widening card through its stableId', () => {
    const ref = artifactRef({
      id: '7db94eb8',
      stableId: '7db94eb8-f0a5-4c7e-9c1d-2b3a4f5e6d70',
    });

    expect(ref.base).toBe('/artifacts/workspace/local/7db94eb8f0a54c7e9c1d2b3a4f5e6d70');
  });

  it('reports unsupported for a card with no resolvable identity', () => {
    expect(canUseArtifactWorkspace({ id: '7db94eb8' })).toBe(false);
    expect(canUseArtifactWorkspace({})).toBe(false);
    expect(canUseArtifactWorkspace(null)).toBe(false);
  });
});

/*
 * The org-mode text preview reads the draft endpoint, which streams the whole
 * file. Every click on every surface opens it now, so the ceiling and the
 * "there is more" flag both have to live here — the desktop endpoint applies
 * its own 200k cut server-side and this path had neither.
 */
describe('loadArtifactDraftText', () => {
  const respond = (body) => {
    authFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(body),
      headers: { get: () => 'text/plain' },
    });
  };

  it('caps the body at the same 200k the desktop preview uses', async () => {
    respond('x'.repeat(200_001));

    const preview = await loadArtifactDraftText('/api/v1/artifacts/drafts/p/1/log.txt');

    expect(preview.content).toHaveLength(200_000);
    expect(preview.truncated).toBe(true);
  });

  it('reports a body under the cap as whole', async () => {
    respond('# Report\n');

    const preview = await loadArtifactDraftText('/api/v1/artifacts/drafts/p/1/report.md');

    expect(preview.content).toBe('# Report\n');
    expect(preview.truncated).toBe(false);
  });

  it('refuses to attach credentials to a cross-origin draft URL', async () => {
    authFetch.mockClear();
    await expect(loadArtifactDraftText('https://evil.example/report.md')).rejects.toThrow();
    expect(authFetch).not.toHaveBeenCalled();
  });
});

/*
 * The draft-HTML preview branch in ArtifactViewer feeds this straight into an
 * iframe's `srcdoc`. loadArtifactDraftText's 200k cap (added for the text
 * preview, ENG-2066) would silently truncate any HTML document over 200KB
 * before it reached the DOM — this helper exists specifically to not do that.
 */
describe('loadArtifactDraftDocument', () => {
  const respond = (body, contentType = 'text/html; charset=utf-8') => {
    authFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(body),
      headers: { get: () => contentType },
    });
  };

  it('does not cap the body the way loadArtifactDraftText does', async () => {
    const big = `<html>${'x'.repeat(250_000)}</html>`;
    respond(big);

    const doc = await loadArtifactDraftDocument('/api/v1/artifacts/drafts/p/1/index.html');

    expect(doc.content).toBe(big);
    expect(doc.content.length).toBeGreaterThan(200_000);
  });

  it('reports HTML content by prefix, ignoring the charset suffix', async () => {
    respond('<html></html>', 'text/html; charset=utf-8');

    const doc = await loadArtifactDraftDocument('/api/v1/artifacts/drafts/p/1/index.html');

    expect(doc.isHtml).toBe(true);
    expect(doc.contentType).toBe('text/html; charset=utf-8');
  });

  it('reports non-HTML content as such', async () => {
    respond('plain text', 'text/plain; charset=utf-8');

    const doc = await loadArtifactDraftDocument('/api/v1/artifacts/drafts/p/1/notes.txt');

    expect(doc.isHtml).toBe(false);
  });

  it('throws a readable error carrying the status on a non-ok response', async () => {
    authFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(loadArtifactDraftDocument('/api/v1/artifacts/drafts/p/1/index.html'))
      .rejects.toMatchObject({ message: 'Could not load private draft (401)', status: 401 });
  });

  /*
   * The viewer already routes data:/blob: and cross-origin draft URLs around
   * this function entirely (canFetchDraftWithCredentials in
   * artifactPreviewUtils.js) — this is the defense-in-depth backstop for the
   * one function that actually attaches the bearer token, so the invariant
   * holds even if some future caller forgets to gate first.
   */
  it('refuses to attach credentials to a cross-origin draft URL', async () => {
    authFetch.mockClear();
    await expect(loadArtifactDraftDocument('https://evil.example/index.html')).rejects.toThrow();
    expect(authFetch).not.toHaveBeenCalled();
  });
});
