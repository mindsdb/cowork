// A project folder can disappear and come back while the composer is open
// (ENG-4346). The warning has to follow the folder, not the moment the
// project list was last loaded.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectFolders } = vi.hoisted(() => ({ projectFolders: vi.fn() }));

const computer = {
  schema_version: 1, id: 'local', name: 'This computer', is_local: true, status: 'online', active_run_count: 0,
  last_seen_at: '2026-08-23T09:00:00Z',
  capabilities: { platform: 'darwin', architecture: 'arm64', runtime_version: '1', protocol_versions: ['1.0'], agent_engines: ['codex'], shells: ['zsh'], has_git: true, has_terminal: true, supports_local_folders: true, max_concurrent_runs: 4 },
};

vi.mock('../../platform/host', () => ({
  host: { pickCodeFolder: vi.fn(), getPathForFile: vi.fn(() => '') },
  onMindsHubCredentialChanged: () => () => {},
}));

vi.mock('../lib/skillsStore', () => ({ useSkills: () => ({ skills: [] }) }));

vi.mock('./api', () => ({
  projectResources: (value: { resources?: unknown[]; folders?: unknown[] }) => value.resources || value.folders || [],
  codingApi: {
    engines: vi.fn(async () => [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]),
    models: vi.fn(async () => ({ items: ['gpt-5.6-sol'] })),
    projectFolders,
    repositoryStatus: vi.fn(async () => ({ items: [
      { resource_id: 'proj', local: true, available: true, branch: 'main', branches: ['main'], changes: [], change_count: 0, detail: '' },
    ] })),
    repositoryBranches: vi.fn(async () => ({ items: ['main'] })),
    projectResources: vi.fn(async () => ({ items: [
      { resource: { kind: 'repository', id: 'proj', name: 'proj', local_path: '/Users/olha/proj', checkout_strategy: 'worktree', commands: [] }, availability: { resource_id: 'proj', status: 'available', eligible_computer_ids: ['local'], detail: '' } },
    ] })),
    projectComputers: vi.fn(async () => ({ items: [computer] })),
    computers: vi.fn(async () => ({ items: [computer] })),
    initializeGit: vi.fn(),
    workspaceModes: vi.fn(async () => ({ supported: ['worktree'], default: 'worktree' })),
    readSourceContext: vi.fn(),
    updateProject: vi.fn(),
    searchWorkItems: vi.fn(async () => ({ items: [], incomplete: false })),
    inspect: vi.fn(),
    skillLibrary: vi.fn(async () => ({ sources: [], items: [] })),
  },
}));

import { NewTaskPanel } from './NewTaskPanel';

const folder = { id: 'proj', name: 'proj', path: '/Users/olha/proj', base_branch: 'main', commands: [] };

const project = {
  schema_version: 2,
  id: 'project-1',
  name: 'proj',
  folders: [folder],
  resources: [
    { kind: 'repository' as const, id: 'proj', name: 'proj', source_url: null, local_path: '/Users/olha/proj', computer_id: 'local', default_branch: 'main', checkout_strategy: 'worktree' as const, commands: [] },
  ],
  connections: [],
  environment: { variables: {}, port_names: [] },
  default_engine_id: 'codex',
  default_model: 'gpt-5.6-sol',
  permission_mode: 'supervised' as const,
  created_at: '2026-08-23T09:00:00Z',
  updated_at: '2026-08-23T09:00:00Z',
};

const projects = [project];

const present = { items: [{
  folder,
  inspection: { path: folder.path, exists: true, is_directory: true, is_git: true, dirty: false },
  base_branch_available: true,
}] };

// What cowork-server answers once the folder has been renamed away.
const missing = { items: [{
  folder,
  inspection: { path: folder.path, exists: false, is_directory: false, is_git: false, dirty: false },
  base_branch_available: true,
}] };

const WARNING = 'proj is unavailable. Remove and re-add it in Project settings.';

