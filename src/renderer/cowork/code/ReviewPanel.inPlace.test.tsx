import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./DraftPullRequestSection', () => ({
  DraftPullRequestSection: () => <div>Draft pull requests section</div>,
}));

import type { CodingSession, DiffFile, TaskWorkspace } from './api';
import { ReviewPanel } from './ReviewPanel';


const base: CodingSession = {
  schema_version: 1,
  id: 'task-1',
  title: 'Tidy the checkout',
  engine_id: 'codex',
  engine_adapter_version: '1',
  model: 'fable',
  permission_mode: 'supervised',
  status: 'completed',
  source_path: '/work/app',
  workspace_path: '/work/app',
  workspace_kind: 'direct_folder',
  workspace_mode: 'in_place',
  base_revision: 'abc123',
  repository_root: '/work/app',
  source_dirty: false,
  computer_is_local: true,
  event_count: 0,
  created_at: '2026-10-15T09:00:00Z',
  updated_at: '2026-10-15T09:05:00Z',
};

const localFolder = (folder: string): TaskWorkspace => ({
  folder_id: folder,
  folder_name: folder,
  source_path: `/work/${folder}`,
  workspace_path: `/work/${folder}`,
  workspace_kind: 'direct_folder',
  source_dirty: false,
  repository_root: `/work/${folder}`,
  base_revision: 'abc123',
  base_branch: null,
  task_branch: null,
});

const localProject: CodingSession = {
  ...base,
  id: 'project-task',
  project_id: 'project-1',
  project_name: 'Shop',
  workspaces: [localFolder('app'), localFolder('api')],
};

const change = (path: string, folder?: string): DiffFile => ({
  ...(folder ? { folder_id: folder, folder_name: folder } : {}),
  path,
  status: 'M',
  additions: 2,
  deletions: 1,
  patch: `@@ -1 +1,2 @@\n-old\n+new\n+more\n`,
  binary: false,
  unstaged: true,
});

function renderPanel(session: CodingSession, files: DiffFile[]) {
  const handlers = {
    onApply: vi.fn(async () => {}),
    onCommit: vi.fn(async () => {}),
    onBranch: vi.fn(async () => {}),
  };
  render(
    <ReviewPanel open session={session} git={null} files={files} busy={false} error="" onClose={vi.fn()} {...handlers} />,
  );
  return handlers;
}


describe('ReviewPanel for a Local task', () => {
  it('reviews a Local project task’s changes per folder without offering to copy them back', async () => {
    const user = userEvent.setup();
    renderPanel(localProject, [change('src/cart.ts', 'app'), change('server.py', 'api')]);

    expect(screen.getByText('2 changed files')).toBeInTheDocument();
    expect(screen.getByText('src/cart.ts')).toBeInTheDocument();
    expect(screen.getByText('server.py')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Deliver' }));
    expect(screen.getByText('This task edits your folders directly')).toBeInTheDocument();
    expect(screen.getByText(/already in your folders, so there is nothing to apply/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply locally' })).toBeNull();
    expect(screen.queryByText(/checks for conflicts/)).toBeNull();
    // No pull requests from a Local task yet, and the panel says so.
    expect(screen.queryByText('Draft pull requests section')).toBeNull();
    expect(screen.getByText(/Draft pull requests are not available for Local tasks yet/)).toBeInTheDocument();
    expect(screen.getByText('Commit all changes in your folder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open your folder/ })).toBeInTheDocument();
  });

  it('commits a Local folder task in the folder itself', async () => {
    const user = userEvent.setup();
    const { onCommit } = renderPanel(base, [change('README.md')]);

    await user.click(screen.getByRole('tab', { name: 'Deliver' }));
    expect(screen.queryByRole('button', { name: 'Apply locally' })).toBeNull();
    expect(screen.getByText('Create and switch to a branch in your folder')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Describe the change'), 'Tidy');
    await user.click(screen.getByRole('button', { name: 'Commit' }));

    expect(onCommit).toHaveBeenCalledWith('Tidy');
  });

  it('says changes already in the folder are part of the review and of a commit', async () => {
    const user = userEvent.setup();
    renderPanel({ ...base, source_dirty: true }, [change('README.md')]);

    await user.click(screen.getByRole('tab', { name: 'Deliver' }));
    expect(screen.getByText('The folder already had uncommitted changes')).toBeInTheDocument();
    expect(screen.getByText(/committing here includes them/)).toBeInTheDocument();
    expect(screen.queryByText('Source had local changes when this task began')).toBeNull();
  });

  it('warns that discarding a file changes the user’s folder', async () => {
    const user = userEvent.setup();
    renderPanel(base, [change('README.md')]);

    await user.click(screen.getByRole('button', { name: 'Discard changes to README.md' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/last committed version in your folder, including any edits made before this task started/)).toBeInTheDocument();
  });

  it('shows an unchanged Local folder as unchanged, not as untracked', () => {
    renderPanel(base, []);

    expect(screen.getByText('Working tree unchanged')).toBeInTheDocument();
    expect(screen.queryByText('Change tracking unavailable')).toBeNull();
  });
});

describe('ReviewPanel for an isolated task', () => {
  it('still offers Apply and draft pull requests for a worktree project task', async () => {
    const user = userEvent.setup();
    const worktree = (folder: string): TaskWorkspace => ({
      ...localFolder(folder),
      workspace_path: `/tasks/project-task/${folder}`,
      workspace_kind: 'git_worktree',
      task_branch: 'cowork/task',
    });
    renderPanel({
      ...localProject,
      workspace_mode: 'worktree',
      workspace_kind: 'git_worktree',
      workspace_path: '/tasks/project-task/app',
      workspaces: [worktree('app'), worktree('api')],
    }, [change('src/cart.ts', 'app')]);

    await user.click(screen.getByRole('tab', { name: 'Deliver' }));
    expect(screen.getByRole('button', { name: 'Apply locally' })).toBeInTheDocument();
    expect(screen.getByText('Draft pull requests section')).toBeInTheDocument();
    expect(screen.queryByText('This task edits your folder directly')).toBeNull();
  });

  it('treats a task from a server without workspace modes as before', async () => {
    const user = userEvent.setup();
    const { workspace_mode: _omitted, ...legacy } = { ...base, base_revision: null };
    renderPanel(legacy, []);

    expect(screen.getByText('Change tracking unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Deliver' }));
    expect(screen.getByText(/already works in the selected folder, so there is nothing to apply/)).toBeInTheDocument();
    expect(screen.queryByText('This task edits your folder directly')).toBeNull();
  });
});
