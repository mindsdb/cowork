import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CodingSession } from './api';
import { TaskBar } from './TaskBar';


const session: CodingSession = {
  schema_version: 1,
  id: 'task-1',
  title: 'Create a file',
  engine_id: 'codex',
  engine_adapter_version: '1',
  model: 'fable',
  permission_mode: 'supervised',
  status: 'running',
  source_path: '/Users/developer/Documents/new-project',
  workspace_path: '/Users/developer/Documents/new-project',
  workspace_kind: 'direct_folder',
  repository_root: null,
  base_revision: null,
  source_dirty: false,
  workspace_warning: null,
  engine_session_id: null,
  active_turn_id: 'turn-1',
  pending_approval: null,
  last_error: null,
  event_count: 1,
  created_at: '2026-08-22T10:00:00Z',
  updated_at: '2026-08-22T10:00:00Z',
};


describe('TaskBar', () => {
  it('labels a non-Git workspace as a direct folder', () => {
    render(
      <TaskBar
        session={session}
        git={{
          is_git: false,
          branch: null,
          revision: null,
          detached: false,
          dirty: false,
          status_lines: [],
          worktree_path: session.workspace_path,
          source_path: session.source_path,
        }}
        files={[]}
        modelLabel="Claude Fable 5"
        reviewOpen={false}
        terminalOpen={false}
        onToggleReview={vi.fn()}
        onToggleTerminal={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onRecover={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('direct folder')).toBeInTheDocument();
    expect(screen.queryByText('detached worktree')).not.toBeInTheDocument();
  });

  it('shows durable run recovery state and its owning computer', () => {
    render(
      <TaskBar
        session={{
          ...session,
          status: 'interrupted',
          run_status: 'interrupted',
          computer_name: 'Build computer',
          computer_status: 'offline',
        }}
        git={null}
        files={[]}
        reviewOpen={false}
        terminalOpen={false}
        onToggleReview={vi.fn()}
        onToggleTerminal={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onRecover={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Computer offline')).toBeInTheDocument();
    expect(screen.getByText('Build computer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('keeps Restore available while a fenced run is waiting to be reclaimed', () => {
    render(
      <TaskBar
        session={{ ...session, status: 'interrupted', run_status: 'recovering' }}
        git={null}
        files={[]}
        reviewOpen={false}
        terminalOpen={false}
        onToggleReview={vi.fn()}
        onToggleTerminal={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onRecover={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Ready to resume')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });
});
