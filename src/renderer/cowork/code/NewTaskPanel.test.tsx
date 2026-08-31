import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkItemPage } from './api';

type FolderPickResult = { ok: boolean; path?: string; cancelled?: boolean; reason?: string };

const {
  pickCodeFolder,
  getPathForFile,
  codingModels,
  projectFolders,
  readSourceContext,
  inspectFolder,
  updateProject,
  searchWorkItems,
  skillLibrary,
} = vi.hoisted(() => ({
  pickCodeFolder: vi.fn<() => Promise<FolderPickResult>>(async () => ({ ok: true, path: 'C:\\Users\\Ian & Team\\plain folder' })),
  getPathForFile: vi.fn(() => 'C:\\Users\\Ian\\design.png'),
  codingModels: vi.fn(async () => ({ items: ['mindshub_air', 'gpt-5.6-sol', 'fable', 'sonnet', 'gpt-codex'] })),
  projectFolders: vi.fn(),
  readSourceContext: vi.fn(),
  inspectFolder: vi.fn(),
  updateProject: vi.fn(),
  searchWorkItems: vi.fn<() => Promise<WorkItemPage>>(async () => ({ items: [], incomplete: false })),
  skillLibrary: vi.fn(async () => ({ sources: [], items: [] })),
}));

vi.mock('../../platform/host', () => ({
  host: { pickCodeFolder, getPathForFile },
}));

vi.mock('../lib/skillsStore', () => ({ useSkills: () => ({ skills: [] }) }));

vi.mock('./api', () => ({
  projectResources: (value: { resources?: unknown[]; folders?: unknown[] }) => value.resources || value.folders || [],
  codingApi: {
    engines: vi.fn(async () => [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]),
    models: codingModels,
    projectFolders,
    projectResources: vi.fn(async () => ({ items: [
      { resource: { kind: 'repository', id: 'cowork', name: 'cowork', source_url: 'https://github.com/mindsdb/cowork.git', checkout_strategy: 'worktree', commands: [] }, availability: { resource_id: 'cowork', status: 'available', eligible_computer_ids: ['local'], detail: '' } },
      { resource: { kind: 'repository', id: 'server', name: 'cowork-server', source_url: 'https://github.com/mindsdb/cowork-server.git', checkout_strategy: 'worktree', commands: [] }, availability: { resource_id: 'server', status: 'available', eligible_computer_ids: ['local'], detail: '' } },
    ] })),
    projectComputers: vi.fn(async () => ({ items: [{
      schema_version: 1, id: 'local', name: 'This computer', is_local: true, status: 'online', active_run_count: 0,
      last_seen_at: '2026-08-23T09:00:00Z',
      capabilities: { platform: 'windows', architecture: 'x64', runtime_version: '1', protocol_versions: ['1.0'], agent_engines: ['codex'], shells: ['powershell'], has_git: true, has_terminal: true, supports_local_folders: true, max_concurrent_runs: 4 },
    }] })),
    computers: vi.fn(async () => ({ items: [{
      schema_version: 1, id: 'local', name: 'This computer', is_local: true, status: 'online', active_run_count: 0,
      last_seen_at: '2026-08-23T09:00:00Z',
      capabilities: { platform: 'windows', architecture: 'x64', runtime_version: '1', protocol_versions: ['1.0'], agent_engines: ['codex'], shells: ['powershell'], has_git: true, has_terminal: true, supports_local_folders: true, max_concurrent_runs: 4 },
    }] })),
    readSourceContext,
    updateProject,
    searchWorkItems,
    inspect: inspectFolder,
    skillLibrary,
  },
}));

import { NewTaskPanel } from './NewTaskPanel';

