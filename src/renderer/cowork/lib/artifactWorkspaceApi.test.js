import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ authFetch: vi.fn(), BASE: '/api/v1' }));

import { artifactRef, canUseArtifactWorkspace, loadArtifactDraftText } from './artifactWorkspaceApi';
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
});
