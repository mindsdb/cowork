import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchSkills: vi.fn(),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
  setSkillSharing: vi.fn(),
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

  it('re-fetches for a new subscriber after a failed load', async () => {
    // A failed first load leaves an unverified empty list behind. Nothing
    // re-fetches on its own, so without this every card would keep treating a
    // shared skill as absent (and creatable) for the rest of the session.
    const shared = { label: 'shared-skill', capabilities: { canEdit: false } };
    api.fetchSkills
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ skills: [shared] });

    const { useSkills } = await import('./skillsStore');
    const first = renderHook(() => useSkills());
    await waitFor(() => expect(first.result.current.catalogueStatus).toBe('error'));
    expect(api.fetchSkills).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useSkills());

    await waitFor(() => expect(second.result.current.catalogueStatus).toBe('loaded'));
    expect(api.fetchSkills).toHaveBeenCalledTimes(2);
    expect(second.result.current.skills).toEqual([shared]);
    expect(first.result.current.skills).toEqual([shared]);
  });

  it('does not re-fetch for a new subscriber once the catalogue is loaded', async () => {
    api.fetchSkills.mockResolvedValue({ skills: [] });

    const { useSkills } = await import('./skillsStore');
    const first = renderHook(() => useSkills());
    await waitFor(() => expect(first.result.current.catalogueStatus).toBe('loaded'));

    const second = renderHook(() => useSkills());
    await waitFor(() => expect(second.result.current.catalogueStatus).toBe('loaded'));

    expect(api.fetchSkills).toHaveBeenCalledTimes(1);
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

describe('skillsStore sharing', () => {
  it("follows the list's canShare, false before a load and kept across a failed refresh", async () => {
    api.fetchSkills
      .mockResolvedValueOnce({ skills: [], canShare: true })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ skills: [] });

    const { useSkills } = await import('./skillsStore');
    const { result } = renderHook(() => useSkills());
    expect(result.current.canShare).toBe(false);

    await waitFor(() => expect(result.current.catalogueStatus).toBe('loaded'));
    expect(result.current.canShare).toBe(true);

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.catalogueStatus).toBe('error');
    expect(result.current.canShare).toBe(true);

    // An older server sends no flag at all, which never reads as a grant.
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.catalogueStatus).toBe('loaded');
    expect(result.current.canShare).toBe(false);
  });

  it.each([
    ['the string "true"', 'true'],
    ['the number 1', 1],
  ])('never reads %s as a grant', async (_, canShare) => {
    api.fetchSkills.mockResolvedValueOnce({ skills: [], canShare });

    const { useSkills } = await import('./skillsStore');
    const { result } = renderHook(() => useSkills());

    await waitFor(() => expect(result.current.catalogueStatus).toBe('loaded'));
    expect(result.current.canShare).toBe(false);
  });

  it('stays false when the first load fails', async () => {
    api.fetchSkills.mockRejectedValueOnce(new Error('network unavailable'));

    const { useSkills } = await import('./skillsStore');
    const { result } = renderHook(() => useSkills());

    await waitFor(() => expect(result.current.catalogueStatus).toBe('error'));
    expect(result.current.canShare).toBe(false);
  });

  it('reloads the list after the sharing write, with a request that starts after it', async () => {
    const before = { label: 'weekly-report', shared: false, capabilities: { canShare: true } };
    const after = { ...before, shared: true };
    let resolveStaleRequest;
    api.fetchSkills
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStaleRequest = resolve;
      }))
      .mockResolvedValueOnce({ skills: [after], canShare: true });
    api.setSkillSharing.mockResolvedValue(after);

    const { reloadSkills, setSkillSharingAndSync, useSkills } = await import('./skillsStore');
    const { result } = renderHook(() => useSkills());
    const staleReload = reloadSkills();
    await waitFor(() => expect(api.fetchSkills).toHaveBeenCalledTimes(1));

    const sharing = setSkillSharingAndSync('weekly-report', true);
    await waitFor(() => expect(api.setSkillSharing).toHaveBeenCalledWith('weekly-report', true));
    expect(api.fetchSkills).toHaveBeenCalledTimes(1);

    let saved;
    await act(async () => {
      resolveStaleRequest({ skills: [before], canShare: true });
      [, saved] = await Promise.all([staleReload, sharing]);
    });

    expect(saved).toEqual(after);
    expect(api.fetchSkills).toHaveBeenCalledTimes(2);
    expect(result.current.skills).toEqual([after]);
  });

  it('re-throws a refused write without reloading', async () => {
    api.fetchSkills.mockResolvedValue({ skills: [], canShare: true });
    const refusal = Object.assign(new Error('Sharing is busy right now. Try again in a moment.'), { status: 503 });
    api.setSkillSharing.mockRejectedValue(refusal);

    const { setSkillSharingAndSync } = await import('./skillsStore');

    await expect(setSkillSharingAndSync('weekly-report', true)).rejects.toBe(refusal);
    expect(api.fetchSkills).not.toHaveBeenCalled();
  });
});
