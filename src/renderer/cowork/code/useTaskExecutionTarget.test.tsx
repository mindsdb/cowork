import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodeComputer, CodeProject } from './api';


const { computers, projectComputers, projectResources } = vi.hoisted(() => ({
  computers: vi.fn(),
  projectComputers: vi.fn(),
  projectResources: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  codingApi: { computers, projectComputers, projectResources },
}));

import { useTaskExecutionTarget } from './useTaskExecutionTarget';


const project: CodeProject = {
  schema_version: 1,
  id: 'project-1',
  name: 'MindsHub',
  resources: [{
    id: 'repo-1',
    kind: 'repository',
    name: 'cowork',
    repository: 'mindsdb/cowork',
    checkout_strategy: 'clone',
    commands: [],
  }],
  folders: [],
  connections: [],
  environment: { variables: {}, port_names: [] },
  default_engine_id: 'codex',
  default_model: 'gpt-5.6-sol',
  permission_mode: 'supervised',
  created_at: '2026-09-03T09:00:00Z',
  updated_at: '2026-09-03T09:00:00Z',
};

const localComputer: CodeComputer = {
  schema_version: 1,
  id: 'local',
  name: 'This computer',
  is_local: true,
  status: 'online',
  active_run_count: 0,
  last_seen_at: '2026-09-03T09:00:00Z',
  capabilities: {
    platform: 'darwin',
    architecture: 'arm64',
    runtime_version: '1',
    protocol_versions: ['1'],
    agent_engines: ['codex'],
    shells: ['bash'],
    has_git: true,
    has_terminal: true,
    supports_local_folders: true,
    max_concurrent_runs: 2,
  },
};


describe('useTaskExecutionTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    computers.mockResolvedValue({ items: [localComputer] });
    projectResources.mockResolvedValue({ items: [{
      resource: project.resources[0],
      availability: {
        resource_id: 'repo-1',
        status: 'available',
        eligible_computer_ids: ['local'],
        detail: '',
      },
    }] });
  });

  it('automatically rechecks a capacity-blocked task until a computer is available', async () => {
    vi.useFakeTimers();
    try {
      projectComputers
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [localComputer] });
      const { result } = renderHook(() => useTaskExecutionTarget(project, 'codex'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.executionIssue).toBe('No online computer can run this task right now.');
      expect(result.current.computerId).toBe('');

      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.computerId).toBe('local');
      expect(result.current.executionIssue).toBe('');
      expect(projectComputers).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps rechecking while a resource waits for its computer to come back online', async () => {
    vi.useFakeTimers();
    try {
      projectResources.mockResolvedValue({ items: [{
        resource: project.resources[0],
        availability: {
          resource_id: 'repo-1',
          status: 'offline',
          eligible_computer_ids: [],
          detail: '',
        },
      }] });
      projectComputers
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [localComputer] });
      const { result } = renderHook(() => useTaskExecutionTarget(project, 'codex'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.executionIssue).toBe('cowork is on a computer that is offline.');

      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.computerId).toBe('local');
      expect(result.current.executionIssue).toBe('');
      expect(projectComputers).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-poll when the capacity check itself failed', async () => {
    vi.useFakeTimers();
    try {
      projectComputers.mockRejectedValue('network down');
      const { result } = renderHook(() => useTaskExecutionTarget(project, 'codex'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.executionIssue).toBe('Could not check where this task can run.');

      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(projectComputers).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
