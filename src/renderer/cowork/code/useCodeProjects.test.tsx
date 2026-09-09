import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listProjects, createProject } = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock('./api', () => ({
  codingApi: { projects: listProjects, createProject },
}));

import { useCodeProjects } from './useCodeProjects';

const project = {
  schema_version: 1,
  id: 'project-1',
  name: 'MindsHub',
  folders: [{ id: 'cowork', name: 'cowork', path: '/work/cowork', commands: [] }],
  connections: [],
  environment: { variables: {}, port_names: ['PORT'] },
  default_engine_id: 'codex',
  default_model: 'gpt-5.6-sol',
  permission_mode: 'supervised',
  created_at: '2026-08-24T09:00:00Z',
  updated_at: '2026-08-24T09:00:00Z',
};

describe('useCodeProjects', () => {
  beforeEach(() => {
    localStorage.clear();
    listProjects.mockReset();
    listProjects.mockResolvedValue({ items: [project] });
  });

  it('selects the first project for an existing user without a saved choice', async () => {
    const { result } = renderHook(() => useCodeProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedId).toBe('project-1');
  });

  it('remembers an explicit No project choice across task screens', async () => {
    const first = renderHook(() => useCodeProjects());
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    act(() => first.result.current.setSelectedId(null));
    expect(first.result.current.selectedId).toBeNull();
    first.unmount();

    const second = renderHook(() => useCodeProjects());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.selectedId).toBeNull();
  });

  it('keeps a reasoning default chosen while creating a project', async () => {
    createProject.mockImplementation(async (body: Record<string, unknown>) => ({ ...project, ...body, id: 'project-2' }));
    const { result } = renderHook(() => useCodeProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save(null, { name: 'Effort', resources: [], default_reasoning_effort: 'low' } as never);
    });

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Effort', default_reasoning_effort: 'low' }));
  });

  it('replaces a project in the list at once, without another fetch', async () => {
    const { result } = renderHook(() => useCodeProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    listProjects.mockClear();

    act(() => result.current.replace({ ...project, connections: [{ provider: 'github', name: 'octo', label: 'Octo Cat' }] } as never));

    expect(result.current.projects[0].connections).toEqual([{ provider: 'github', name: 'octo', label: 'Octo Cat' }]);
    expect(listProjects).not.toHaveBeenCalled();
  });

});
