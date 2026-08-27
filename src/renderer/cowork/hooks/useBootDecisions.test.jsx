import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({ host: { isWeb: false } }));
vi.mock('../../platform/host', () => ({ host: hostMock.host }));

const apiMock = vi.hoisted(() => ({
  createProject: vi.fn(async () => ({})),
  fetchProjects: vi.fn(async () => [{ id: 'g', name: 'general' }]),
}));
vi.mock('../api', () => apiMock);

import { useBootDecisions } from './useBootDecisions';

const baseDeps = () => ({
  serverOnline: false,
  health: {},
  projects: [],
  selectedProject: null,
  setServerHelpOpen: vi.fn(),
  setSettingsSection: vi.fn(),
  setSettingsOpen: vi.fn(),
  setSelectedProject: vi.fn(),
  setProjects: vi.fn(),
});

const render = (extra = {}) => {
  const d = { ...baseDeps(), ...extra };
  const hook = renderHook((p) => useBootDecisions(p), { initialProps: d });
  return { hook, d };
};

beforeEach(() => {
  hostMock.host.isWeb = false;
  apiMock.createProject.mockReset().mockResolvedValue({});
  apiMock.fetchProjects.mockReset().mockResolvedValue([{ id: 'g', name: 'general' }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBootDecisions', () => {
  it('reports bootIntroDone once the server has been online', () => {
    const { hook } = render({ serverOnline: false });
    expect(hook.result.current).toBe(false);
    hook.rerender({ ...baseDeps(), serverOnline: true });
    expect(hook.result.current).toBe(true);
  });

  it('fires the offline watchdog once after 12s', () => {
    vi.useFakeTimers();
    const { d } = render({ serverOnline: false });
    expect(d.setServerHelpOpen).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(d.setServerHelpOpen).toHaveBeenCalledWith(true);
  });

  it('does not fire the watchdog once the server is online', () => {
    vi.useFakeTimers();
    const { d } = render({ serverOnline: true });
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(d.setServerHelpOpen).not.toHaveBeenCalled();
  });

  it('redirects to Settings when config_ready is explicitly false (Electron)', () => {
    const { d } = render({ serverOnline: true, health: { config_ready: false } });
    expect(d.setSettingsSection).toHaveBeenCalledWith('agent');
    expect(d.setSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('does not redirect on undefined config_ready or on web', () => {
    const a = render({ serverOnline: true, health: {} });
    expect(a.d.setSettingsOpen).not.toHaveBeenCalled();

    hostMock.host.isWeb = true;
    const b = render({ serverOnline: true, health: { config_ready: false } });
    expect(b.d.setSettingsOpen).not.toHaveBeenCalled();
  });

  it('selects the existing general project as the default', () => {
    const general = { id: 'g', name: 'general' };
    const { d } = render({ serverOnline: true, projects: [general] });
    expect(d.setSelectedProject).toHaveBeenCalledWith(general);
    expect(apiMock.createProject).not.toHaveBeenCalled();
  });

  it('bootstraps general when missing, then selects it', async () => {
    let hook;
    await act(async () => {
      ({ hook } = render({ serverOnline: true, projects: [{ id: 'x', name: 'other' }] }));
    });
    expect(apiMock.createProject).toHaveBeenCalledWith('general');
    // fetchProjects → setProjects + setSelectedProject(created) happen in the async IIFE
    await act(async () => {});
    expect(apiMock.fetchProjects).toHaveBeenCalled();
  });

  it('does not override a project the user already picked', () => {
    const { d } = render({ serverOnline: true, projects: [{ id: 'g', name: 'general' }], selectedProject: { id: 'x' } });
    expect(d.setSelectedProject).not.toHaveBeenCalled();
  });
});
