import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


const sessions = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  codingApi: { sessions },
}));

import { useCodeTaskList } from './useCodeTaskList';


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}


function renderTaskList(newTask: boolean) {
  const onSelectionChange = vi.fn();
  const onSessionsChange = vi.fn();
  const rendered = renderHook(
    ({ intentionalSurface }: { intentionalSurface: boolean }) => useCodeTaskList({
      sessions: [],
      selectedId: null,
      newTask: intentionalSurface,
      currentSession: null,
      onSessionsChange,
      onSelectionChange,
    }),
    { initialProps: { intentionalSurface: newTask } },
  );
  return { ...rendered, onSelectionChange, onSessionsChange };
}


function codingSession(overrides: Partial<CodingSession> = {}): CodingSession {
  return {
    schema_version: 1,
    id: 'task-1',
    title: 'Task',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'gpt',
    permission_mode: 'supervised',
    status: 'running',
    source_path: '/tmp/repo',
    workspace_path: '/tmp/workspace',
    workspace_kind: 'local_copy',
    source_dirty: false,
    event_count: 1,
    created_at: '2026-08-31T09:00:00Z',
    updated_at: '2026-08-31T09:00:00Z',
    ...overrides,
  };
}


describe('useCodeTaskList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.mockResolvedValue({ items: [] });
  });

  it('does not replace a management surface when an empty task refresh finishes', async () => {
    const pending = deferred<{ items: CodingSession[] }>();
    sessions.mockReturnValueOnce(pending.promise);
    const view = renderTaskList(false);

    view.rerender({ intentionalSurface: true });
    await act(async () => { pending.resolve({ items: [] }); await pending.promise; });

    expect(view.onSessionsChange).toHaveBeenCalledWith([]);
    expect(view.onSelectionChange).not.toHaveBeenCalled();
  });

  it('opens New Task when the task area itself becomes empty', async () => {
    const view = renderTaskList(false);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(view.onSelectionChange).toHaveBeenCalledWith(null, true);
  });

  it('does not poll while the Code workspace is hidden', async () => {
    vi.useFakeTimers();
    try {
      const view = renderHook(
        ({ active }: { active: boolean }) => useCodeTaskList({
          active,
          sessions: [],
          selectedId: null,
          newTask: true,
          currentSession: null,
          onSessionsChange: vi.fn(),
          onSelectionChange: vi.fn(),
        }),
        { initialProps: { active: false } },
      );

      await act(async () => { vi.advanceTimersByTime(15_000); });
      expect(sessions).not.toHaveBeenCalled();

      view.rerender({ active: true });
      await act(async () => { await Promise.resolve(); });
      expect(sessions).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not rebuild the sidebar for stream-only session changes', async () => {
    const previous = codingSession();
    const onSessionsChange = vi.fn();
    const view = renderHook(
      ({ currentSession }: { currentSession: CodingSession }) => useCodeTaskList({
        active: false,
        sessions: [previous],
        selectedId: previous.id,
        newTask: false,
        currentSession,
        onSessionsChange,
        onSelectionChange: vi.fn(),
      }),
      { initialProps: { currentSession: previous } },
    );

    onSessionsChange.mockClear();
    view.rerender({ currentSession: codingSession({ event_count: 42, updated_at: '2026-08-31T09:00:01Z' }) });
    expect(onSessionsChange).not.toHaveBeenCalled();

    view.rerender({ currentSession: codingSession({ status: 'completed', event_count: 43 }) });
    expect(onSessionsChange).toHaveBeenCalledOnce();
  });
});
