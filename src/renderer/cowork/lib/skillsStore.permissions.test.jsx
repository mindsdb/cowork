import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchSkills: vi.fn(),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
}));

vi.mock('../api', () => api);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('skillsStore catalogue provenance', () => {
  it('distinguishes a failure-derived empty list from a verified empty catalogue', async () => {
    const { useSkills } = await import('./skillsStore');
    api.fetchSkills
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ skills: [] });

    const { result } = renderHook(() => useSkills());

    await waitFor(() => expect(result.current.catalogueStatus).toBe('error'));
    expect(result.current.skills).toEqual([]);

    let refreshed;
    await act(async () => {
      refreshed = await result.current.reload();
    });

    expect(refreshed).toEqual({ ok: true, skills: [] });
    expect(result.current.catalogueStatus).toBe('loaded');
    expect(result.current.skills).toEqual([]);
  });

  it('waits for a pre-save catalogue request and then starts a fresh request', async () => {
    let resolveStaleRequest;
    const staleRequest = new Promise((resolve) => {
      resolveStaleRequest = resolve;
    });
    const freshSkill = {
      label: 'shared-skill',
      declarative: 'Fresh server revision.',
      capabilities: { canEdit: true },
    };
    api.fetchSkills
      .mockReturnValueOnce(staleRequest)
      .mockResolvedValueOnce({ skills: [freshSkill] });
    api.saveSkill.mockResolvedValue({ label: freshSkill.label });

    const { useSkills, saveSkillAndSync } = await import('./skillsStore');
    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.catalogueStatus).toBe('loading'));
    expect(api.fetchSkills).toHaveBeenCalledTimes(1);

    let saving;
    act(() => {
      saving = saveSkillAndSync({ label: freshSkill.label }, false);
    });
    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    expect(api.fetchSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStaleRequest({
        skills: [{
          ...freshSkill,
          declarative: 'Snapshot from before the save.',
        }],
      });
      await saving;
    });

    expect(api.fetchSkills).toHaveBeenCalledTimes(2);
    expect(result.current.catalogueStatus).toBe('loaded');
    expect(result.current.skills).toEqual([freshSkill]);
  });

  it('waits for a pre-delete catalogue request and then starts a fresh request', async () => {
    let resolveStaleRequest;
    api.fetchSkills
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStaleRequest = resolve;
      }))
      .mockResolvedValueOnce({ skills: [] });
    api.deleteSkill.mockResolvedValue({ status: 'deleted' });

    const { deleteSkillAndSync, reloadSkills } = await import('./skillsStore');
    const staleReload = reloadSkills();
    await waitFor(() => expect(api.fetchSkills).toHaveBeenCalledTimes(1));

    const deleting = deleteSkillAndSync('shared-skill');
    await waitFor(() => expect(api.deleteSkill).toHaveBeenCalledWith('shared-skill'));
    expect(api.fetchSkills).toHaveBeenCalledTimes(1);

    resolveStaleRequest({ skills: [{ label: 'shared-skill' }] });
    await Promise.all([staleReload, deleting]);

    expect(api.fetchSkills).toHaveBeenCalledTimes(2);
  });
});
