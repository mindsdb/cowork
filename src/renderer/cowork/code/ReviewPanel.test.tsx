import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';
import { ReviewPanel } from './ReviewPanel';


const directSession: CodingSession = {
  schema_version: 1,
  id: 'direct-task',
  title: 'Update a plain folder',
  engine_id: 'codex',
  engine_adapter_version: '1',
  model: 'fable',
  permission_mode: 'supervised',
  status: 'completed',
  source_path: 'C:\\work\\plain-folder',
  workspace_path: 'C:\\work\\plain-folder',
  workspace_kind: 'direct_folder',
  source_dirty: false,
  event_count: 0,
  created_at: '2026-08-21T09:00:00Z',
  updated_at: '2026-08-21T09:05:00Z',
};

const projectSession: CodingSession = {
  ...directSession,
  id: 'project-task',
  project_id: 'project-1',
  project_name: 'Project Atlas',
  workspace_kind: 'git_worktree',
  source_path: '/source/frontend',
  workspace_path: '/tasks/project-task/frontend',
  workspaces: [{
    folder_id: 'frontend',
    folder_name: 'frontend',
    source_path: '/source/frontend',
    workspace_path: '/tasks/project-task/frontend',
    workspace_kind: 'git_worktree',
    source_dirty: false,
    base_revision: 'abc123',
    base_branch: 'staging',
    task_branch: 'cowork/project/project-task',
  }],
};


describe('ReviewPanel', () => {
  it('does not claim a direct folder is unchanged when no Git baseline exists', () => {
    render(
      <ReviewPanel
        open
        session={directSession}
        git={null}
        files={[]}
        busy={false}
        error=""
        onClose={vi.fn()}
        onBranch={vi.fn(async () => {})}
        onCommit={vi.fn(async () => {})}
        onApply={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('Change tracking unavailable')).toBeInTheDocument();
    expect(screen.getByText('Open the folder to review changes')).toBeInTheDocument();
    expect(screen.queryByText('Working tree unchanged')).toBeNull();
  });

  it('explains when a project has no validation commands instead of silently doing nothing', async () => {
    render(
      <ReviewPanel
        open
        session={projectSession}
        git={null}
        files={[]}
        busy={false}
        error=""
        onClose={vi.fn()}
        onBranch={vi.fn(async () => {})}
        onCommit={vi.fn(async () => {})}
        onApply={vi.fn(async () => {})}
        onValidate={vi.fn(async () => [])}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Handoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }));

    await waitFor(() => expect(screen.getByText(/No project checks are configured/)).toBeInTheDocument());
  });

  it('acknowledges an applied diff and prevents an accidental duplicate handoff', async () => {
    const onApply = vi.fn(async () => {});
    render(
      <ReviewPanel
        open
        session={projectSession}
        git={null}
        files={[{
          folder_id: 'frontend',
          folder_name: 'frontend',
          path: 'release.json',
          status: 'M',
          additions: 1,
          deletions: 1,
          patch: '+"verified": true\n',
          binary: false,
        }]}
        busy={false}
        error=""
        onClose={vi.fn()}
        onBranch={vi.fn(async () => {})}
        onCommit={vi.fn(async () => {})}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Handoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Applied' })).toBeDisabled());
    expect(onApply).toHaveBeenCalledOnce();
    expect(screen.getByText(/reviewed changes were applied/)).toBeInTheDocument();
  });

  it('offers agent-assisted recovery after a handoff conflict', async () => {
    const onResolveConflicts = vi.fn(async () => {});
    render(
      <ReviewPanel
        open
        session={projectSession}
        git={null}
        files={[]}
        busy={false}
        error="Handoff stopped before changing the source: patch conflict"
        onClose={vi.fn()}
        onBranch={vi.fn(async () => {})}
        onCommit={vi.fn(async () => {})}
        onApply={vi.fn(async () => {})}
        onResolveConflicts={onResolveConflicts}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Handoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve with agent' }));

    expect(onResolveConflicts).toHaveBeenCalledOnce();
  });

  it('publishes an explicitly selected progress update to linked work', async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => {});
    const linkedSession: CodingSession = {
      ...projectSession,
      source_contexts: [{
        provider: 'github',
        kind: 'issue',
        url: 'https://github.com/mindsdb/cowork/issues/42',
        title: 'Issue 42',
        external_id: 'mindsdb/cowork#42',
        body: '',
      }],
    };
    render(
      <ReviewPanel
        open
        session={linkedSession}
        git={null}
        files={[]}
        busy={false}
        error=""
        onClose={vi.fn()}
        onBranch={vi.fn(async () => {})}
        onCommit={vi.fn(async () => {})}
        onApply={vi.fn(async () => {})}
        onPublish={onPublish}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Handoff' }));
    await user.click(screen.getByText('Share an update'));
    await user.type(screen.getByPlaceholderText('Summarize the result for your team…'), 'Tests are running.');
    await user.click(screen.getByRole('combobox', { name: 'Update type' }));
    await user.click(screen.getByRole('option', { name: 'Progress update' }));
    await user.click(screen.getByRole('button', { name: 'Publish to GitHub' }));

    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(
      linkedSession.source_contexts![0],
      'Tests are running.',
      'progress',
    ));
  });
});