function renderComposer(onCreate = vi.fn(async () => {})) {
  render(
    <NewTaskPanel
      busy={false}
      error=""
      defaultEngineId="codex"
      defaultModel="gpt-5.6-sol"
      models={[{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]}
      modelMeta={{
        modelProviders: { 'gpt-5.6-sol': 'openai' },
        modelFamilies: { 'gpt-5.6-sol': 'gpt-5.6-sol' },
        modelEnabled: { 'gpt-5.6-sol': true },
        modelEfforts: {},
      }}
      projects={projects}
      selectedProjectId={project.id}
      onProjectChange={vi.fn()}
      onOpenProjectSettings={vi.fn()}
      onCreate={onCreate}
    />,
  );
  return onCreate;
}

const startButton = () => screen.getByRole('button', { name: /start task/i });

describe('NewTaskPanel project folder availability', () => {
  beforeEach(() => {
    localStorage.removeItem('mindshub-code:last-folder');
    localStorage.removeItem('mindshub-code:workspace-mode');
    projectFolders.mockReset();
    projectFolders.mockResolvedValue(present);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns when a folder becomes unavailable while the composer is open', async () => {
    const user = userEvent.setup();
    const onCreate = renderComposer();
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Add a file');
    await waitFor(() => expect(startButton()).toBeEnabled());
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();

    // The user renames the folder in the file manager and comes back.
    projectFolders.mockResolvedValue(missing);
    fireEvent.focus(window);

    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('does not create a task when the folder has gone missing by the time Start is pressed', async () => {
    const user = userEvent.setup();
    const onCreate = renderComposer();
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Add a file');
    await waitFor(() => expect(startButton()).toBeEnabled());

    // Nothing has told the composer yet: the only chance left is Start itself.
    projectFolders.mockResolvedValue(missing);
    await user.click(startButton());

    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('still creates the task when the folder is there at Start', async () => {
    const user = userEvent.setup();
    const onCreate = renderComposer();
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Add a file');
    await waitFor(() => expect(startButton()).toBeEnabled());

    await user.click(startButton());

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Add a file', projectId: project.id }));
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it('cancels the start when the draft is edited while the folders are being checked', async () => {
    const user = userEvent.setup();
    const onCreate = renderComposer();
    const prompt = screen.getByRole('textbox', { name: 'Coding task' });
    await user.type(prompt, 'Add a file');
    await waitFor(() => expect(startButton()).toBeEnabled());

    // The check at Start is slow, and the prompt is still editable meanwhile.
    let answer: (value: typeof present) => void = () => {};
    projectFolders.mockReturnValue(new Promise<typeof present>((resolve) => { answer = resolve; }));
    await user.click(startButton());
    await waitFor(() => expect(startButton()).toBeDisabled());
    await user.type(prompt, ' named notes.md');
    projectFolders.mockResolvedValue(present);
    await act(async () => { answer(present); });

    // Neither the old prompt nor the new one is sent without a second Start.
    await waitFor(() => expect(startButton()).toBeEnabled());
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(startButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Add a file named notes.md' }));
  });

  it('clears the warning by itself once the folder is back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const settle = async (ms: number) => {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    };
    projectFolders.mockResolvedValue(missing);
    renderComposer();
    fireEvent.change(screen.getByRole('textbox', { name: 'Coding task' }), { target: { value: 'Add a file' } });
    await settle(50);
    expect(screen.getByText(WARNING)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();

    // The folder is renamed back. No reload, no click, no focus change.
    projectFolders.mockResolvedValue(present);
    await settle(6_000);

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(startButton()).toBeEnabled();
  });

  it('Refresh re-checks the project folders and clears a stale warning', async () => {
    const user = userEvent.setup();
    projectFolders.mockResolvedValue(missing);
    renderComposer();
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Add a file');
    expect(await screen.findByText(WARNING)).toBeInTheDocument();

    projectFolders.mockResolvedValue(present);
    const checksBefore = projectFolders.mock.calls.length;
    await waitFor(() => expect(screen.getByLabelText('Repositories and folders')).toBeEnabled());
    await user.click(screen.getByLabelText('Repositories and folders'));
    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    await waitFor(() => expect(refresh).toBeEnabled());
    await user.click(refresh);

    // Well inside the 5 second automatic re-check: this is Refresh's doing.
    await waitFor(() => expect(screen.queryByText(WARNING)).not.toBeInTheDocument(), { timeout: 1_000 });
    expect(projectFolders.mock.calls.length).toBeGreaterThan(checksBefore);
    // The open drawer hides the composer behind it from assistive technology.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(startButton()).toBeEnabled());
  });

  it('keeps the last known state when a background re-check cannot reach the server', async () => {
    const user = userEvent.setup();
    const onCreate = renderComposer();
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Add a file');
    await waitFor(() => expect(startButton()).toBeEnabled());

    projectFolders.mockRejectedValue(new Error('Failed to fetch'));
    const checksBefore = projectFolders.mock.calls.length;
    fireEvent.focus(window);
    await waitFor(() => expect(projectFolders.mock.calls.length).toBeGreaterThan(checksBefore));

    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    await waitFor(() => expect(startButton()).toBeEnabled());
    // Start still goes to the server, which has the last word.
    await user.click(startButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  });
});
