import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


const api = vi.hoisted(() => ({
  session: vi.fn(),
  events: vi.fn(),
  git: vi.fn(),
  diff: vi.fn(),
  openStream: vi.fn(() => () => {}),
}));

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    codingApi: api,
    openCodingEventStream: api.openStream,
  };
});

import { useCodingSession } from './useCodingSession';


function session(id: string, title = id): CodingSession {
  return {
    schema_version: 1,
    id,
    title,
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'fable',
    permission_mode: 'supervised',
    status: 'completed',
    source_path: `/work/${id}`,
    workspace_path: `/work/${id}-task`,
    workspace_kind: 'git_worktree',
    source_dirty: false,
    event_count: 0,
    created_at: '2026-08-21T09:00:00Z',
    updated_at: '2026-08-21T09:05:00Z',
  };
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}


describe('useCodingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.events.mockResolvedValue({ items: [], next_seq: 0 });
    api.git.mockImplementation(async (id: string) => ({
      is_git: true,
      detached: true,
      dirty: false,
      status_lines: [],
      worktree_path: `/work/${id}-task`,
      source_path: `/work/${id}`,
    }));
    api.diff.mockResolvedValue({ files: [] });
  });

  it('does not let a late refresh from the previous task overwrite the selected task', async () => {
    const lateA = deferred<CodingSession>();
    let aCalls = 0;
    api.session.mockImplementation(async (id: string) => {
      if (id === 'a' && ++aCalls > 1) return lateA.promise;
      return session(id);
    });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCodingSession(id),
      { initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(result.current.session?.id).toBe('a'));

    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.session?.id).toBe('b'));

    lateA.resolve(session('a', 'late result'));
    await act(async () => { await refresh; });

    expect(result.current.session?.id).toBe('b');
    expect(result.current.session?.title).toBe('b');
  });

  it('loads the task and opens live updates when optional Git review data fails', async () => {
    api.session.mockResolvedValue(session('a'));
    api.git.mockRejectedValueOnce(new Error('git temporarily unavailable'));
    api.diff.mockRejectedValueOnce(new Error('diff temporarily unavailable'));

    const { result } = renderHook(() => useCodingSession('a'));

    await waitFor(() => expect(result.current.session?.id).toBe('a'));
    expect(api.openStream).toHaveBeenCalledWith('a', 0, expect.any(Function), expect.any(Function));
    expect(result.current.loading).toBe(false);
  });

  it('reconciles event frames missed while the live stream is disconnected', async () => {
    vi.useFakeTimers();
    try {
      api.session.mockResolvedValue(session('a'));
      api.events
        .mockResolvedValueOnce({ items: [], next_seq: 0 })
        .mockResolvedValueOnce({
          items: [{
            schema_version: 1,
            seq: 1,
            timestamp: '2026-08-21T09:05:01Z',
            type: 'agent_message',
            title: '',
            text: 'Recovered output',
            phase: 'completed',
            data: {},
          }],
          next_seq: 1,
        });
      const { result } = renderHook(() => useCodingSession('a'));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      await act(async () => { vi.advanceTimersByTime(2_500); await Promise.resolve(); await Promise.resolve(); });

      expect(result.current.events.map((item) => item.text)).toEqual(['Recovered output']);
      expect(api.events).toHaveBeenLastCalledWith('a', 0);
    } finally {
      vi.useRealTimers();
    }
  });
});
