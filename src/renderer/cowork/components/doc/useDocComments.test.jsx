// A doc's comments are reached the way an artifact's are: at once on the
// desktop, and on the web once the owner switched them on (or a reviewer's
// review entry answered).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactReview: vi.fn(),
  enableDraftComments: vi.fn(),
}));
vi.mock('../artifact/comments', () => ({
  useArtifactComments: vi.fn(() => ({ threads: [], create: vi.fn(), reply: vi.fn() })),
  useCommentActions: vi.fn(() => ({ create: vi.fn(), reply: vi.fn(), loadImage: vi.fn() })),
}));

import { useDocComments } from './useDocComments';
import { enableDraftComments, loadArtifactReview } from '../../lib/artifactWorkspaceApi';
import { useArtifactComments } from '../artifact/comments';
import { host } from '../../../platform/host';

const ID = '0123456789abcdef0123456789abcdef';
const KEY = '01234567-89ab-cdef-0123-456789abcdef';
const wasWeb = host.isWeb;
const open = (options = {}) => renderHook(() => useDocComments({ projectRef: 'p1', artifactId: ID, enabled: true, ...options }));

beforeEach(() => {
  vi.mocked(loadArtifactReview).mockReset();
  vi.mocked(enableDraftComments).mockReset();
  vi.mocked(useArtifactComments).mockClear();
});
afterEach(() => { host.isWeb = wasWeb; });

describe('useDocComments', () => {
  it('reaches the doc folder\'s comments at once on the desktop', async () => {
    host.isWeb = false;
    const { result } = open();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(useArtifactComments).toHaveBeenLastCalledWith('artifact', KEY, { enabled: true });
    expect(loadArtifactReview).not.toHaveBeenCalled();
  });

  it('stays off for a doc without a full id, or while not asked for', () => {
    host.isWeb = false;
    expect(open({ artifactId: 'a1' }).result.current.enabled).toBe(false);
    expect(open({ enabled: false }).result.current.enabled).toBe(false);
  });

  it('switches the owner\'s draft comments on, on the web', async () => {
    host.isWeb = true;
    vi.mocked(loadArtifactReview).mockResolvedValue({ capabilities: { canEdit: true } });
    vi.mocked(enableDraftComments).mockResolvedValue({ enabled: true });
    const { result } = open();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(enableDraftComments).toHaveBeenCalledWith({ id: ID, projectId: 'p1' });
  });

  it('takes a reviewer\'s review entry as the grant, provisioning nothing', async () => {
    host.isWeb = true;
    vi.mocked(loadArtifactReview).mockResolvedValue({ capabilities: { canEdit: false } });
    const { result } = open();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(enableDraftComments).not.toHaveBeenCalled();
  });

  it('has no comments when the review entry is refused', async () => {
    host.isWeb = true;
    vi.mocked(loadArtifactReview).mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
    const { result } = open();
    await waitFor(() => expect(loadArtifactReview).toHaveBeenCalled());
    expect(result.current.enabled).toBe(false);
  });
});
