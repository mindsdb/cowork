import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('keeps configured project actions compact and opens preview on demand', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const onPreview = vi.fn();
    render(
      <TaskBar
        session={session}
        git={null}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        previewAvailable
        projectActions={[{ id: 'run-web', resource_id: 'web', label: 'Dev server', resource_name: 'Web' }]}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={onPreview}
        onRunProjectAction={onRun}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Run Dev server' }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-web' }));
    await user.click(screen.getByRole('button', { name: 'Preview running project' }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('keeps preview visible but unavailable until a run action starts', () => {
    render(
      <TaskBar
        session={session}
        git={null}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        projectActions={[{ id: 'run-web', resource_id: 'web', label: 'Dev server', resource_name: 'Web' }]}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Preview running project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview running project' })).toHaveAttribute(
      'title',
      'Run the project to enable preview',
    );
  });

  it('explains direct-folder tasks as work in the original folder', async () => {
    const user = userEvent.setup();
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
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Original folder')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show task details for original folder' }));
    expect(screen.getByText('Task setup')).toBeInTheDocument();
    expect(screen.getByText('Edits happen in the folder you selected.')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('makes the isolated working copy legible without exposing implementation terms', async () => {
    const user = userEvent.setup();
    render(
      <TaskBar
        session={{ ...session, workspace_kind: 'git_worktree', workspace_path: '/tasks/task-1/project' }}
        git={{
          is_git: true,
          branch: 'codex/task-1',
          revision: 'abc123',
          detached: false,
          dirty: true,
          status_lines: [' M src/app.ts'],
          worktree_path: '/tasks/task-1/project',
          source_path: session.source_path,
        }}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show task details for isolated copy' }));
    expect(screen.getByText('Task-only files keep parallel work separate.')).toBeInTheDocument();
    expect(screen.getByText('codex/task-1')).toBeInTheDocument();
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
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
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Computer offline')).toBeInTheDocument();
    expect(screen.getByText('Build computer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows a recovering run without duplicating its recovery action in the header', () => {
    render(
      <TaskBar
        session={{ ...session, status: 'interrupted', run_status: 'recovering' }}
        git={null}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onOpenExtensions={vi.fn()}
        onRename={vi.fn()}
        onFork={vi.fn()}
        onCompact={vi.fn()}
        onStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Resuming')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });
});