const models = [
  { id: 'mindshub_air', name: 'MindsHub Air' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gpt', name: 'GPT 5.6 Sol' },
  { id: 'fable', name: 'Claude Fable 5' },
  { id: 'sonnet', name: 'Claude Sonnet 5' },
  { id: 'gpt-codex', name: 'GPT 5.3 Codex' },
];

const modelMeta = {
  modelProviders: {
    mindshub_air: 'openai',
    'gpt-5.6-sol': 'openai',
    gpt: 'openai',
    fable: 'anthropic',
    sonnet: 'anthropic',
    'gpt-codex': 'openai',
  },
  modelFamilies: {
    mindshub_air: 'mindshub_air',
    'gpt-5.6-sol': 'gpt-5.6-sol',
    gpt: 'gpt',
    fable: 'fable',
    sonnet: 'sonnet',
    'gpt-codex': 'gpt-codex',
  },
  modelEnabled: { mindshub_air: true, 'gpt-5.6-sol': true, gpt: true, fable: false, sonnet: false, 'gpt-codex': false },
};

const project = {
  schema_version: 2,
  id: 'project-1',
  name: 'MindsHub',
  folders: [
    { id: 'cowork', name: 'cowork', path: 'C:\\work\\cowork', base_branch: 'staging', commands: [] },
    { id: 'server', name: 'cowork-server', path: 'C:\\work\\cowork-server', base_branch: 'staging', commands: [] },
  ],
  resources: [
    { kind: 'repository' as const, id: 'cowork', name: 'cowork', source_url: 'https://github.com/mindsdb/cowork.git', local_path: 'C:\\work\\cowork', computer_id: null, default_branch: 'staging', checkout_strategy: 'worktree' as const, commands: [] },
    { kind: 'repository' as const, id: 'server', name: 'cowork-server', source_url: 'https://github.com/mindsdb/cowork-server.git', local_path: 'C:\\work\\cowork-server', computer_id: null, default_branch: 'staging', checkout_strategy: 'worktree' as const, commands: [] },
  ],
  connections: [],
  environment: { variables: {}, port_names: ['PORT'] },
  default_engine_id: 'codex',
  default_model: 'gpt-5.6-sol',
  permission_mode: 'supervised' as const,
  created_at: '2026-08-23T09:00:00Z',
  updated_at: '2026-08-23T09:00:00Z',
};

const projectProps = {
  projects: [project],
  selectedProjectId: project.id,
  onProjectChange: vi.fn(),
  onOpenProjectSettings: vi.fn(),
};


describe('NewTaskPanel', () => {
  beforeEach(() => {
    pickCodeFolder.mockReset();
    pickCodeFolder.mockResolvedValue({ ok: true, path: 'C:\\Users\\Ian & Team\\plain folder' });
    inspectFolder.mockReset();
    inspectFolder.mockImplementation(async (path: string) => ({
      path,
      exists: true,
      is_directory: true,
      is_git: false,
      dirty: false,
      warning: 'This folder will be edited directly.',
    }));
    codingModels.mockReset();
    codingModels.mockResolvedValue({ items: ['mindshub_air', 'gpt-5.6-sol', 'fable', 'sonnet', 'gpt-codex'] });
    projectFolders.mockResolvedValue({
      items: project.folders.map((folder) => ({
        folder,
        inspection: { path: folder.path, exists: true, is_directory: true, is_git: true, dirty: false },
        base_branch_available: true,
      })),
    });
    readSourceContext.mockImplementation(async (_id: string, body: { provider: 'github' | 'linear' | 'slack'; kind: string; url: string; connection_name?: string | null }) => ({
      ...body,
      title: 'Linked issue',
      external_id: 'mindsdb/cowork#42',
      body: 'Issue context',
    }));
    updateProject.mockReset();
    updateProject.mockImplementation(async (id: string, body: object) => ({ ...project, id, ...body }));
    searchWorkItems.mockReset();
    searchWorkItems.mockResolvedValue({ items: [], incomplete: false });
  });

  it('defaults to GPT-5.6 Sol without exposing secondary folder access in task creation', async () => {
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={vi.fn(async () => {})}
      />,
    );

    expect(await screen.findByRole('combobox', { name: 'Choose model' })).toHaveTextContent('GPT-5.6 Sol');
    const agentPicker = screen.getByRole('combobox', { name: 'Coding agent' });
    const permissionPicker = screen.getByRole('combobox', { name: 'Coding permissions' });
    expect(agentPicker).toHaveTextContent('Codex');
    expect(permissionPicker).toHaveTextContent('Ask first');
    expect(agentPicker).not.toHaveTextContent('Agent:');
    expect(permissionPicker).not.toHaveTextContent('Coding permissions:');
    expect(screen.queryByRole('button', { name: 'Add folder' })).not.toBeInTheDocument();
    expect(screen.queryByText('Choose an available agent and model.')).not.toBeInTheDocument();
  });

  it('explains why a project default model cannot start a task', async () => {
    const user = userEvent.setup();
    const lockedProject = { ...project, default_model: 'fable' };
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        projects={[lockedProject]}
        selectedProjectId={lockedProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Build it');

    expect(await screen.findByText('Add credits or choose an available model.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start task/i })).toBeDisabled();
  });

  it('opens searchable skill and command discovery from slash on a new task', async () => {
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Coding task' }), { target: { value: '/' } });
    expect(screen.getByRole('listbox', { name: 'Skills and commands' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search skills and commands' })).toBeInTheDocument();
  });

  it('uses the Code Project model and permission defaults for a new task', async () => {
    const onCreate = vi.fn(async () => {});
    const configuredProject = { ...project, default_model: 'fable', permission_mode: 'workspace' as const };
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="sonnet"
        models={models}
        modelMeta={{ ...modelMeta, modelEnabled: { ...modelMeta.modelEnabled, fable: true } }}
        projects={[configuredProject]}
        selectedProjectId={configuredProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(await screen.findByRole('combobox', { name: 'Choose model' })).toHaveTextContent('Claude Fable 5');
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Use project defaults');
    await user.click(screen.getByRole('button', { name: /start task/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'fable',
      permissionMode: 'workspace',
    })));
  });

  it('falls back to the best model the coding runtime actually exposes', async () => {
    codingModels.mockResolvedValue({ items: ['haiku', 'gpt', 'gpt-codex', 'fable'] });
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={vi.fn(async () => {})}
      />,
    );

    expect(await screen.findByRole('combobox', { name: 'Choose model' })).toHaveTextContent('GPT 5.6 Sol');
    expect(screen.queryByText('GPT-5.6 Sol')).not.toBeInTheDocument();
  });

  it('uses the shared searchable catalog instead of a coding-only model list', async () => {
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(await screen.findByRole('combobox', { name: 'Choose model' }));
    expect(screen.getByRole('combobox', { name: 'Search models' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Claude Fable 5/ })).toHaveTextContent('Needs credits');
    expect(screen.getByRole('option', { name: /GPT 5.3 Codex/ })).toBeInTheDocument();
  });

  it('starts against the selected multi-folder Code Project', async () => {
    const onCreate = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={onCreate}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Add a safe feature');

    const start = screen.getByRole('button', { name: /start task/i });
    expect(start).toBeEnabled();

    await user.click(start);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      projectId: 'project-1',
      prompt: 'Add a safe feature',
      engineId: 'codex',
      model: 'gpt-5.6-sol',
      permissionMode: 'supervised',
      attachments: [],
      sourceContexts: [],
      resourceIds: undefined,
      computerId: 'local',
    }));
  });

  it('puts No project before existing projects and keeps New project visually separate', async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        projects={[project]}
        selectedProjectId={project.id}
        onProjectChange={onProjectChange}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Code Project' }));
    expect(screen.getByText('Project')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('No project');
    expect(options[1]).toHaveTextContent('MindsHub');
    expect(options.at(-1)).toHaveTextContent('New project');

    await user.click(options[0]);
    expect(onProjectChange).toHaveBeenCalledWith(null);
  });

  it('closes the resource menu before opening another composer picker', async () => {
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={vi.fn(async () => {})}
      />,
    );

    const resourcePicker = await screen.findByLabelText('Choose task resources');
    await user.click(resourcePicker);
    expect(screen.getByText('Task resources')).toBeVisible();

    await user.click(screen.getByRole('combobox', { name: 'Code Project' }));

    expect(screen.getByText('Task resources')).not.toBeVisible();
    expect(screen.getByText('Project')).toBeVisible();
  });

  it('offers a direct route to create another Code Project', async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    const onOpenProjectSettings = vi.fn();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        projects={[project]}
        selectedProjectId={project.id}
        onProjectChange={onProjectChange}
        onOpenProjectSettings={onOpenProjectSettings}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Code Project' }));
    await user.click(screen.getByRole('option', { name: /New project/ }));

    expect(onProjectChange).not.toHaveBeenCalled();
    expect(onOpenProjectSettings).toHaveBeenCalledOnce();
  });

  it('explains an unavailable project folder beside Start before task creation', async () => {
    const onCreate = vi.fn(async () => {});
    const onOpenProjectSettings = vi.fn();
    const user = userEvent.setup();
    projectFolders.mockResolvedValue({
      items: [{
        folder: project.folders[1],
        inspection: { path: project.folders[1].path, exists: false, is_directory: false, is_git: false, dirty: false },
        base_branch_available: true,
      }],
    });
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onOpenProjectSettings={onOpenProjectSettings}
        onCreate={onCreate}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Update the service');
    expect(await screen.findByText(/cowork-server is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start task/i })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('starts from the composer with the platform keyboard shortcut', async () => {
    const onCreate = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={onCreate}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Coding task' });
    await user.type(input, 'Tighten the task composer');
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      prompt: 'Tighten the task composer',
    })));
  });

  it('lets a project with multiple GitHub connections choose the exact source connection', async () => {
    const user = userEvent.setup();
    const connectedProject = {
      ...project,
      connections: [
        { provider: 'github' as const, name: 'personal', label: 'Personal' },
        { provider: 'github' as const, name: 'work', label: 'Work' },
      ],
    };
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        projects={[connectedProject]}
        selectedProjectId={connectedProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Add issue or PR' }));
    await user.type(screen.getByRole('textbox', { name: 'Issue or pull-request link' }), 'https://github.com/mindsdb/cowork/issues/42');
    await user.click(screen.getByRole('combobox', { name: 'GitHub account' }));
    await user.click(screen.getByRole('option', { name: 'Work' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(readSourceContext).toHaveBeenCalledWith(connectedProject.id, expect.objectContaining({
      provider: 'github',
      connection_name: 'work',
    })));
  });

  it('finds assigned work and starts the task from the selected issue', async () => {
    const user = userEvent.setup();
    const connectedProject = {
      ...project,
      connections: [{ provider: 'github' as const, name: 'work', label: 'Work' }],
    };
    searchWorkItems.mockResolvedValue({
      incomplete: false,
      items: [{
        provider: 'github',
        kind: 'issue',
        url: 'https://github.com/mindsdb/cowork/issues/42',
        title: 'Make Code projects first class',
        external_id: 'mindsdb/cowork#42',
        state: 'open',
        scope: 'mindsdb/cowork',
        assignee: 'ian',
        updated_at: '2026-08-25T08:00:00Z',
        connection_name: 'work',
      }],
    });
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        projects={[connectedProject]}
        selectedProjectId={connectedProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add issue or PR' }));
    await user.click(await screen.findByRole('option', { name: /Make Code projects first class/ }));

    expect(searchWorkItems).toHaveBeenCalledWith(connectedProject.id, expect.objectContaining({
      provider: 'github',
      query: '',
      connection_name: 'work',
    }));
    await waitFor(() => expect(readSourceContext).toHaveBeenCalledWith(connectedProject.id, expect.objectContaining({
      url: 'https://github.com/mindsdb/cowork/issues/42',
    })));
    expect(await screen.findByText('Linked issue')).toBeInTheDocument();
  });

  it('selects a Linear work item whose canonical URL includes a title slug', async () => {
    const user = userEvent.setup();
    const connectedProject = {
      ...project,
      connections: [{ provider: 'linear' as const, name: 'work', label: 'Work' }],
    };
    searchWorkItems.mockResolvedValue({
      incomplete: false,
      items: [{
        provider: 'linear',
        kind: 'issue',
        url: 'https://linear.app/mindsdb/issue/ENG-289/schedule-task-state-is-not-accurate',
        title: 'Schedule task state is not accurate',
        external_id: 'ENG-289',
        state: 'QA',
        scope: 'Engineering',
        assignee: 'Ian',
        updated_at: '2026-08-27T08:00:00Z',
        connection_name: 'work',
      }],
    });
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        projects={[connectedProject]}
        selectedProjectId={connectedProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add issue or PR' }));
    await user.click(await screen.findByRole('option', { name: /Schedule task state is not accurate/ }));

    await waitFor(() => expect(readSourceContext).toHaveBeenCalledWith(connectedProject.id, expect.objectContaining({
      provider: 'linear',
      url: 'https://linear.app/mindsdb/issue/ENG-289/schedule-task-state-is-not-accurate',
      connection_name: 'work',
    })));
    expect(await screen.findByText('Linked issue')).toBeInTheDocument();
  });

  it('uses a connected developer account immediately and assigns it to the selected project', async () => {
    const user = userEvent.setup();
    const onProjectConnectionsChange = vi.fn(async () => {});
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        projects={[project]}
        selectedProjectId={project.id}
        connections={[{
          engine: 'github',
          name: 'ianu82',
          display_name: 'Ian on GitHub',
          status: 'connected',
        }]}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onProjectConnectionsChange={onProjectConnectionsChange}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Add issue or PR' }));
    expect(screen.queryByText('Connect GitHub or Linear to start from an issue or pull request.')).not.toBeInTheDocument();
    await waitFor(() => expect(searchWorkItems).toHaveBeenCalledWith(project.id, expect.objectContaining({
      provider: 'github',
      connection_name: 'ianu82',
    })));
    expect(updateProject).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: 'Issue or pull-request link' }),
      'https://github.com/mindsdb/cowork/issues/42',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith(project.id, {
      connections: [{ provider: 'github', name: 'ianu82', label: 'Ian on GitHub' }],
    }));
    expect(onProjectConnectionsChange).toHaveBeenCalledOnce();
    expect(readSourceContext).toHaveBeenCalledWith(project.id, expect.objectContaining({
      provider: 'github',
      connection_name: 'ianu82',
    }));
    expect(await screen.findByText('Linked issue')).toBeInTheDocument();
  });

  it('turns a pasted issue link into task context without manual connector setup steps', async () => {
    const connectedProject = {
      ...project,
      connections: [{ provider: 'github' as const, name: 'work', label: 'Work' }],
    };
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        projects={[connectedProject]}
        selectedProjectId={connectedProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    fireEvent.paste(screen.getByRole('textbox', { name: 'Coding task' }), {
      clipboardData: {
        files: [],
        getData: () => 'https://github.com/mindsdb/cowork/issues/42',
      },
    });

    await waitFor(() => expect(readSourceContext).toHaveBeenCalledWith(connectedProject.id, expect.objectContaining({
      provider: 'github',
      connection_name: 'work',
    })));
    expect(await screen.findByText('Linked issue')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Coding task' })).toHaveValue('Work on mindsdb/cowork#42: Linked issue');
  });

  it('starts a no-project task from a chosen local folder without Git ceremony', async () => {
    const user = userEvent.setup();
    const onOpenProjectSettings = vi.fn();
    const onCreate = vi.fn(async () => {});
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={{ ...modelMeta, modelEnabled: { ...modelMeta.modelEnabled, fable: true } }}
        projects={[project]}
        selectedProjectId={null}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={onOpenProjectSettings}
        onCreate={onCreate}
      />,
    );

    const start = await screen.findByRole('button', { name: /start task/i });
    await waitFor(() => expect(start).toBeDisabled());
    expect(screen.queryByText('Describe what you want changed.')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Build a small app');
    expect(start).toBeDisabled();
    expect(screen.getByText('Choose a folder to continue.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => expect(start).toBeEnabled());
    expect(screen.getByRole('button', { name: /Change folder, currently plain folder/ })).toHaveTextContent('plain folder');
    expect(screen.queryByText(/Git repository/i)).not.toBeInTheDocument();

    await user.click(start);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      projectId: null,
      path: 'C:\\Users\\Ian & Team\\plain folder',
      prompt: 'Build a small app',
      engineId: 'codex',
      model: 'fable',
      permissionMode: 'supervised',
      attachments: [],
      sourceContexts: [],
    }));
    expect(pickCodeFolder).toHaveBeenCalledOnce();
    expect(inspectFolder).toHaveBeenCalledWith('C:\\Users\\Ian & Team\\plain folder');
    expect(onOpenProjectSettings).not.toHaveBeenCalled();
  });

  it('keeps readiness feedback outside the stable composer surface', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        projects={[project]}
        selectedProjectId={null}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Keep the layout still');
    const status = await screen.findByRole('status');
    const composer = screen.getByRole('region', { name: 'Create coding task' });
    const statusSlot = container.querySelector('.code-start-status-slot');

    expect(status).toHaveTextContent('Choose a folder to continue.');
    expect(composer).not.toContainElement(status);
    expect(statusSlot).toContainElement(status);
  });

  it('keeps the no-project draft intact when folder selection is cancelled', async () => {
    pickCodeFolder.mockResolvedValue({ ok: false, cancelled: true });
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        projects={[project]}
        selectedProjectId={null}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));

    expect(screen.getByRole('textbox', { name: 'Coding task' })).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: /start task/i })).toBeDisabled();
    expect(inspectFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps Start disabled when a chosen standalone folder becomes unavailable', async () => {
    inspectFolder.mockResolvedValue({
      path: 'C:\\Users\\Ian & Team\\plain folder',
      exists: false,
      is_directory: false,
      is_git: false,
      dirty: false,
    });
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        projects={[project]}
        selectedProjectId={null}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Use this folder');
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));

    expect(await screen.findByText('That folder is no longer available. Choose another folder.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start task/i })).toBeDisabled();
  });

  it('accepts files dropped onto the task composer', async () => {
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        {...projectProps}
        onCreate={vi.fn(async () => {})}
      />,
    );
    const image = new File(['image'], 'design.png', { type: 'image/png' });
    const composer = screen.getByRole('region', { name: 'Create coding task' });
    fireEvent.drop(composer, {
      dataTransfer: { files: [image], types: ['Files'] },
    });
    expect(screen.getByText('design.png')).toBeInTheDocument();
  });
});
