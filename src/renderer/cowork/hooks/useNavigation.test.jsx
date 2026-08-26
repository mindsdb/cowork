import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNavigation } from './useNavigation';
import { fetchArtifacts, fetchProjects } from '../api';

vi.mock('../CoworkRouter', () => ({
  createCoworkRouter: vi.fn(() => ({ id: 'router' })),
  initialNavState: vi.fn(() => ({
    route: 'home',
    activeTaskId: null,
    selectedScheduleId: null,
    selectedProjectId: null,
  })),
}));

vi.mock('../api', () => ({
  fetchArtifacts: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => []),
}));

const makeDeps = (over = {}) => ({
  orgMode: false,
  sidebarPopout: false,
  setNavPopoutOpen: vi.fn(),
  setComingSoonFeature: vi.fn(),
  openSettings: vi.fn(),
  setTasks: vi.fn(),
  setProjects: vi.fn(),
  setArtifacts: vi.fn(),
  refreshSchedules: vi.fn(async () => []),
  setConversationError: vi.fn(),
  ...over,
});

const render = (deps) => {
  const d = makeDeps(deps);
  const view = renderHook(() => useNavigation(d));
  return { ...view, deps: d };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useNavigation', () => {
  it('seeds route and the router from initialNavState', () => {
    const { result } = render();
    expect(result.current.route).toBe('home');
    expect(result.current.routerRef.current).toEqual({ id: 'router' });
    expect(result.current.routeRef.current).toBe('home');
  });

  it('navigate(key) flips the route and mirrors it into routeRef', () => {
    const { result } = render();
    act(() => result.current.navigate('artifacts'));
    expect(result.current.route).toBe('artifacts');
    expect(result.current.routeRef.current).toBe('artifacts');
  });

  it('navigate("projects") clears any selected project before routing to the grid', () => {
    const { result } = render();
    act(() => result.current.setSelectedProject({ id: 'p1' }));
    act(() => result.current.navigate('projects'));
    expect(result.current.selectedProject).toBe(null);
    expect(result.current.route).toBe('projects');
  });

  it('navigate("settings:backend") opens Settings instead of routing', () => {
    const { result, deps } = render();
    act(() => result.current.navigate('settings:backend'));
    expect(deps.openSettings).toHaveBeenCalledWith('backend');
    expect(result.current.route).toBe('home'); // unchanged
  });

  it('navigate("customize") in org mode shows the coming-soon popup and does not route', () => {
    const { result, deps } = render({ orgMode: true });
    act(() => result.current.navigate('customize'));
    expect(deps.setComingSoonFeature).toHaveBeenCalledWith('Connect Apps and Data');
    expect(result.current.route).toBe('home');
  });

  it('navigate closes the nav popout when the sidebar is in popout mode', () => {
    const { result, deps } = render({ sidebarPopout: true });
    act(() => result.current.navigate('artifacts'));
    expect(deps.setNavPopoutOpen).toHaveBeenCalledWith(false);
  });

  it('enterHome resets route and clears the conversation error + pending detail', async () => {
    const { result, deps } = render();
    await act(async () => { await result.current.enterProjectDetail('p1'); });
    act(() => result.current.enterHome());
    expect(result.current.route).toBe('home');
    expect(result.current.projectDetailPending).toBe(null);
    expect(deps.setConversationError).toHaveBeenCalledWith(null);
  });

  it('enterRoute("artifacts") fetches and stores the artifact list', async () => {
    fetchArtifacts.mockResolvedValue([{ id: 'a1' }]);
    const { result, deps } = render();
    await act(async () => { result.current.enterRoute('artifacts'); await Promise.resolve(); });
    expect(result.current.route).toBe('artifacts');
    expect(fetchArtifacts).toHaveBeenCalled();
    expect(deps.setArtifacts).toHaveBeenCalledWith([{ id: 'a1' }]);
  });

  it('enterRoute("scheduled") refreshes the schedule list', async () => {
    const { result, deps } = render();
    await act(async () => { result.current.enterRoute('scheduled'); await Promise.resolve(); });
    expect(result.current.route).toBe('scheduled');
    expect(deps.refreshSchedules).toHaveBeenCalled();
  });

  it('enterProjectDetail selects a project that exists in the fetched list', async () => {
    fetchProjects.mockResolvedValue([{ id: 'p1', name: 'Alpha' }]);
    const { result } = render();
    let outcome;
    await act(async () => { outcome = await result.current.enterProjectDetail('p1'); });
    expect(outcome).toBe(true);
    expect(result.current.route).toBe('projects');
    expect(result.current.selectedProject).toEqual({ id: 'p1', name: 'Alpha' });
    expect(result.current.projectDetailPending).toBe(null);
  });

  it('enterProjectDetail resolves false and stays on the grid when the id is missing', async () => {
    fetchProjects.mockResolvedValue([{ id: 'other', name: 'Other' }]);
    const { result } = render();
    let outcome;
    await act(async () => { outcome = await result.current.enterProjectDetail('ghost'); });
    expect(outcome).toBe(false);
    expect(result.current.selectedProject).toBe(null);
    expect(result.current.projectDetailPending).toBe('ghost'); // kept: route element bounces the URL
  });

  it('a slow detail resolve is superseded after Back to Home (the back/forward race)', async () => {
    // Hold the fetch open so we can navigate away before it settles.
    let releaseFetch;
    fetchProjects.mockReturnValue(new Promise((resolve) => { releaseFetch = resolve; }));
    const { result } = render();

    let pending;
    act(() => { pending = result.current.enterProjectDetail('p1'); });
    // User presses Back before /projects/p1 resolves.
    act(() => result.current.enterHome());
    // The late response arrives — it must not re-select p1 or leave detail pending.
    await act(async () => { releaseFetch([{ id: 'p1', name: 'Alpha' }]); await pending; });

    expect(result.current.route).toBe('home');
    expect(result.current.selectedProject).toBe(null);
    expect(result.current.projectDetailPending).toBe(null);
  });

  it('enterScheduleDetail routes to the detail view and records the id', async () => {
    const { result, deps } = render();
    await act(async () => { result.current.enterScheduleDetail('s9'); await Promise.resolve(); });
    expect(result.current.route).toBe('schedule-detail');
    expect(result.current.selectedScheduleId).toBe('s9');
    expect(deps.refreshSchedules).toHaveBeenCalled();
  });

  it('clearActive flips active tasks to idle', () => {
    const { result, deps } = render();
    act(() => result.current.clearActive());
    const updater = deps.setTasks.mock.calls[0][0];
    expect(updater([
      { id: 't1', status: 'active' },
      { id: 't2', status: 'idle' },
    ])).toEqual([
      { id: 't1', status: 'idle' },
      { id: 't2', status: 'idle' },
    ]);
  });
});
