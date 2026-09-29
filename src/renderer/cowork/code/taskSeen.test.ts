import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CodingSession } from './api';
import { isUnreadTask, useTaskSeen } from './taskSeen';


function session(id: string, status: CodingSession['status'], updatedAt: string, overrides: Partial<CodingSession> = {}): CodingSession {
  return {
    schema_version: 1,
    id,
    title: `Task ${id}`,
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'fable',
    permission_mode: 'supervised',
    status,
    source_path: `/work/${id}`,
    workspace_path: `/work/${id}-cowork`,
    workspace_kind: 'git_worktree',
    repository_root: `/work/${id}`,
    source_dirty: false,
    event_count: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...overrides,
  };
}


const state = { baseline: '2026-08-21T10:00:00Z', seen: { viewed: '2026-08-21T12:00:00Z' } };


describe('isUnreadTask', () => {
  it('marks a build turn that finished after the baseline or the last view', () => {
    expect(isUnreadTask(session('fresh', 'completed', '2026-08-21T11:00:00Z'), state, null)).toBe(true);
    expect(isUnreadTask(session('viewed', 'completed', '2026-08-21T13:00:00Z'), state, null)).toBe(true);
  });

  it('treats history from before the baseline and tasks viewed since as read', () => {
    expect(isUnreadTask(session('old', 'completed', '2026-08-21T09:00:00Z'), state, null)).toBe(false);
    expect(isUnreadTask(session('viewed', 'completed', '2026-08-21T12:00:00Z'), state, null)).toBe(false);
  });

  it('leaves the selected task, other states, plans and archived tasks alone', () => {
    const fresh = '2026-08-21T11:00:00Z';
    expect(isUnreadTask(session('open', 'completed', fresh), state, 'open')).toBe(false);
    expect(isUnreadTask(session('run', 'running', fresh), state, null)).toBe(false);
    expect(isUnreadTask(session('stop', 'cancelled', fresh), state, null)).toBe(false);
    expect(isUnreadTask(session('plan', 'completed', fresh, { task_mode: 'plan' }), state, null)).toBe(false);
    expect(isUnreadTask(session('gone', 'completed', fresh, { archived: true }), state, null)).toBe(false);
  });
});


describe('useTaskSeen', () => {
  beforeEach(() => window.localStorage.clear());

  it('does not mark existing history unread on first run', () => {
    const { result } = renderHook(() => useTaskSeen([session('old', 'completed', '2026-08-21T09:00:00Z')], null));
    expect(result.current(session('old', 'completed', '2026-08-21T09:00:00Z'))).toBe(false);
  });

  it('clears a task once it has been open and keeps it cleared after a reload', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const finished = session('done', 'completed', future);
    const { result, rerender } = renderHook(({ selectedId }) => useTaskSeen([finished], selectedId), {
      initialProps: { selectedId: null as string | null },
    });
    expect(result.current(finished)).toBe(true);

    act(() => rerender({ selectedId: 'done' }));
    act(() => rerender({ selectedId: null }));
    expect(result.current(finished)).toBe(false);

    const reloaded = renderHook(() => useTaskSeen([finished], null));
    expect(reloaded.result.current(finished)).toBe(false);
  });

  it('keeps a viewed task read when its entry is pruned from the seen list', () => {
    const minute = (n: number) => new Date(Date.parse('2026-08-21T10:00:00Z') + n * 60_000).toISOString();
    const seen: Record<string, string> = { viewed: minute(1) };
    for (let index = 0; index < 499; index += 1) seen[`other-${index}`] = minute(10 + index);
    window.localStorage.setItem('cowork:code-task-seen:v1', JSON.stringify({ baseline: minute(0), seen }));
    const viewed = session('viewed', 'completed', minute(1));
    const fresh = session('fresh', 'completed', minute(900));

    const { result, rerender } = renderHook(({ selectedId }) => useTaskSeen([viewed, fresh], selectedId), {
      initialProps: { selectedId: null as string | null },
    });
    act(() => rerender({ selectedId: 'fresh' }));

    const stored = JSON.parse(window.localStorage.getItem('cowork:code-task-seen:v1')!);
    expect(Object.keys(stored.seen)).toHaveLength(500);
    expect(stored.seen.viewed).toBeUndefined();
    expect(result.current(viewed)).toBe(false);
  });
});
