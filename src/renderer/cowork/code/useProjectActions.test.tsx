import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codingApi } from './api';
import { useProjectActions } from './useProjectActions';


vi.mock('./api', () => ({
  codingApi: {
    projectActions: vi.fn(),
    runProjectAction: vi.fn(),
  },
}));

vi.mock('./terminalPreferences', () => ({
  getTerminalShellPreference: () => 'bash',
}));


describe('useProjectActions', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('loads actions for the current task and carries its preview forward', async () => {
    vi.mocked(codingApi.projectActions).mockResolvedValue({
      items: [{ id: 'serve', resource_id: 'web', resource_name: 'Web', label: 'Dev server' }],
      preview_url: 'http://127.0.0.1:4173',
    });

    const { result } = renderHook(() => useProjectActions('task-1'));

    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    expect(result.current.previewUrl).toBe('http://127.0.0.1:4173');
  });

  it('runs one declared action with the user shell preference', async () => {
    const action = { id: 'serve', resource_id: 'web', resource_name: 'Web', label: 'Dev server' };
    vi.mocked(codingApi.projectActions).mockResolvedValue({ items: [action], preview_url: null });
    vi.mocked(codingApi.runProjectAction).mockResolvedValue({
      terminal_id: 'terminal-2',
      label: 'Dev server',
      preview_url: 'http://127.0.0.1:5173',
    });
    const { result } = renderHook(() => useProjectActions('task-1'));
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => { await result.current.run(action); });

    expect(codingApi.runProjectAction).toHaveBeenCalledWith('task-1', {
      resource_id: 'web',
      command_id: 'serve',
      shell: 'bash',
    });
    expect(result.current.previewUrl).toBe('http://127.0.0.1:5173');
    expect(result.current.busy).toBe(false);
  });

  it('removes preview availability after its run terminal stops', async () => {
    const action = { id: 'serve', resource_id: 'web', resource_name: 'Web', label: 'Dev server' };
    vi.useFakeTimers();
    vi.mocked(codingApi.projectActions)
      .mockResolvedValueOnce({ items: [action], preview_url: 'http://127.0.0.1:5173' })
      .mockResolvedValue({ items: [action], preview_url: null });

    const { result } = renderHook(() => useProjectActions('task-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.previewUrl).toBe('http://127.0.0.1:5173');

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });

    expect(result.current.previewUrl).toBeNull();
    expect(codingApi.projectActions).toHaveBeenCalledTimes(2);
  });
});
