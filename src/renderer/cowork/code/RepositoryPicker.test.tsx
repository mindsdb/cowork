import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryPicker, repositoryKey } from './RepositoryPicker';
import type { GitHubRepository, GitHubRepositoryPage } from './api';

const { githubRepositories } = vi.hoisted(() => ({ githubRepositories: vi.fn() }));
vi.mock('./api', () => ({ codingApi: { githubRepositories } }));

const repository: GitHubRepository = { full_name: 'acme/web', clone_url: 'https://github.com/acme/web.git', private: true, default_branch: 'staging', archived: false, connection_name: 'work' };
const props = () => ({ connections: [{ engine: 'github', name: 'work', display_name: 'Work', status: 'connected' }], existingUrls: [], onChoose: vi.fn(), onAddUrl: vi.fn(), onOpenConnectors: vi.fn(), onClose: vi.fn() });
beforeEach(() => { githubRepositories.mockReset().mockResolvedValue({ items: [repository], next_page: null }); });

describe('RepositoryPicker', () => {
  it('adds the selected repository with its connection and default branch', async () => {
    const values = props();
    render(<RepositoryPicker {...values} />);
    await userEvent.click(await screen.findByRole('button', { name: 'acme/web Private Add' }));
    expect(values.onChoose).toHaveBeenCalledWith(repository);
    expect(githubRepositories).toHaveBeenCalledWith('work', 1);
  });

  it('searches subsequent pages, not just the first 100 repositories', async () => {
    githubRepositories.mockResolvedValueOnce({ items: [repository], next_page: 2 })
      .mockResolvedValueOnce({ items: [{ ...repository, full_name: 'acme/api', clone_url: 'https://github.com/acme/api.git' }], next_page: null });
    render(<RepositoryPicker {...props()} />);
    await screen.findByText('acme/web');
    await userEvent.type(screen.getByRole('textbox', { name: 'Search repositories' }), 'API');
    expect(await screen.findByText('acme/api')).toBeInTheDocument();
    expect(screen.queryByText('acme/web')).not.toBeInTheDocument();
    expect(githubRepositories).toHaveBeenCalledTimes(2);
  });

  it('does not fetch every page merely by opening the picker; load more deduplicates', async () => {
    githubRepositories.mockResolvedValueOnce({ items: [repository], next_page: 2 }).mockResolvedValueOnce({ items: [repository], next_page: null });
    render(<RepositoryPicker {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more repositories' }));
    await waitFor(() => expect(githubRepositories).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('acme/web')).toHaveLength(1);
  });

  it('ignores late responses after changing account', async () => {
    let resolveOld!: (value: GitHubRepositoryPage) => void;
    githubRepositories.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ items: [{ ...repository, full_name: 'personal/app' }], next_page: null });
    const values = props();
    values.connections.push({ engine: 'github', name: 'personal', display_name: 'Personal', status: 'connected' });
    render(<RepositoryPicker {...values} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'GitHub account' }));
    await userEvent.click(screen.getByRole('option', { name: 'Personal' }));
    await screen.findByText('personal/app');
    await act(async () => resolveOld({ items: [repository], next_page: null }));
    expect(screen.queryByText('acme/web')).not.toBeInTheDocument();
  });

  it('marks URL and SSH variants of an existing repository as added', async () => {
    render(<RepositoryPicker {...props()} existingUrls={['git@github.com:acme/web.git']} />);
    expect(await screen.findByRole('button', { name: 'acme/web Private Added' })).toBeDisabled();
  });

  it('offers connection and manual URL entry without a GitHub account', async () => {
    const values = { ...props(), connections: [] };
    render(<RepositoryPicker {...values} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(values.onOpenConnectors).toHaveBeenCalledOnce();
    const input = screen.getByRole('textbox', { name: 'Git repository URL' });
    await userEvent.type(input, 'https://gitlab.com/acme/api.git{Enter}');
    expect(values.onAddUrl).toHaveBeenCalledWith('https://gitlab.com/acme/api.git');
    expect(githubRepositories).not.toHaveBeenCalled();
  });

  it.each(['needs_reconnect', 'missing'])('does not query an account marked %s', async (status) => {
    const values = props();
    values.connections[0].status = status;
    render(<RepositoryPicker {...values} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect GitHub' }));
    expect(values.onOpenConnectors).toHaveBeenCalledOnce();
    expect(githubRepositories).not.toHaveBeenCalled();
  });

  it('shows an actionable error and can retry without losing the query', async () => {
    githubRepositories.mockRejectedValueOnce(new Error('This connection has expired or lacks permission for that resource'));
    render(<RepositoryPicker {...props()} />);
    await screen.findByRole('alert');
    await userEvent.type(screen.getByRole('textbox', { name: 'Search repositories' }), 'web');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('acme/web');
    expect(screen.getByRole('textbox', { name: 'Search repositories' })).toHaveValue('web');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains earlier results when a subsequent page fails', async () => {
    githubRepositories.mockResolvedValueOnce({ items: [repository], next_page: 2 }).mockRejectedValueOnce(new Error('Offline'));
    render(<RepositoryPicker {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more repositories' }));
    await screen.findByRole('alert');
    expect(screen.getByText('acme/web')).toBeInTheDocument();
  });

  it('shows an honest empty state with an access-management path', async () => {
    githubRepositories.mockResolvedValue({ items: [], next_page: null });
    render(<RepositoryPicker {...props()} />);
    expect(await screen.findByText('No repositories available to this connection.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage access' })).toBeInTheDocument();
  });

  it('closes on Escape without closing the parent form', async () => {
    const values = props();
    const parent = vi.fn();
    render(<div onKeyDown={parent}><RepositoryPicker {...values} /></div>);
    await screen.findByText('acme/web');
    await userEvent.keyboard('{Escape}');
    expect(values.onClose).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
  });

  it('disables edits and selections while the project is saving', async () => {
    render(<RepositoryPicker {...props()} disabled />);
    expect(await screen.findByRole('button', { name: 'acme/web Private Add' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Search repositories' })).toBeDisabled();
  });

  it.each(['https://github.com/acme/web.git', 'https://github.com/acme/web/', 'git@github.com:acme/web.git', 'ssh://git@github.com/acme/web.git'])(
    'normalizes %s for duplicate detection', (value) => expect(repositoryKey(value)).toBe('https://github.com/acme/web'),
  );
});
