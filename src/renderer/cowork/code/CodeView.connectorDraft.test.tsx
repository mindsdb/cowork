import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { codingApi, type CodeComputer, type CodeProject, type CodingSession } from './api';
import { resetSkillLibraryCache } from './useSkillLibrary';
import type { ConnectorConnection } from '../api';
import CodeView from './CodeView';

const mocks = vi.hoisted(() => ({
  oauthConnect: vi.fn(),
  fetchDatasources: vi.fn(),
}));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform/host')>();
  return { ...actual, host: { ...actual.host, isElectron: true,
    pickCodeFolder: async () => ({ ok: true, path: '/work/my-app' }),
    getPathForFile: () => '/work/brief.md', oauthConnect: mocks.oauthConnect,
  } };
});
vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(), fetchDatasources: mocks.fetchDatasources,
}));

const account = { engine: 'linear', name: 'work', status: 'connected' };
const projectDetours = ['projects', 'task'].flatMap((origin) => (
  ['connected', 'cancelled', 'failed'].map((outcome) => ({ origin, outcome }))
));
const computer = {
  id: 'local', name: 'This computer', is_local: true, status: 'online',
  capabilities: { agent_engines: ['codex'], supports_local_folders: true },
} as CodeComputer;

function App({ initialView = 'task' }: { initialView?: string }) {
  const [view, setView] = useState(initialView);
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  return <>
    <button onClick={() => setView('projects')}>Navigate to projects</button>
    <button onClick={() => setView('task')}>Navigate to new task</button>
    <button onClick={() => setView('connectors')}>Navigate to connectors</button>
    <CodeView sessions={[]} selectedId={null} newTask={view === 'task'} projectsOpen={view === 'projects'} connectorsOpen={view === 'connectors'}
      defaultEngineId="codex" defaultModel="gpt" models={[{ id: 'gpt', name: 'GPT' }, { id: 'other', name: 'Other model' }]} modelMeta={{ modelEnabled: { gpt: true, other: true } }}
      connections={connections} onConnectionsChange={setConnections} onSessionsChange={() => {}} onSelectionChange={() => {}}
      onOpenConnectors={() => setView('connectors')} onOpenProjects={() => setView('projects')} onOpenNewTask={() => setView('task')} />
  </>;
}

