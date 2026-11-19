import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


const { setPinned, renameSession, setArchived, deleteSession } = vi.hoisted(() => ({
  setPinned: vi.fn(),
  renameSession: vi.fn(),
  setArchived: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('./api', () => ({ codingApi: { setPinned, renameSession, setArchived, deleteSession } }));

import { useCodeWorkspace } from './useCodeWorkspace';


function codingSession(pinned = false, id = 'task-1'): CodingSession {
  return {
    schema_version: 1,
    id,
    title: 'Task one',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'gpt',
    permission_mode: 'supervised',
    status: 'completed',
    source_path: '/work/source',
    workspace_path: '/work/task-1',
    workspace_kind: 'git_worktree',
    repository_root: '/work/source',
    source_dirty: false,
    event_count: 0,
    pinned,
    created_at: '2026-08-30T10:00:00Z',
    updated_at: '2026-08-30T10:00:00Z',
  };
}


describe('useCodeWorkspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps all tasks and project tasks in the Code navigation lifecycle', () => {
    const openCode = vi.fn();
    const { result } = renderHook(() => useCodeWorkspace(openCode));
    act(() => result.current.selectSession('task-1'));
    act(() => result.current.openTasks('project-1'));
    expect(result.current).toMatchObject({ tasksOpen: true, tasksProjectId: 'project-1', newTask: false, selectedId: 'task-1' });
    act(() => result.current.openTasks());
    expect(result.current).toMatchObject({ tasksOpen: true, tasksProjectId: null });
    act(() => result.current.openNewTask());
    expect(result.current).toMatchObject({ tasksOpen: false, newTask: true });
    act(() => result.current.openProjects());
    expect(result.current).toMatchObject({ tasksOpen: false, projectsOpen: true });
    act(() => result.current.openTasks());
    act(() => result.current.changeSelection('task-2'));
    expect(result.current).toMatchObject({ managementRoute: null, selectedId: 'task-2', newTask: false });
    expect(openCode).toHaveBeenCalledTimes(6);
  });

  it('owns pin mutations and reconciles the canonical task collection', async () => {
    const openCode = vi.fn();
    const updated = codingSession(true);
    setPinned.mockResolvedValue(updated);
    const { result } = renderHook(() => useCodeWorkspace(openCode));

    act(() => result.current.setSessions([codingSession()]));
    await act(async () => { await result.current.setSessionPinned('task-1', true); });

    expect(setPinned).toHaveBeenCalledWith('task-1', true);
    expect(result.current.sessions).toEqual([updated]);
  });

  it('does not mutate local task state when the server rejects a pin', async () => {
    setPinned.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCodeWorkspace(vi.fn()));
    const original = codingSession();

    act(() => result.current.setSessions([original]));
    await expect(act(async () => result.current.setSessionPinned('task-1', true))).rejects.toThrow('offline');

    expect(result.current.sessions).toEqual([original]);
  });

  it('renames a task in the canonical collection', async () => {
    renameSession.mockResolvedValue({ ...codingSession(), title: 'Renamed' });
    const { result } = renderHook(() => useCodeWorkspace(vi.fn()));

    act(() => result.current.setSessions([codingSession()]));
    await act(async () => { await result.current.renameSession('task-1', 'Renamed'); });

    expect(renameSession).toHaveBeenCalledWith('task-1', 'Renamed');
    expect(result.current.sessions[0].title).toBe('Renamed');
  });

  it('moves to the next active task when the open task is archived', async () => {
    setArchived.mockResolvedValue({ ...codingSession(), archived: true });
    const { result } = renderHook(() => useCodeWorkspace(vi.fn()));

    act(() => {
      result.current.setSessions([codingSession(), codingSession(false, 'task-2')]);
      result.current.selectSession('task-1');
    });
    await act(async () => { await result.current.setSessionArchived('task-1', true); });

    expect(result.current.sessions[0].archived).toBe(true);
    expect(result.current).toMatchObject({ selectedId: 'task-2', newTask: false });
  });

  it('keeps the selection when a different task is archived', async () => {
    setArchived.mockResolvedValue({ ...codingSession(false, 'task-2'), archived: true });
    const { result } = renderHook(() => useCodeWorkspace(vi.fn()));

    act(() => {
      result.current.setSessions([codingSession(), codingSession(false, 'task-2')]);
      result.current.selectSession('task-1');
    });
    await act(async () => { await result.current.setSessionArchived('task-2', true); });

    expect(result.current.selectedId).toBe('task-1');
  });

  it('opens a new task when the last open task is deleted', async () => {
    deleteSession.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCodeWorkspace(vi.fn()));

    act(() => {
      result.current.setSessions([codingSession()]);
      result.current.selectSession('task-1');
    });
    await act(async () => { await result.current.deleteSession('task-1'); });

    expect(deleteSession).toHaveBeenCalledWith('task-1');
    expect(result.current).toMatchObject({ sessions: [], selectedId: null, newTask: true });
  });
});
