import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codingApi, type ProjectResource } from './api';
import { TaskRepositoriesControl } from './TaskRepositoriesControl';
import { branchNameIssue, emptyRepositorySetup } from './repositorySetupModels';

vi.mock('./api', () => ({
  codingApi: { repositoryStatus: vi.fn(), repositoryDiff: vi.fn(), repositoryBranches: vi.fn() },
}));
const resources: ProjectResource[] = [
  {
    kind: 'repository',
    id: 'app',
    name: 'Application',
    local_path: '/app',
    computer_id: 'local',
    default_branch: 'staging',
    checkout_strategy: 'worktree',
    commands: [],
  },
  {
    kind: 'repository',
    id: 'api',
    name: 'API',
    local_path: '/api',
    computer_id: 'local',
    default_branch: 'main',
    checkout_strategy: 'worktree',
    commands: [],
  },
  { kind: 'local_folder', id: 'notes', name: 'Notes', path: '/notes', computer_id: 'local', commands: [] },
];
const items = [
  {
    resource_id: 'app',
    available: true,
    local: true,
    branch: 'main',
    branches: ['main', 'staging'],
    changes: ['file.ts'],
    change_count: 1,
    detail: '',
  },
  {
    resource_id: 'api',
    available: true,
    local: true,
    branch: 'main',
    branches: ['main', 'staging'],
    changes: [],
    change_count: 0,
    detail: '',
  },
];

function setup(props: Partial<React.ComponentProps<typeof TaskRepositoriesControl>> = {}) {
  const onApply = vi.fn();
  const view = render(
    <TaskRepositoriesControl
      projectId="project"
      resources={resources}
      selectedIds={['app', 'api', 'notes']}
      local
      onApply={onApply}
      {...props}
    />,
  );
  return { ...view, onApply, user: userEvent.setup() };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(codingApi.repositoryStatus).mockResolvedValue({ items });
  vi.mocked(codingApi.repositoryDiff).mockResolvedValue({ files: [] });
});

