import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => window.localStorage.clear());

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
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const active = screen.getByRole('button', { name: /Task active, Working/ });
    const completed = screen.getByRole('button', { name: /Task newer-complete, Completed/ });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.compareDocumentPosition(completed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    completed.click();
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
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Task old, Completed/ })).toBeInTheDocument();
  });

  it('orders actionable work first in one list and spells out remote status', () => {
    render(
      <CodeSidebarSessions
        sessions={[
          { ...session('offline', 'interrupted', '2026-08-21T10:00:00Z'), run_status: 'interrupted', computer_status: 'offline' },
          session('running', 'running', '2026-08-21T09:00:00Z'),
          session('done', 'completed', '2026-08-21T08:00:00Z'),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const offline = screen.getByRole('button', { name: /Task offline, Computer offline/ });
    const running = screen.getByRole('button', { name: /Task running, Working/ });
    const done = screen.getByRole('button', { name: /Task done, Completed/ });
    expect(offline.compareDocumentPosition(running) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(running.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByText('Computer offline')).toBeInTheDocument();
  });

  it('offers search when the task list becomes long', () => {
    render(
      <CodeSidebarSessions
        sessions={Array.from({ length: 5 }, (_, index) => session(`task-${index}`, 'completed', `2026-08-21T0${index}:00:00Z`))}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Find a coding task' });
    fireEvent.change(search, { target: { value: 'task-3' } });
    expect(screen.getByRole('button', { name: /Task task-3, Completed/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Task task-2, Completed/ })).not.toBeInTheDocument();
  });

  it('pins a task immediately and moves it out of the main list', async () => {
    const onSetPinned = vi.fn().mockResolvedValue(undefined);
    render(
      <CodeSidebarSessions
        sessions={[
          session('running', 'running', '2026-08-21T09:00:00Z'),
          session('done', 'completed', '2026-08-21T08:00:00Z'),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={onSetPinned}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pin Task done' }));

    await waitFor(() => expect(onSetPinned).toHaveBeenCalledWith('done', true));
    const pinnedGroup = screen.getByRole('region', { name: 'Pinned' });
    expect(pinnedGroup).toHaveTextContent('Task done');
    expect(pinnedGroup).not.toHaveTextContent('Task running');
    expect(screen.getByRole('button', { name: 'Unpin Task done' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores the task and explains the problem when pinning fails', async () => {
    const onSetPinned = vi.fn().mockRejectedValue(new Error('offline'));
    render(
      <CodeSidebarSessions
        sessions={[session('done', 'completed', '2026-08-21T08:00:00Z')]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={onSetPinned}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pin Task done' }));

    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't pin this task.");
    expect(screen.queryByRole('region', { name: 'Pinned' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin Task done' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('can organize tasks by project and remembers that display choice', () => {
    render(
      <CodeSidebarSessions
        sessions={[
          { ...session('alpha', 'completed', '2026-08-21T09:00:00Z'), project_name: 'Project Alpha' },
          { ...session('none', 'completed', '2026-08-21T08:00:00Z'), project_name: null },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Organize coding tasks' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Projects/ }));

    expect(screen.getByRole('region', { name: 'Project Alpha' })).toHaveTextContent('Task alpha');
    expect(screen.getByRole('region', { name: 'No project' })).toHaveTextContent('Task none');
    expect(JSON.parse(window.localStorage.getItem('cowork:code-task-navigation:v1') || '{}')).toMatchObject({ organization: 'project' });
  });

  it('marks work in motion, what needs the user and unread results, and leaves seen tasks quiet', () => {
    window.localStorage.setItem('cowork:code-task-seen:v1', JSON.stringify({
      baseline: '2026-08-21T10:00:00Z',
      seen: { seen: '2026-08-21T12:00:00Z' },
    }));
    const { container } = render(
      <CodeSidebarSessions
        sessions={[
          session('running', 'running', '2026-08-21T12:00:00Z'),
          session('approval', 'awaiting_approval', '2026-08-21T12:00:00Z'),
          session('unread', 'completed', '2026-08-21T11:00:00Z'),
          session('seen', 'completed', '2026-08-21T12:00:00Z'),
          session('old', 'completed', '2026-08-21T09:00:00Z'),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const row = (id: string) => screen.getByRole('button', { name: new RegExp(`^Task ${id},`) }).closest('.code-sidebar-session-row')!;
    expect(row('running').querySelector('.code-sidebar-session__spinner')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Task running, Working/ })).toBeInTheDocument();
    expect(row('running')).not.toHaveTextContent('Working');
    expect(row('approval')).toHaveTextContent('Needs approval');
    expect(row('unread').querySelector('.code-status-dot.is-unread')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Task unread, Completed, unread/ })).toBeInTheDocument();
    for (const id of ['seen', 'old']) {
      expect(row(id)).toHaveClass('is-resting');
      expect(row(id)).not.toHaveTextContent('Completed');
      expect(row(id).querySelector('.code-status-dot')).toBeNull();
    }
    expect(container.querySelectorAll('.code-status-dot.is-unread')).toHaveLength(1);
  });

  it('keeps each row to one line without repeating the shared project name', () => {
    render(
      <CodeSidebarSessions
        sessions={[
          { ...session('a', 'completed', '2026-08-21T12:00:00Z'), project_name: 'atlas-web' },
          { ...session('b', 'completed', '2026-08-21T11:00:00Z'), project_name: 'atlas-web' },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const button = screen.getByRole('button', { name: /^Task a,/ });
    // The project stays reachable (accessible name, hover title) but is not printed on the row.
    expect(button).toHaveAccessibleName(/atlas-web/);
    expect(button).toHaveAttribute('title', 'Task a · atlas-web');
    expect(button).not.toHaveTextContent('atlas-web');
  });

  it('keeps a queued remote run visibly in motion', () => {
    render(
      <CodeSidebarSessions
        sessions={[{ ...session('queued', 'ready', '2026-08-21T12:00:00Z'), run_status: 'queued' }]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const row = screen.getByRole('button', { name: /^Task queued,/ }).closest('.code-sidebar-session-row')!;
    expect(row).not.toHaveClass('is-resting');
    // The spinner carries the motion; the status word stays in the accessible name only.
    expect(screen.getByRole('button', { name: /^Task queued, Preparing/ })).toBeInTheDocument();
    expect(row).not.toHaveTextContent('Preparing');
    expect(row.querySelector('.code-sidebar-session__spinner')).not.toBeNull();
  });

  it('clears the unread mark once the task has been opened', () => {
    window.localStorage.setItem('cowork:code-task-seen:v1', JSON.stringify({ baseline: '2026-08-21T10:00:00Z', seen: {} }));
    const sessions = [session('done', 'completed', '2026-08-21T11:00:00Z'), session('other', 'completed', '2026-08-21T09:00:00Z')];
    const props = { sessions, onSelect: vi.fn(), onSetPinned: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<CodeSidebarSessions {...props} selectedId={null} />);
    expect(screen.getByRole('button', { name: /^Task done, Completed, unread/ })).toBeInTheDocument();

    rerender(<CodeSidebarSessions {...props} selectedId="done" />);
    rerender(<CodeSidebarSessions {...props} selectedId="other" />);
    expect(screen.queryByRole('button', { name: /unread/ })).toBeNull();
  });

  it('offers a last-updated order that ignores status', () => {
    render(
      <CodeSidebarSessions
        sessions={[
          session('older-running', 'running', '2026-08-21T08:00:00Z'),
          session('newer-complete', 'completed', '2026-08-21T10:00:00Z'),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetPinned={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Organize coding tasks' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Last updated/ }));

    const newer = screen.getByRole('button', { name: /Task newer-complete, Completed/ });
    const older = screen.getByRole('button', { name: /Task older-running, Working/ });
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
