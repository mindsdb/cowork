import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';

const { createSession } = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({ id: 'task-created' })),
}));

vi.mock('./api', () => ({
  codingApi: { create: createSession },
}));

import { useCodeTaskActions } from './useCodeTaskActions';


function renderActions({
  refresh = vi.fn(async () => {}),
  loadSessions = vi.fn(async () => []),
}: {
  refresh?: () => Promise<void>;
  loadSessions?: () => Promise<CodingSession[]>;
} = {}) {
  return renderHook(() => useCodeTaskActions({
    selectedId: 'task-1',
    session: null,
    refresh,
    loadSessions,
    onSessionsChange: vi.fn(),
    onSelectionChange: vi.fn(),
  }));
}


describe('useCodeTaskActions', () => {
  it('sends exactly one project workspace selector when creating tasks', async () => {
    createSession.mockClear();
    const { result } = renderActions();

    await act(async () => {
      await result.current.create({
        projectId: 'project-1',
        prompt: 'Ship it',
        engineId: 'codex',
        model: 'gpt-5.6-sol',
        permissionMode: 'supervised',
        attachments: [],
        sourceContexts: [],
      });
    });

    expect(createSession).toHaveBeenCalledWith({
      project_id: 'project-1',
      prompt: 'Ship it',
      engine_id: 'codex',
      model: 'gpt-5.6-sol',
      permission_mode: 'supervised',
      attachments: [],
      source_contexts: [],
    });
  });

  it('sends a folder path instead of a project for no-project tasks', async () => {
    createSession.mockClear();
    const { result } = renderActions();

    await act(async () => {
      await result.current.create({
        projectId: null,
        path: 'C:\\work\\one-off',
        prompt: 'Inspect this folder',
        engineId: 'codex',
        model: 'gpt-5.6-sol',
        permissionMode: 'workspace',
        attachments: [],
        sourceContexts: [],
      });
    });

    expect(createSession).toHaveBeenCalledWith({
      path: 'C:\\work\\one-off',
      allow_direct_folder: true,
      prompt: 'Inspect this folder',
      engine_id: 'codex',
      model: 'gpt-5.6-sol',
      permission_mode: 'workspace',
      attachments: [],
      source_contexts: [],
    });
  });

  it('does not report a successful mutation as failed when list reconciliation drops', async () => {
    const loadSessions = vi.fn(async () => { throw new Error('temporary list failure'); });
    const action = vi.fn(async () => {});
    const { result } = renderActions({ loadSessions });

    await act(async () => {
      await expect(result.current.run(action, true, true)).resolves.toBeUndefined();
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain('The operation completed');
    expect(result.current.error).toContain('temporary list failure');
  });

  it('returns a successful result when only detail refresh fails', async () => {
    const action = vi.fn(async () => ({ status: 'applied' }));
    const refresh = vi.fn(async () => { throw new Error('temporary detail failure'); });
    const { result } = renderActions({ refresh });
    let resolved: { status: string } | undefined;

    await act(async () => {
      resolved = await result.current.runResult(action, false, true);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual({ status: 'applied' });
    expect(result.current.error).toContain('The operation completed');
    expect(result.current.error).toContain('temporary detail failure');
  });

  it('still rethrows a mutation failure so the composer can restore its draft', async () => {
    const action = vi.fn(async () => { throw new Error('turn rejected'); });
    const { result } = renderActions();

    await act(async () => {
      await expect(result.current.run(action, true, true)).rejects.toThrow('turn rejected');
    });

    expect(result.current.error).toBe('turn rejected');
  });
});