describe('task repository setup', () => {
  it('applies only on confirmation and preserves displayed base branches', async () => {
    const { user, onApply } = setup();
    await user.click(screen.getByLabelText('Repositories and folders'));
    await screen.findByText('Application has 1 local change');
    await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feat/my-work');
    await user.click(screen.getByLabelText('Include API'));
    await user.click(screen.getByRole('radio', { name: /Include my local changes/ }));
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply to task' }));
    expect(onApply).toHaveBeenCalledWith(['app', 'notes'], {
      branch: 'feat/my-work',
      base_branches: { app: 'staging' },
      include_local_changes: true,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('discards unconfirmed edits on Escape, and restores the applied choices on reopen', async () => {
    const { user, onApply } = setup({ setup: { ...emptyRepositorySetup(), branch: 'feat/saved' } });
    await user.click(screen.getByLabelText('Repositories and folders'));
    await user.clear(screen.getByRole('textbox', { name: /New branch/ }));
    await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feat/not-saved');
    await user.keyboard('{Escape}');
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('Repositories and folders'));
    expect(screen.getByRole('textbox', { name: /New branch/ })).toHaveValue('feat/saved');
  });

  it('offers the drawer for one repository and cannot deselect its last resource', async () => {
    const { user } = setup({ resources: resources.slice(0, 1), selectedIds: ['app'] });
    await user.click(screen.getByLabelText('Repositories and folders'));
    expect(screen.getByLabelText('Include Application')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('combobox', { name: 'Start Application from' })).toBeInTheDocument();
  });

  it('rejects an invalid or existing task branch without sending a request', async () => {
    const { user, onApply } = setup();
    await user.click(screen.getByLabelText('Repositories and folders'));
    await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'bad name');
    expect(screen.getByRole('button', { name: 'Apply to task' })).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: /New branch/ }));
    await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'main');
    expect(screen.getByText(/That branch already exists/)).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('has a retry path when inspection fails and never applies unchecked choices', async () => {
    vi.mocked(codingApi.repositoryStatus).mockRejectedValueOnce(new Error('Repository check failed'));
    const { user } = setup();
    await user.click(screen.getByLabelText('Repositories and folders'));
    await screen.findByText('Repository check failed');
    expect(screen.getByRole('button', { name: 'Apply to task' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply to task' })).toBeEnabled());
    expect(screen.queryByText('Repository check failed')).not.toBeInTheDocument();
  });

  it('keeps remote resource selection but does not claim to inspect remote local changes', async () => {
    const { user, onApply } = setup({ local: false });
    await user.click(screen.getByLabelText('Repositories and folders'));
    expect(codingApi.repositoryStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /New branch/ })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Include Notes'));
    await user.click(screen.getByRole('button', { name: 'Apply to task' }));
    expect(onApply).toHaveBeenCalledWith(['app', 'api'], undefined);
  });

  it('loads the actual diff only when requested and reports its error', async () => {
    vi.mocked(codingApi.repositoryDiff).mockRejectedValueOnce(new Error('Checkout moved'));
    const { user } = setup();
    await user.click(screen.getByLabelText('Repositories and folders'));
    await user.click(await screen.findByRole('button', { name: 'View diff' }));
    await screen.findByText('Checkout moved');
    expect(codingApi.repositoryDiff).toHaveBeenCalledWith('project', 'app');
    await user.click(screen.getByRole('button', { name: 'Close and retry' }));
    await user.click(screen.getByRole('button', { name: 'View diff' }));
    await screen.findByText(/No local changes remain/);
  });

  it('clears repository-only choices when only a local folder is selected', async () => {
    const { user, onApply } = setup({
      setup: { branch: 'feat/code', base_branches: { app: 'main' }, include_local_changes: true },
    });
    await user.click(screen.getByLabelText('Repositories and folders'));
    await user.click(screen.getByLabelText('Include Application'));
    await user.click(screen.getByLabelText('Include API'));
    await user.click(screen.getByRole('button', { name: 'Apply to task' }));
    expect(onApply).toHaveBeenCalledWith(['notes'], emptyRepositorySetup());
  });

  it('preserves offline resource information in the new drawer', async () => {
    const { user } = setup({
      resourceStates: [
        {
          resource: resources[2],
          availability: {
            resource_id: 'notes',
            status: 'offline',
            required_computer_id: 'another',
            eligible_computer_ids: [],
            detail: 'Unavailable',
          },
        },
      ],
    });
    await user.click(screen.getByLabelText('Repositories and folders'));
    expect(screen.getByText('Required computer is offline')).toBeVisible();
  });

  it('invalidates a previously opened diff when status is refreshed', async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText('Repositories and folders'));
    await user.click(await screen.findByRole('button', { name: 'View diff' }));
    await screen.findByText(/No local changes remain/);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(await screen.findByRole('button', { name: 'View diff' }));
    await waitFor(() => expect(codingApi.repositoryDiff).toHaveBeenCalledTimes(2));
  });

  it('loads remote branch names only when their picker opens', async () => {
    vi.mocked(codingApi.repositoryStatus).mockResolvedValue({
      items: [
        {
          ...items[0],
          local: false,
          branch: null,
          branches: [],
          changes: [],
          change_count: 0,
          detail: 'Downloaded when the task starts',
        },
      ],
    });
    vi.mocked(codingApi.repositoryBranches).mockResolvedValue({ items: ['staging', 'feature/remote'] });
    const { user } = setup({ resources: resources.slice(0, 1), selectedIds: ['app'] });
    await user.click(screen.getByLabelText('Repositories and folders'));
    await screen.findByText('Downloaded when the task starts');
    expect(codingApi.repositoryBranches).not.toHaveBeenCalled();
    await user.click(screen.getByRole('combobox', { name: 'Start Application from' }));
    expect(await screen.findByText('feature/remote')).toBeVisible();
    expect(codingApi.repositoryBranches).toHaveBeenCalledWith('project', 'app');
    await user.click(screen.getByRole('option', { name: 'feature/remote' }));
    await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feature/remote');
    expect(screen.getByText(/That branch already exists/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply to task' })).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: /New branch/ }));
    await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feature/new');
    expect(screen.getByRole('button', { name: 'Apply to task' })).toBeEnabled();
  });

  it.each(['deselect', 'refresh'])('blocks an unavailable selected repository until %s resolves it', async resolution => {
    vi.mocked(codingApi.repositoryStatus).mockResolvedValueOnce({ items: [
      { ...items[0], available: false, detail: 'The checkout is not a Git repository.' }, items[1],
    ] });
    const { user, onApply } = setup();
    await user.click(screen.getByLabelText('Repositories and folders'));
    await screen.findByText('The checkout is not a Git repository.');
    const apply = screen.getByRole('button', { name: 'Apply to task' });
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole(resolution === 'refresh' ? 'button' : 'checkbox', {
      name: resolution === 'refresh' ? 'Refresh' : /Include Application/,
    }));
    await waitFor(() => expect(apply).toBeEnabled());
  });

  describe('remote task branch validation', () => {
    beforeEach(() => {
      vi.mocked(codingApi.repositoryStatus).mockResolvedValue({ items: [
        { ...items[0], local: false, branch: null, branches: [], changes: [], change_count: 0, detail: 'Downloaded when the task starts' },
        items[1],
      ] });
    });

    it('checks remote branches on Apply without opening a picker, and allows a unique name', async () => {
      vi.mocked(codingApi.repositoryBranches).mockResolvedValue({ items: ['main', 'feature/existing'] });
      const { user, onApply } = setup();
      await user.click(screen.getByLabelText('Repositories and folders'));
      await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feature/existing');
      await user.click(screen.getByRole('button', { name: 'Apply to task' }));
      expect(await screen.findByText(/That branch already exists/)).toBeVisible();
      expect(onApply).not.toHaveBeenCalled();
      expect(codingApi.repositoryBranches).toHaveBeenCalledWith('project', 'app');
      expect(codingApi.repositoryBranches).toHaveBeenCalledTimes(1);
      await user.clear(screen.getByRole('textbox', { name: /New branch/ }));
      await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feature/new');
      await user.click(screen.getByRole('button', { name: 'Apply to task' }));
      await waitFor(() => expect(onApply).toHaveBeenCalledWith(['app', 'api', 'notes'], {
        branch: 'feature/new', base_branches: { app: 'staging', api: 'main' }, include_local_changes: false,
      }));
    });

    it('holds choices while checking and lets a failed check be retried', async () => {
      let reject!: (error: Error) => void;
      vi.mocked(codingApi.repositoryBranches).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
        .mockResolvedValue({ items: ['main'] });
      const { user, onApply } = setup();
      await user.click(screen.getByLabelText('Repositories and folders'));
      await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feature/new');
      await user.click(screen.getByRole('button', { name: 'Apply to task' }));
      expect(screen.getByRole('button', { name: /Checking branches/ })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: /New branch/ })).toBeDisabled();
      expect(screen.getByLabelText('Include Application')).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('combobox', { name: 'Start Application from' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: /Include my local changes/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
      expect(onApply).not.toHaveBeenCalled();
      await act(async () => reject(new Error('Connection lost')));
      expect(screen.getByRole('alert')).toHaveTextContent(/Connection lost.*Apply again to retry/);
      await user.click(screen.getByRole('button', { name: 'Apply to task' }));
      await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    });

    it('never applies a late result after the drawer is closed', async () => {
      let resolve!: (result: { items: string[] }) => void;
      vi.mocked(codingApi.repositoryBranches).mockReturnValue(new Promise(done => { resolve = done; }));
      const { user, onApply } = setup();
      await user.click(screen.getByLabelText('Repositories and folders'));
      await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feature/new');
      await user.click(screen.getByRole('button', { name: 'Apply to task' }));
      await user.keyboard('{Escape}');
      await act(async () => resolve({ items: ['main'] }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onApply).not.toHaveBeenCalled();
    });

    it('does not check unselected remote repositories or automatic task names', async () => {
      const { user, onApply } = setup();
      await user.click(screen.getByLabelText('Repositories and folders'));
      await user.click(screen.getByLabelText('Include Application'));
      await user.type(screen.getByRole('textbox', { name: /New branch/ }), 'feature/new');
      await user.click(screen.getByRole('button', { name: 'Apply to task' }));
      expect(onApply).toHaveBeenCalledOnce();
      expect(codingApi.repositoryBranches).not.toHaveBeenCalled();
      await user.click(screen.getByLabelText('Repositories and folders'));
      await user.click(screen.getByRole('button', { name: 'Apply to task' }));
      expect(onApply).toHaveBeenCalledTimes(2);
      expect(codingApi.repositoryBranches).not.toHaveBeenCalled();
    });
  });
});

it.each(['bad name', 'x..y', 'x.lock', '-option', 'a//b', 'a\\b', 'a@{b', 'a/', 'a.'])(
  'rejects invalid branch %s',
  (name) => expect(branchNameIssue(name)).not.toBe(''),
);
it.each(['', 'feat/qa-123', 'release/1.2.3'])('accepts branch %s', (name) =>
  expect(branchNameIssue(name)).toBe(''),
);
