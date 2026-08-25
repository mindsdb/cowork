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
});
