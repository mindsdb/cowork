import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ isWeb: false }));
const api = vi.hoisted(() => ({
  enableDraftComments: vi.fn(),
  loadArtifactRevision: vi.fn(),
  loadArtifactSource: vi.fn(),
  loadArtifactRevisions: vi.fn(),
}));

vi.mock('../../../../platform/host', () => ({ host: platform }));
vi.mock('../../../lib/artifactWorkspaceApi', () => ({
  canUseArtifactWorkspace: (artifact) => !!artifact?.stableId,
  enableDraftComments: (...args) => api.enableDraftComments(...args),
  loadArtifactSource: (...args) => api.loadArtifactSource(...args),
  loadArtifactRevisions: (...args) => api.loadArtifactRevisions(...args),
  cancelAgentRepair: vi.fn(),
  decideAgentRepair: vi.fn(),
  loadAgentRepair: vi.fn(),
  loadArtifactRevision: (...args) => api.loadArtifactRevision(...args),
  requestAgentRepair: vi.fn(),
  restoreArtifactRevision: vi.fn(),
  saveArtifactSource: vi.fn(),
}));

import { useArtifactWorkspace } from './useArtifactWorkspace';

const artifact = {
  stableId: '11111111-1111-4111-8111-111111111111',
  projectId: '00000000-0000-0000-0000-000000000001',
};
const source = {
  content: '<h1>Hello</h1>',
  path: 'index.html',
  revision: { id: 'rev-1' },
  capabilities: { role: 'owner', canEdit: true, canComment: true },
};

beforeEach(() => {
  platform.isWeb = false;
  api.enableDraftComments.mockReset();
  api.loadArtifactRevision.mockReset().mockResolvedValue({
    id: 'rev-0', number: 0, path: 'index.html', content: '<h1>Before</h1>',
  });
  api.loadArtifactSource.mockReset().mockResolvedValue(source);
  api.loadArtifactRevisions.mockReset().mockResolvedValue({ revisions: [] });
});

describe('useArtifactWorkspace collaboration transport', () => {
  it('uses local review on desktop even though desktop cards have a project id', async () => {
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.commentsReady).toBe(true);
    expect(api.enableDraftComments).not.toHaveBeenCalled();
  });

  it('provisions authenticated draft review in the web SaaS', async () => {
    platform.isWeb = true;
    api.enableDraftComments.mockResolvedValue({
      enabled: true,
      currentRevision: { id: 'rev-1' },
      capabilities: source.capabilities,
    });

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.commentsReady).toBe(true);
    expect(api.enableDraftComments).toHaveBeenCalledWith(artifact);
  });

  it('closes a comparison when the user deliberately changes workspace mode', async () => {
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(() => result.current.compareRevision('rev-0'));
    expect(result.current.comparison).not.toBeNull();

    act(() => result.current.setMode('edit'));
    expect(result.current.mode).toBe('edit');
    expect(result.current.comparison).toBeNull();
  });
});