describe('Task and project connector detours', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    resetSkillLibraryCache();
    vi.spyOn(codingApi, 'sessions').mockResolvedValue({ items: [] });
    vi.spyOn(codingApi, 'projects').mockResolvedValue({ items: [] });
    vi.spyOn(codingApi, 'projectFolders').mockResolvedValue({ items: [] });
    vi.spyOn(codingApi, 'projectResources').mockResolvedValue({ items: [] });
    vi.spyOn(codingApi, 'projectComputers').mockResolvedValue({ items: [computer] });
    vi.spyOn(codingApi, 'engines').mockResolvedValue([{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]);
    vi.spyOn(codingApi, 'models').mockResolvedValue({ items: ['gpt', 'other'] });
    vi.spyOn(codingApi, 'computers').mockResolvedValue({ items: [computer] });
    vi.spyOn(codingApi, 'inspect').mockImplementation(async (path) => ({ path, exists: true, is_directory: true, is_git: false, dirty: false }));
    vi.spyOn(codingApi, 'updateProject');
    vi.spyOn(codingApi, 'skillLibrary').mockResolvedValue({ sources: [], items: [] });
    vi.spyOn(codingApi, 'searchWorkItems').mockResolvedValue({ items: [], incomplete: false });
    mocks.fetchDatasources.mockResolvedValue({ connections: [account] });
    mocks.oauthConnect.mockResolvedValue({ ok: true, name: account.name });
  });

  it.each(projectDetours)('preserves a project from $origin through a $outcome connection and saves it', async ({ origin, outcome }) => {
    const github = { engine: 'github', name: 'work', status: 'connected' };
    mocks.fetchDatasources.mockResolvedValue({ connections: [github] });
    if (outcome !== 'connected') mocks.oauthConnect.mockResolvedValue({ ok: false, reason: outcome === 'cancelled' ? 'cancelled' : 'Connection failed' });
    vi.spyOn(codingApi, 'githubRepositories').mockResolvedValue({ items: [{
      full_name: 'acme/private', clone_url: 'https://github.com/acme/private.git', private: true,
      default_branch: 'main', archived: false, connection_name: 'work',
    }], next_page: null });
    vi.spyOn(codingApi, 'createProject').mockImplementation(async (values) => {
      const saved: CodeProject = { ...values, schema_version: 2, id: 'saved-project', folders: [],
        created_at: '2026-09-25T09:00:00Z', updated_at: '2026-09-25T09:00:00Z' };
      vi.mocked(codingApi.projects).mockResolvedValue({ items: [saved] });
      return saved;
    });
    vi.spyOn(codingApi, 'create').mockResolvedValue({ id: 'started-task' } as CodingSession);
    const user = userEvent.setup();
    const { container } = render(<App initialView={origin} />);
    let taskPrompt: HTMLElement | undefined;
    let taskPermissions: HTMLElement | undefined;
    let taskModel: HTMLElement | undefined;
    if (origin === 'projects') await user.click(await screen.findByRole('button', { name: 'New project' }));
    else {
      taskPrompt = await screen.findByRole('textbox', { name: 'Coding task' });
      fireEvent.change(taskPrompt, { target: { value: 'Keep the task underneath project setup' } });
      await user.click(screen.getByRole('button', { name: 'Choose folder' }));
      await screen.findByRole('button', { name: 'Change folder, currently my-app' });
      fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['brief'], 'brief.md')] } });
      taskPermissions = screen.getByRole('combobox', { name: 'Coding permissions' });
      await user.click(taskPermissions);
      await user.click(screen.getByRole('option', { name: 'Full access' }));
      taskModel = screen.getByRole('combobox', { name: 'Choose model' });
      await user.click(taskModel);
      await user.click(screen.getByRole('option', { name: 'Other model' }));
      await user.click(await screen.findByRole('combobox', { name: 'Code Project' }));
      await user.click(screen.getByRole('option', { name: /New project/ }));
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Keep my project' } });
    await user.click(screen.getByRole('button', { name: 'Git repository' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Git repository URL' }), { target: { value: 'https://github.com/acme/seed.git' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('combobox', { name: 'Default coding permissions' }));
    await user.click(screen.getByRole('option', { name: 'Full access' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Variables' }), { target: { value: 'QA_MODE=keep' } });
    await user.click(screen.getByRole('button', { name: 'Git repository' }));
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    const back = await screen.findByRole('button', { name: 'Back to project settings' });
    const githubCard = screen.getByRole('heading', { name: 'GitHub' }).closest('section')!;
    await user.click(within(githubCard).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(mocks.oauthConnect).toHaveBeenCalled());
    if (outcome === 'connected') await screen.findByText('work');
    if (outcome === 'failed') await screen.findByText('Connection failed');
    await user.click(back);

    if (origin === 'task') {
      expect(taskPrompt).toBeInTheDocument();
      expect(taskPrompt).toHaveValue('Keep the task underneath project setup');
      expect(taskPermissions).toHaveTextContent('Full access');
      expect(taskModel).toHaveTextContent('Other model');
    }
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Keep my project');
    expect(screen.getByRole('button', { name: 'Remove seed' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Default coding permissions' })).toHaveTextContent('Full access');
    expect(screen.getByRole('textbox', { name: 'Variables' })).toHaveValue('QA_MODE=keep');
    if (outcome === 'connected') {
      await user.click(screen.getByRole('button', { name: 'Git repository' }));
      await user.click(await screen.findByRole('button', { name: 'acme/private Private Add' }));
    }
    expect(codingApi.updateProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(codingApi.createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Keep my project', permission_mode: 'full_access',
      environment: expect.objectContaining({ variables: { QA_MODE: 'keep' } }),
      resources: expect.arrayContaining([
        expect.objectContaining({ source_url: 'https://github.com/acme/seed.git' }),
        ...(outcome === 'connected' ? [expect.objectContaining({ source_url: 'https://github.com/acme/private.git', connector_name: 'work', default_branch: 'main' })] : []),
      ]),
      ...(outcome === 'connected' ? { connections: [{ provider: 'github', name: 'work', label: 'work' }] } : {}),
    })));
    expect(codingApi.createProject).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    if (origin === 'task') {
      expect(screen.getByRole('textbox', { name: 'Coding task' })).toBe(taskPrompt);
      expect(screen.getByText('brief.md')).toBeVisible();
      expect(screen.getByRole('combobox', { name: 'Code Project' })).toHaveTextContent('Keep my project');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start task' })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: 'Start task' }));
      await waitFor(() => expect(codingApi.create).toHaveBeenCalledWith(expect.objectContaining({
        project_id: 'saved-project', prompt: 'Keep the task underneath project setup',
        permission_mode: 'full_access', computer_id: 'local',
        attachments: [expect.objectContaining({ path: '/work/brief.md' })],
      })));
    }
  });

  it('does not reopen a discarded project draft after leaving Connectors through the sidebar', async () => {
    const user = userEvent.setup();
    render(<App initialView="projects" />);
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Discarded draft' } });
    await user.click(screen.getByRole('button', { name: 'Git repository' }));
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await user.click(screen.getByRole('button', { name: 'Navigate to new task' }));
    // Base UI may retain the closing modal until its exit animation finishes.
    const closingDialog = screen.queryByRole('dialog');
    if (closingDialog) expect(closingDialog).toHaveAttribute('data-closed');
    await user.click(screen.getByRole('button', { name: 'Navigate to connectors' }));
    expect(screen.queryByRole('button', { name: 'Back to project settings' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Navigate to projects' }));
    await user.click(screen.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
  });

  it.each(['new', 'existing'])('keeps the selected task project when %s project setup is cancelled after a connector detour', async (setup) => {
    const project: CodeProject = {
      schema_version: 2, id: 'existing', name: 'Existing project', connections: [], folders: [],
      resources: [{ kind: 'local_folder', id: 'repo', name: 'my-app', path: '/work/my-app', computer_id: 'local', commands: [] }],
      environment: { variables: {}, port_names: [] }, default_engine_id: 'codex', default_model: 'gpt', permission_mode: 'supervised',
      created_at: '2026-09-25T09:00:00Z', updated_at: '2026-09-25T09:00:00Z',
    };
    vi.mocked(codingApi.projects).mockResolvedValue({ items: [project] });
    const user = userEvent.setup();
    render(<App />);
    const prompt = await screen.findByRole('textbox', { name: 'Coding task' });
    fireEvent.change(prompt, { target: { value: 'Keep the existing project task' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Code Project' })).toHaveTextContent('Existing project'));
    await user.click(screen.getByRole('combobox', { name: 'Coding permissions' }));
    await user.click(screen.getByRole('option', { name: 'Full access' }));
    if (setup === 'new') {
      await user.click(screen.getByRole('combobox', { name: 'Code Project' }));
      await user.click(screen.getByRole('option', { name: /New project/ }));
    } else {
      await user.click(screen.getByRole('button', { name: 'Edit Existing project' }));
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Unsaved project edit' } });
    await user.click(screen.getByRole('button', { name: 'Git repository' }));
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await user.click(screen.getByRole('button', { name: 'Back to project settings' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Unsaved project edit');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Coding task' })).toBe(prompt);
    expect(prompt).toHaveValue('Keep the existing project task');
    expect(screen.getByRole('combobox', { name: 'Code Project' })).toHaveTextContent('Existing project');
    expect(screen.getByRole('combobox', { name: 'Coding permissions' })).toHaveTextContent('Full access');
    expect(codingApi.updateProject).not.toHaveBeenCalled();
  });

  it.each(['connected', 'cancelled', 'failed'] as const)('keeps the folder, brief, attachments and permissions when connection is %s', async (outcome) => {
    if (outcome !== 'connected') mocks.oauthConnect.mockResolvedValue({ ok: false, reason: outcome === 'cancelled' ? 'cancelled' : 'Connection failed' });
    const user = userEvent.setup();
    const { container } = render(<App />);
    const prompt = await screen.findByRole('textbox', { name: 'Coding task' });
    fireEvent.change(prompt, { target: { value: 'Keep my task brief' } });
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByRole('button', { name: 'Change folder, currently my-app' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['brief'], 'brief.md')] } });
    await user.click(screen.getByRole('combobox', { name: 'Coding permissions' }));
    await user.click(screen.getByRole('option', { name: 'Full access' }));
    await user.click(screen.getByRole('button', { name: 'Add issue or PR' }));
    await user.click(screen.getByRole('button', { name: 'Open Connectors' }));

    expect(screen.queryByRole('textbox', { name: 'Coding task' })).toBeNull();
    const back = screen.getByRole('button', { name: 'Back to task' });
    const linear = screen.getByRole('heading', { name: 'Linear' }).closest('section')!;
    await user.click(within(linear).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(mocks.oauthConnect).toHaveBeenCalled());
    if (outcome === 'failed') await screen.findByText('Connection failed');
    if (outcome === 'connected') await screen.findByText('work');
    await user.click(back);

    expect(screen.getByRole('textbox', { name: 'Coding task' })).toBe(prompt);
    expect(prompt).toHaveValue('Keep my task brief');
    expect(screen.getByRole('button', { name: 'Change folder, currently my-app' })).toHaveAttribute('title', '/work/my-app');
    expect(screen.getByText('brief.md')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Coding permissions' })).toHaveTextContent('Full access');
    expect(screen.getByRole('button', { name: 'Start task' })).toBeEnabled();
    expect(codingApi.updateProject).not.toHaveBeenCalled();
    if (outcome === 'connected') await screen.findByRole('textbox', { name: 'Issue or pull-request link' });
    else expect(screen.getByRole('button', { name: 'Open Connectors' })).toBeVisible();
  });

  it('drops the suspended draft when navigating elsewhere and leaves ordinary Connectors visits unchanged', async () => {
    const user = userEvent.setup();
    render(<App />);
    const prompt = await screen.findByRole('textbox', { name: 'Coding task' });
    fireEvent.change(prompt, { target: { value: 'Old draft' } });
    await user.click(screen.getByRole('button', { name: 'Add issue or PR' }));
    await user.click(screen.getByRole('button', { name: 'Open Connectors' }));
    await user.click(screen.getByRole('button', { name: 'Navigate to projects' }));
    expect(prompt).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Navigate to connectors' }));
    expect(screen.queryByRole('button', { name: 'Back to task' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Navigate to new task' }));
    expect(screen.getByRole('textbox', { name: 'Coding task' })).toHaveValue('');
  });
});
