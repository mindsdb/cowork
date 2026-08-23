import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';
import { CodeSidebarSessions } from './CodeSidebarSessions';


function session(id: string, status: CodingSession['status'], updatedAt: string): CodingSession {
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
  };
}


describe('CodeSidebarSessions', () => {
  it('keeps active work above newer history and exposes the selected task', () => {
    const onSelect = vi.fn();
    render(
      <CodeSidebarSessions
        sessions={[
          session('newer-complete', 'completed', '2026-08-21T10:00:00Z'),
          session('active', 'running', '2026-08-21T09:00:00Z'),
        ]}
        selectedId="active"
        onSelect={onSelect}
      />,
    );

    const tasks = screen.getAllByRole('button');
    expect(tasks.map((task) => task.textContent)).toEqual([
      expect.stringContaining('Task active'),
      expect.stringContaining('Task newer-complete'),
    ]);
    expect(tasks[0]).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Task active, Working/ })).toBe(tasks[0]);
    tasks[1].click();
    expect(onSelect).toHaveBeenCalledWith('newer-complete');
  });

  it('keeps archived tasks discoverable without mixing them into active work', () => {
    render(
      <CodeSidebarSessions
        sessions={[
          session('active', 'completed', '2026-08-21T09:00:00Z'),
          { ...session('old', 'completed', '2026-08-20T09:00:00Z'), archived: true },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Task old/ })).toBeInTheDocument();
  });
});
