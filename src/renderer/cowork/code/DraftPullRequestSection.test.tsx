import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deliveryPlan: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('./api', () => ({
  codingApi: { deliveryPlan: mocks.deliveryPlan },
}));

vi.mock('../../platform/host', () => ({
  host: { openExternal: mocks.openExternal },
}));

import { DraftPullRequestSection } from './DraftPullRequestSection';

const connection = { provider: 'github' as const, name: 'work', label: 'Work GitHub' };
const integration = { provider: 'github' as const, connection_name: 'work', label: 'Work GitHub', status: 'connected' as const, detail: '' };
const readyItems = [
  {
    folder_id: 'frontend', folder_name: 'Frontend', workspace_path: '/task/frontend',
    remote_url: 'https://github.com/mindsdb/frontend.git', base_branch: 'staging',
    task_branch: 'cowork/task/frontend', status: 'ready' as const, detail: '',
  },
  {
    folder_id: 'server', folder_name: 'Server', workspace_path: '/task/server',
    remote_url: 'https://github.com/mindsdb/server.git', base_branch: 'staging',
    task_branch: 'cowork/task/server', status: 'ready' as const, detail: '',
  },
];

const defaults = {
  sessionId: 'task-1',
  taskTitle: 'Improve project delivery',
  busy: false,
  refreshKey: 'clean',
  connections: [connection],
  onCreate: vi.fn(async () => []),
  onCommit: vi.fn(async () => {}),
  onOpenProjectSettings: vi.fn(),
  onAgentAction: vi.fn(async () => {}),
  onPullRequestAction: vi.fn(async () => {}),
  onArchive: vi.fn(async () => {}),
};

describe('DraftPullRequestSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliveryPlan.mockResolvedValue({ items: readyItems, integrations: [integration] });
  });

  it('creates drafts only for the repositories the user selected', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => []);
    render(<DraftPullRequestSection {...defaults} onCreate={onCreate} />);

    await user.click(await screen.findByText('Repositories'));
    await user.click(screen.getByRole('checkbox', { name: /Frontend/ }));
    await user.click(screen.getByRole('button', { name: 'Create 1 draft pull request' }));
    await user.click(screen.getByRole('button', { name: 'Create drafts' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
      'Improve project delivery',
      '',
      'work',
      [{ folder_id: 'server', title: 'Improve project delivery', body: '' }],
    ));
  });

  it('resolves all uncommitted project repositories in one explicit action', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn(async () => {});
    mocks.deliveryPlan
      .mockResolvedValueOnce({
        integrations: [integration],
        items: readyItems.map((item) => ({ ...item, status: 'needs_commit' as const, detail: 'Commit required' })),
      })
      .mockResolvedValue({ items: readyItems, integrations: [integration] });
    render(<DraftPullRequestSection {...defaults} onCommit={onCommit} />);

    await user.click(await screen.findByRole('button', { name: 'Commit 2 repositories' }));

    expect(onCommit).toHaveBeenCalledWith('Improve project delivery');
    expect(await screen.findByRole('button', { name: 'Create 2 draft pull requests' })).toBeEnabled();
  });

  it('shows named checks and confirms lifecycle actions for a published pull request', async () => {
    const user = userEvent.setup();
    const onPullRequestAction = vi.fn(async () => {});
    const published = {
      ...readyItems[0],
      status: 'published' as const,
      external_url: 'https://github.com/mindsdb/frontend/pull/42',
      connection_name: 'work',
      pull_request_status: {
        state: 'draft' as const,
        review_state: 'none' as const,
        ci_state: 'passing' as const,
        number: 42,
        title: 'Improve project delivery',
        checks: [{ name: 'Frontend tests', state: 'passing' as const, url: 'https://github.com/checks/1' }],
        feedback: [],
        detail: '',
      },
    };
    mocks.deliveryPlan.mockResolvedValue({ items: [published], integrations: [integration] });
    render(<DraftPullRequestSection {...defaults} onPullRequestAction={onPullRequestAction} />);

    await user.click(await screen.findByText('Checks'));
    expect(screen.getByText('Frontend tests')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark ready' }));
    await user.click(screen.getAllByRole('button', { name: 'Mark ready' }).at(-1)!);

    await waitFor(() => expect(onPullRequestAction).toHaveBeenCalledWith(published, 'ready'));
  });
});
