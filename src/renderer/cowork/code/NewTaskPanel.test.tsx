import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pickCodeFolder, getPathForFile, codingModels, projectFolders, readSourceContext } = vi.hoisted(() => ({
  pickCodeFolder: vi.fn(async () => ({ ok: true, path: 'C:\\Users\\Ian & Team\\plain folder' })),
  getPathForFile: vi.fn(() => 'C:\\Users\\Ian\\design.png'),
  codingModels: vi.fn(async () => ({ items: ['mindshub_air', 'gpt-5.6-sol', 'fable', 'sonnet', 'gpt-codex'] })),
  projectFolders: vi.fn(),
  readSourceContext: vi.fn(),
}));

vi.mock('../../platform/host', () => ({
  host: { pickCodeFolder, getPathForFile },
}));

vi.mock('../lib/skillsStore', () => ({ useSkills: () => ({ skills: [] }) }));

vi.mock('./api', () => ({
  codingApi: {
    engines: vi.fn(async () => [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]),
    models: codingModels,
    projectFolders,
    readSourceContext,
    inspect: vi.fn(async (path: string) => ({
      path,
      exists: true,
      is_directory: true,
      is_git: false,
      dirty: false,
      warning: 'This folder will be edited directly.',
    })),
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
  schema_version: 1,
  id: 'project-1',
  name: 'MindsHub',
  folders: [
    { id: 'cowork', name: 'cowork', path: 'C:\\work\\cowork', base_branch: 'staging', commands: [] },
    { id: 'server', name: 'cowork-server', path: 'C:\\work\\cowork-server', base_branch: 'staging', commands: [] },
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
    pickCodeFolder.mockClear();
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
    const configuredProject = { ...project, default_model: 'mindshub_air', permission_mode: 'workspace' as const };
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="sonnet"
        models={models}
        modelMeta={modelMeta}
        projects={[configuredProject]}
        selectedProjectId={configuredProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(await screen.findByRole('combobox', { name: 'Choose model' })).toHaveTextContent('MindsHub Air');
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Use project defaults');
    await user.click(screen.getByRole('button', { name: /start task/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'mindshub_air',
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
    }));
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
        defaultModel="gpt-5.6-sol"
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
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        projects={[connectedProject]}
        selectedProjectId={connectedProject.id}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Link work' }));
    await user.click(screen.getByRole('combobox', { name: 'Developer tool connection' }));
    await user.click(screen.getByRole('option', { name: 'GitHub · Work' }));
    await user.type(screen.getByRole('textbox', { name: 'Source link' }), 'https://github.com/mindsdb/cowork/issues/42');
    await user.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() => expect(readSourceContext).toHaveBeenCalledWith(connectedProject.id, expect.objectContaining({
      provider: 'github',
      connection_name: 'work',
    })));
  });

  it('enables Start after a prompt and opens project creation when one is missing', async () => {
    const user = userEvent.setup();
    const onOpenProjectSettings = vi.fn();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        projects={[]}
        selectedProjectId={null}
        onProjectChange={vi.fn()}
        onOpenProjectSettings={onOpenProjectSettings}
        onCreate={vi.fn(async () => {})}
      />,
    );

    const start = await screen.findByRole('button', { name: /start task/i });
    await waitFor(() => expect(start).toBeDisabled());
    expect(screen.queryByText('Describe what you want changed.')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Build a small app');
    expect(start).toBeEnabled();
    expect(screen.getByText('Choose a Code Project to continue.')).toBeInTheDocument();
    await user.click(start);
    expect(onOpenProjectSettings).toHaveBeenCalledOnce();
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
