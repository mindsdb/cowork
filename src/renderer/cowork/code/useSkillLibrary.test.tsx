import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillLibraryPage } from './api';


const skillLibrary = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({ codingApi: { skillLibrary } }));

import { SkillScopeContext, resetSkillLibraryCache, useSkillLibrary } from './useSkillLibrary';


function page(name: string): SkillLibraryPage {
  return {
    sources: [],
    items: [{ id: `personal:${name}`, kind: 'skill', name, description: '', origin: 'personal', source_name: 'Yours', path: name, enabled: true, enabled_project_ids: [] }],
  };
}


function scoped(scopeKey: string) {
  return ({ children }: { children: ReactNode }) => (
    <SkillScopeContext.Provider value={scopeKey}>{children}</SkillScopeContext.Provider>
  );
}


function names(library: SkillLibraryPage): string[] {
  return library.items.map((item) => item.name);
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}


describe('useSkillLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSkillLibraryCache();
    skillLibrary.mockResolvedValue(page('review'));
  });

  it('serves every consumer of one identity from a single request per projection', async () => {
    const wrapper = scoped('account-one');
    const first = renderHook(() => useSkillLibrary(), { wrapper });
    const second = renderHook(() => useSkillLibrary(), { wrapper });
    expect(first.result.current.loading).toBe(true);

    await waitFor(() => expect(names(first.result.current.page)).toEqual(['review']));
    expect(second.result.current.page).toBe(first.result.current.page);
    expect(second.result.current.loading).toBe(false);
    expect(skillLibrary).toHaveBeenCalledTimes(1);

    renderHook(() => useSkillLibrary(), { wrapper });
    expect(skillLibrary).toHaveBeenCalledTimes(1);

    renderHook(() => useSkillLibrary('project-a'), { wrapper });
    expect(skillLibrary).toHaveBeenCalledTimes(2);
    expect(skillLibrary).toHaveBeenLastCalledWith('project-a');
  });

  it('never shows one identity the catalogue loaded for another', async () => {
    const first = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-one') });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    skillLibrary.mockResolvedValue(page('beta'));

    const second = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-two') });

    expect(second.result.current.page.items).toEqual([]);
    expect(second.result.current.loading).toBe(true);
    await waitFor(() => expect(names(second.result.current.page)).toEqual(['beta']));
    expect(names(first.result.current.page)).toEqual(['review']);

    first.unmount();
    const again = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-one') });
    expect(names(again.result.current.page)).toEqual(['review']);
    expect(again.result.current.loading).toBe(false);
    expect(skillLibrary).toHaveBeenCalledTimes(2);
  });

  it('does not let a late response from the previous identity evict the current catalogue', async () => {
    const oldRequest = deferred<SkillLibraryPage>();
    const newRequest = deferred<SkillLibraryPage>();
    skillLibrary.mockReset();
    skillLibrary.mockImplementationOnce(() => oldRequest.promise).mockImplementationOnce(() => newRequest.promise);
    const oldAccount = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-one') });
    const currentAccount = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-two') });

    await act(async () => { newRequest.resolve(page('current')); });
    expect(names(currentAccount.result.current.page)).toEqual(['current']);

    await act(async () => { oldRequest.resolve(page('old')); });
    expect(names(currentAccount.result.current.page)).toEqual(['current']);
    expect(names(oldAccount.result.current.page)).toEqual(['old']);

    skillLibrary.mockResolvedValue(page('reloaded'));
    await act(async () => { await currentAccount.result.current.reload(); });
    expect(names(currentAccount.result.current.page)).toEqual(['reloaded']);
    expect(names(oldAccount.result.current.page)).toEqual(['old']);
    expect(skillLibrary).toHaveBeenCalledTimes(3);
  });

  it('shows the cached catalogue while refreshing one that has gone stale', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = scoped('account-one');
      const first = renderHook(() => useSkillLibrary(), { wrapper });
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(names(first.result.current.page)).toEqual(['review']);
      first.unmount();

      vi.advanceTimersByTime(29_000);
      renderHook(() => useSkillLibrary(), { wrapper }).unmount();
      expect(skillLibrary).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2_000);
      skillLibrary.mockResolvedValue(page('updated'));
      const second = renderHook(() => useSkillLibrary(), { wrapper });
      expect(names(second.result.current.page)).toEqual(['review']);
      expect(second.result.current.loading).toBe(false);
      expect(skillLibrary).toHaveBeenCalledTimes(2);

      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(names(second.result.current.page)).toEqual(['updated']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes mounted projections on a forced reload and marks unmounted ones stale', async () => {
    const wrapper = scoped('account-one');
    const composer = renderHook(() => useSkillLibrary('project-a'), { wrapper });
    const settings = renderHook(() => useSkillLibrary('project-b'), { wrapper });
    const skills = renderHook(() => useSkillLibrary(), { wrapper });
    await waitFor(() => expect(composer.result.current.loading).toBe(false));
    await waitFor(() => expect(settings.result.current.loading).toBe(false));
    await waitFor(() => expect(skills.result.current.loading).toBe(false));
    expect(skillLibrary).toHaveBeenCalledTimes(3);
    settings.unmount();

    skillLibrary.mockResolvedValue(page('added'));
    await act(async () => { await skills.result.current.reload(); });
    expect(names(skills.result.current.page)).toEqual(['added']);
    await waitFor(() => expect(names(composer.result.current.page)).toEqual(['added']));
    expect(skillLibrary.mock.calls.slice(3)).toEqual([[undefined], ['project-a']]);

    renderHook(() => useSkillLibrary('project-b'), { wrapper });
    expect(skillLibrary).toHaveBeenCalledTimes(6);
    expect(skillLibrary).toHaveBeenLastCalledWith('project-b');
  });

  it('runs a forced reload after an overlapping background request settles', async () => {
    const background = deferred<SkillLibraryPage>();
    const forced = deferred<SkillLibraryPage>();
    skillLibrary.mockReset();
    skillLibrary.mockImplementationOnce(() => background.promise).mockImplementationOnce(() => forced.promise);
    const view = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-one') });

    let reload!: Promise<void>;
    act(() => { reload = view.result.current.reload(); });
    expect(skillLibrary).toHaveBeenCalledTimes(1);

    await act(async () => { background.resolve(page('background')); });
    expect(skillLibrary).toHaveBeenCalledTimes(2);
    expect(names(view.result.current.page)).toEqual(['background']);

    await act(async () => {
      forced.resolve(page('forced'));
      await reload;
    });
    expect(names(view.result.current.page)).toEqual(['forced']);
  });

  it('abandons queued refresh work when the cache lifecycle resets', async () => {
    const obsolete = deferred<SkillLibraryPage>();
    skillLibrary.mockReset();
    skillLibrary
      .mockImplementationOnce(() => obsolete.promise)
      .mockResolvedValue(page('current'));
    const oldView = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-one') });

    let obsoleteReload!: Promise<void>;
    act(() => { obsoleteReload = oldView.result.current.reload(); });
    expect(skillLibrary).toHaveBeenCalledTimes(1);

    resetSkillLibraryCache();
    const currentView = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-two') });
    await waitFor(() => expect(names(currentView.result.current.page)).toEqual(['current']));

    await act(async () => {
      obsolete.resolve(page('obsolete'));
      await obsoleteReload;
    });
    expect(skillLibrary).toHaveBeenCalledTimes(2);
    expect(names(currentView.result.current.page)).toEqual(['current']);
  });

  it('reports a failed load for the identity that requested it', async () => {
    skillLibrary.mockRejectedValue(new Error('The Skills Library is offline.'));
    const view = renderHook(() => useSkillLibrary(), { wrapper: scoped('account-one') });

    await waitFor(() => expect(view.result.current.error).toBe('The Skills Library is offline.'));
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.page.items).toEqual([]);
  });

  it('exposes the cache only through the hook and the test reset', async () => {
    const exported = await import('./useSkillLibrary');
    expect(Object.keys(exported).sort()).toEqual(['SkillScopeContext', 'resetSkillLibraryCache', 'useSkillLibrary']);
  });
});
