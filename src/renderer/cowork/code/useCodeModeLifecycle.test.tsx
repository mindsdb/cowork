import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ cancel: vi.fn(), sessions: vi.fn() }));
vi.mock('./api', () => ({ codingApi: apiMock }));

import type { CodingSession } from './api';
import {
  isCodeSessionActive,
  stopActiveCodeSessions,
  stopCurrentCodeSessions,
  useCodeModeLifecycle,
} from './useCodeModeLifecycle';

function session(id: string, status: CodingSession['status']): CodingSession {
  return {
    id,
    status,
    title: id,
    schema_version: 1,
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'gpt',
    permission_mode: 'supervised',
    source_path: '/source',
    workspace_path: `/workspace/${id}`,
    workspace_kind: 'git_worktree',
    source_dirty: false,
    event_count: 0,
    created_at: '',
    updated_at: '',
  };
}

describe('useCodeModeLifecycle', () => {
  beforeEach(() => {
    apiMock.cancel.mockReset();
    apiMock.sessions.mockReset();
  });

  it('does not stop tasks merely because the app starts with Code disabled', () => {
    const onDisable = vi.fn();
    renderHook(() => useCodeModeLifecycle({
      enabled: false,
      sessions: [session('active', 'running')],
      onDisable,
      onSessionsChange: vi.fn(),
    }));
    expect(onDisable).not.toHaveBeenCalled();
    expect(apiMock.cancel).not.toHaveBeenCalled();
  });

  it('hides Code immediately and stops only active tasks when the opt-in is turned off', async () => {
    const active = session('active', 'running');
    const waiting = session('waiting', 'awaiting_approval');
    const complete = session('complete', 'completed');
    const stopped = { ...active, status: 'cancelled' as const };
    apiMock.cancel.mockImplementation(async (id: string) => (
      id === active.id ? stopped : { ...waiting, status: 'cancelled' as const }
    ));
    const onDisable = vi.fn();
    const onSessionsChange = vi.fn();
    apiMock.sessions.mockResolvedValue({ items: [active, waiting, complete] });
    const props = { enabled: true, sessions: [active, waiting, complete] };
    const view = renderHook(
      ({ enabled, sessions }) => useCodeModeLifecycle({
        enabled,
        sessions,
        onDisable,
        onSessionsChange,
      }),
      { initialProps: props },
    );

    view.rerender({ ...props, enabled: false });

    expect(onDisable).toHaveBeenCalledOnce();
    await waitFor(() => expect(apiMock.cancel).toHaveBeenCalledTimes(2));
    expect(apiMock.cancel).toHaveBeenCalledWith('active');
    expect(apiMock.cancel).toHaveBeenCalledWith('waiting');
    await waitFor(() => expect(onSessionsChange).toHaveBeenCalledWith([
      stopped,
      { ...waiting, status: 'cancelled' },
      complete,
    ]));
  });

  it('loads the authoritative task list before deciding what to stop', async () => {
    const recovering = {
      ...session('recovering', 'ready'),
      run_status: 'recovering' as const,
    };
    const stopped = {
      ...recovering,
      run_status: 'cancelled' as const,
      status: 'cancelled' as const,
    };
    apiMock.sessions.mockResolvedValue({ items: [recovering] });
    apiMock.cancel.mockResolvedValue(stopped);
    const onSessionsChange = vi.fn();
    const props = { enabled: true };
    const view = renderHook(
      ({ enabled }) => useCodeModeLifecycle({
        enabled,
        sessions: [],
        onDisable: vi.fn(),
        onSessionsChange,
      }),
      { initialProps: props },
    );

    view.rerender({ enabled: false });

    await waitFor(() => expect(apiMock.sessions).toHaveBeenCalledWith(true));
    expect(apiMock.cancel).toHaveBeenCalledWith('recovering');
    await waitFor(() => expect(onSessionsChange).toHaveBeenCalledWith([stopped]));
  });

  it('keeps the development fixture mounted regardless of the local preference', () => {
    const onDisable = vi.fn();
    const props = { enabled: true };
    const view = renderHook(
      ({ enabled }) => useCodeModeLifecycle({
        enabled,
        fixtureActive: true,
        sessions: [session('active', 'running')],
        onDisable,
        onSessionsChange: vi.fn(),
      }),
      { initialProps: props },
    );
    view.rerender({ enabled: false });
    expect(onDisable).not.toHaveBeenCalled();
    expect(apiMock.cancel).not.toHaveBeenCalled();
  });

  it('reports stop failures without deleting or rewriting task state', async () => {
    const active = session('active', 'running');
    const result = await stopActiveCodeSessions(
      [active],
      vi.fn(async () => { throw new Error('offline'); }),
    );
    expect(result).toEqual({ sessions: [active], stopped: 0, failed: 1 });
  });

  it('treats an active run as live even when the session status is ready', () => {
    expect(isCodeSessionActive({
      ...session('remote', 'ready'),
      run_status: 'recovering',
    })).toBe(true);
    expect(isCodeSessionActive({
      ...session('complete', 'ready'),
      run_status: 'completed',
    })).toBe(false);
  });

  it('falls back to cached tasks and reports when authoritative discovery fails', async () => {
    const active = session('active', 'running');
    const stopped = { ...active, status: 'cancelled' as const };
    const result = await stopCurrentCodeSessions(
      [active],
      vi.fn(async () => { throw new Error('offline'); }),
      vi.fn(async () => stopped),
    );
    expect(result).toEqual({
      sessions: [stopped],
      stopped: 1,
      failed: 0,
      discoveryFailed: true,
    });
  });
});
