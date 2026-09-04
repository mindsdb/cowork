import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CodeProject } from './api';
import { CodeProjectsView } from './CodeProjectsView';


const projects: CodeProject[] = [
  {
    schema_version: 2,
    id: 'mindshub',
    name: 'MindsHub',
    folders: [
      { id: 'cowork', name: 'cowork', path: '/work/cowork', commands: [] },
      { id: 'server', name: 'cowork-server', path: '/work/cowork-server', commands: [] },
    ],
    resources: [
      { kind: 'repository', id: 'cowork', name: 'cowork', source_url: 'https://github.com/mindsdb/cowork.git', local_path: '/work/cowork', computer_id: null, default_branch: null, checkout_strategy: 'worktree', commands: [] },
      { kind: 'repository', id: 'server', name: 'cowork-server', source_url: 'https://github.com/mindsdb/cowork-server.git', local_path: '/work/cowork-server', computer_id: null, default_branch: null, checkout_strategy: 'worktree', commands: [] },
    ],
    connections: [],
    environment: { variables: {}, port_names: ['PORT'] },
    default_engine_id: 'codex',
    default_model: 'gpt-5.6-sol',
    permission_mode: 'workspace',
    created_at: '2026-08-23T09:00:00Z',
    updated_at: '2026-08-24T09:00:00Z',
  },
  {
    schema_version: 2,
    id: 'atlas',
    name: 'Project Atlas',
    folders: [{ id: 'api', name: 'atlas-api', path: '/work/atlas-api', commands: [] }],
    resources: [{ kind: 'local_folder', id: 'api', name: 'atlas-api', path: '/work/atlas-api', computer_id: 'local', commands: [] }],
    connections: [],
    environment: { variables: {}, port_names: ['PORT'] },
    default_engine_id: 'codex',
    default_model: 'gpt-5.6-sol',
    permission_mode: 'supervised',
    created_at: '2026-08-22T09:00:00Z',
    updated_at: '2026-08-23T09:00:00Z',
  },
];

describe('CodeProjectsView', () => {
  it('searches projects and opens the chosen project in a new task', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <CodeProjectsView
        projects={projects}
        selectedId="mindshub"
        loading={false}
        error=""
        onOpen={onOpen}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'atlas');
    expect(screen.queryByText('MindsHub')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start a task in Project Atlas' }));
    expect(onOpen).toHaveBeenCalledWith('atlas');
  });

  it('keeps project creation and settings directly reachable', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onEdit = vi.fn();
    render(
      <CodeProjectsView
        projects={projects}
        selectedId="mindshub"
        loading={false}
        error=""
        onOpen={vi.fn()}
        onCreate={onCreate}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.click(screen.getByRole('button', { name: 'Edit MindsHub' }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith('mindshub');
  });
});
