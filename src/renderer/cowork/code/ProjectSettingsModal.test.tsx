import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodeProject, PlaybookStatus, SkillLibraryItem } from './api';

const { engines, models, pickCodeFolder, playbook, skillLibrary } = vi.hoisted(() => ({
  engines: vi.fn(async () => [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]),
  models: vi.fn(async () => ({ items: ['gpt-5.6-sol', 'fable'] })),
  pickCodeFolder: vi.fn(async () => ({ ok: true, path: '/work/new-project' })),
  playbook: vi.fn<(id: string) => Promise<PlaybookStatus>>(),
  skillLibrary: vi.fn<() => Promise<{ sources: never[]; items: SkillLibraryItem[] }>>(async () => ({
    sources: [],
    items: [{
      id: 'quality-skill', kind: 'skill', name: 'Thermo-Nuclear Code Quality Review',
      description: 'Run an exacting engineering quality review.', origin: 'team',
      source_id: 'engineering', source_name: 'Engineering standards', path: 'skills/quality/SKILL.md',
      enabled: true, enabled_project_ids: [],
    }],
  })),
}));

vi.mock('../../platform/host', () => ({
  host: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    pickCodeFolder,
  },
}));

vi.mock('./api', () => ({
  codingApi: {
    engines,
    models,
    playbook,
    skillLibrary,
    computers: vi.fn(async () => ({ items: [] })),
    projectResources: vi.fn(async () => ({ items: [] })),
    resolveLocalResource: vi.fn(async (folder) => ({
      kind: 'local_folder', id: folder.id, name: folder.name, path: folder.path,
      computer_id: 'local', commands: folder.commands,
    })),
  },
}));

import { ProjectSettingsModal } from './ProjectSettingsModal';
import { resetSkillLibraryCache } from './useSkillLibrary';

const project: CodeProject = {
  schema_version: 2,
  id: 'project-1',
  name: 'MindsHub',
  folders: [{ id: 'cowork', name: 'cowork', path: '/work/cowork', base_branch: 'staging', commands: [] }],
  resources: [{ kind: 'repository', id: 'cowork', name: 'cowork', source_url: 'https://github.com/mindsdb/cowork.git', local_path: '/work/cowork', computer_id: null, default_branch: 'staging', checkout_strategy: 'worktree', commands: [] }],
  connections: [],
  environment: { variables: {}, port_names: ['PORT'] },
  default_engine_id: 'codex',
  default_model: 'gpt-5.6-sol',
  permission_mode: 'supervised',
  created_at: '2026-08-23T09:00:00Z',
  updated_at: '2026-08-23T09:00:00Z',
};

describe('ProjectSettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSkillLibraryCache();
  });

  it('keeps account management out of an unsaved project draft while making skills selectable', async () => {
    render(
      <ProjectSettingsModal
        open
        project={null}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onOpenConnectors={vi.fn()}
      />,
    );

    expect(screen.getByText('Save this project, then add GitHub or Linear.')).toBeInTheDocument();
    expect(await screen.findByText('1 available')).toBeInTheDocument();
    expect(screen.getByText('Choose skills')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Connectors' })).not.toBeInTheDocument();
  });

  it('turns an empty project skill picker into a path to the Skills library', async () => {
    const user = userEvent.setup();
    const onOpenSkills = vi.fn();
    skillLibrary.mockResolvedValueOnce({ sources: [], items: [] });
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onOpenSkills={onOpenSkills}
      />,
    );

    await user.click(await screen.findByText('Choose skills'));
    await user.click(screen.getByRole('button', { name: 'Open Skills' }));
    expect(onOpenSkills).toHaveBeenCalledOnce();
  });

  it('shows MindsHub-maintained skills as included while creating a project', async () => {
    const user = userEvent.setup();
    skillLibrary.mockResolvedValueOnce({
      sources: [],
      items: [{
        id: 'thermo-nuclear-code-quality-review', kind: 'skill',
        name: 'Thermo-Nuclear Code Quality Review',
        description: 'Run an exacting engineering quality review.', origin: 'built_in',
        source_id: null, source_name: 'MindsHub', path: 'thermo-nuclear-code-quality-review/SKILL.md',
        enabled: true, enabled_project_ids: [],
      }],
    });
    render(
      <ProjectSettingsModal
        open
        project={null}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await user.click(await screen.findByText('1 skill included'));
    expect(screen.getByText('Thermo-Nuclear Code Quality Review')).toBeInTheDocument();
    expect(screen.getByText('MindsHub maintained')).toBeInTheDocument();
    expect(screen.getByText('Included')).toBeInTheDocument();
    expect(screen.queryByText('0 available')).not.toBeInTheDocument();
  });

  it('summarises and exposes an existing project skill selection', async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsModal
        open
        project={{
          ...project,
          skill_sources: [
            { source_id: 'engineering', enabled_paths: ['skills/quality/SKILL.md', 'AGENTS.md'] },
          ],
        }}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('2 skills added')).toBeInTheDocument();
    await user.click(screen.getByText('2 skills added'));
    expect(screen.getByRole('checkbox', { name: /Thermo-Nuclear Code Quality Review/ })).toBeChecked();
  });

  it('assigns team skills while creating a project for the first time', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values, id: 'created-project' } as CodeProject));
    render(
      <ProjectSettingsModal
        open
        project={null}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add a local folder' }));
    await user.click(await screen.findByText('Choose skills'));
    await user.click(screen.getByRole('checkbox', { name: /Thermo-Nuclear Code Quality Review/ }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      skill_sources: [{ source_id: 'engineering', enabled_paths: ['skills/quality/SKILL.md'] }],
    })));
  });

  it('removes a team skill from an existing project', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    render(
      <ProjectSettingsModal
        open
        project={{
          ...project,
          skill_sources: [{ source_id: 'engineering', enabled_paths: ['skills/quality/SKILL.md'] }],
        }}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText('1 skill added'));
    await user.click(screen.getByRole('checkbox', { name: /Thermo-Nuclear Code Quality Review/ }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ skill_sources: [] })));
  });

  it('keeps the project editor open when saving its complete configuration fails', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn(async () => { throw new Error('Could not assign this skill.'); });
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    await user.click(await screen.findByText('Choose skills'));
    await user.click(screen.getByRole('checkbox', { name: /Thermo-Nuclear Code Quality Review/ }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByText('Could not assign this skill.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Project settings' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a failed project deletion actionable and visible', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => { throw new Error('Delete the project tasks first.'); });
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    expect(await screen.findByText('Delete the project tasks first.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Delete this Code Project?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeEnabled();
  });

  it('uses the first-class Connectors section and routes account management to Connectors', async () => {
    const user = userEvent.setup();
    const onOpenConnectors = vi.fn();
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[
          { engine: 'github', name: 'work', display_name: 'MindsDB GitHub', status: 'connected' },
          { engine: 'slack', name: 'ignored', display_name: 'Slack', status: 'connected' },
        ]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onOpenConnectors={onOpenConnectors}
      />,
    );

    expect(screen.getByText('Connectors')).toBeInTheDocument();
    expect(screen.getByText('MindsDB GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    expect(onOpenConnectors).toHaveBeenCalledOnce();
  });

  it('persists project task defaults through the shared model picker', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        models={[
          { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
          { id: 'fable', name: 'Claude Fable 5' },
        ]}
        modelMeta={{ modelProviders: { 'gpt-5.6-sol': 'openai', fable: 'anthropic' } }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText('Task defaults and environment'));
    await user.click(await screen.findByRole('combobox', { name: 'Default coding model' }));
    await user.click(screen.getByRole('option', { name: 'Claude Fable 5' }));
    await user.click(screen.getByRole('combobox', { name: 'Default coding permissions' }));
    await user.click(screen.getByRole('option', { name: 'Workspace auto' }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      default_engine_id: 'codex',
      default_model: 'fable',
      permission_mode: 'workspace',
    })));
  });

  it('preserves unsaved settings while the user connects a developer account', async () => {
    const user = userEvent.setup();
    const props = {
      project,
      connections: [],
      busy: false,
      onClose: vi.fn(),
      onSave: vi.fn(),
    };
    const { rerender } = render(<ProjectSettingsModal {...props} open suspended={false} />);
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Unsaved project name');

    rerender(<ProjectSettingsModal {...props} open={false} suspended />);
    rerender(<ProjectSettingsModal {...props} open suspended={false} />);

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Unsaved project name');
  });

  it('resolves the legacy default id to the live GPT 5.6 Sol catalog model', async () => {
    const user = userEvent.setup();
    models.mockResolvedValueOnce({ items: ['gpt', 'gpt-codex'] });
    render(
      <ProjectSettingsModal
        open
        project={null}
        connections={[]}
        busy={false}
        defaultModel="gpt-5.6-sol"
        models={[
          { id: 'gpt', name: 'GPT 5.6 Sol' },
          { id: 'gpt-codex', name: 'GPT 5.3 Codex' },
        ]}
        modelMeta={{ modelProviders: { gpt: 'openai', 'gpt-codex': 'openai' } }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByText('Task defaults and environment'));
    expect(screen.getByRole('combobox', { name: 'Default coding agent' })).toHaveTextContent('Codex');
    expect(await screen.findByRole('combobox', { name: 'Default coding model' })).toHaveTextContent('GPT 5.6 Sol');
  });

  it('stores the live catalog id for a project saved with the legacy GPT 5.6 Sol id', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    const modelIds = ['gpt', 'gpt-codex'];
    const props = {
      project,
      connections: [],
      busy: false,
      defaultModel: 'gpt-5.6-sol',
      models: [
        { id: 'gpt', name: 'GPT 5.6 Sol' },
        { id: 'gpt-codex', name: 'GPT 5.3 Codex' },
      ],
      modelMeta: { modelProviders: { gpt: 'openai', 'gpt-codex': 'openai' } },
      catalog: {
        engines: [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }],
        enginesLoading: false,
        error: '',
        modelError: () => '',
        modelIds: () => modelIds,
        modelsLoading: () => false,
        loadModels: async () => {},
      },
      onClose: vi.fn(),
      onSave,
    };
    const { rerender } = render(<ProjectSettingsModal {...props} open={false} />);

    rerender(<ProjectSettingsModal {...props} open />);

    await user.click(screen.getByText('Task defaults and environment'));
    expect(screen.getByRole('combobox', { name: 'Default coding model' })).toHaveTextContent('GPT 5.6 Sol');
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ default_model: 'gpt' })));
  });

  it('ignores a playbook status that arrives after the editor moved to another project', async () => {
    const late = new Promise<PlaybookStatus>((resolve) => {
      setTimeout(() => resolve({ configured: true, update_available: true, current_revision: 'aaaaaaaa1111', items: [], diff: 'stale' }), 0);
    });
    playbook
      .mockReturnValueOnce(late)
      .mockResolvedValue({ configured: true, update_available: false, current_revision: 'bbbbbbbb2222', items: [], diff: '' });
    const withPlaybook = (id: string): CodeProject => ({
      ...project, id, name: id, playbook: { repository: `git@github.com:mindsdb/${id}.git`, branch: 'main' },
    });
    const props = { connections: [], busy: false, onClose: vi.fn(), onSave: vi.fn() };
    const view = render(<ProjectSettingsModal {...props} open project={withPlaybook('project-a')} />);

    view.rerender(<ProjectSettingsModal {...props} open project={withPlaybook('project-b')} />);
    expect(await screen.findByText('bbbbbbbb')).toBeInTheDocument();
    await act(async () => { await late; });

    expect(screen.getByText('bbbbbbbb')).toBeInTheDocument();
    expect(screen.queryByText('Update available')).toBeNull();
  });

  it('saves a default reasoning effort for the project', async () => {
    const onSave = vi.fn(async () => project);
    const user = userEvent.setup();
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        models={[{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' }]}
        modelMeta={{
          modelProviders: { 'gpt-5.6-sol': 'openai' },
          modelEfforts: { 'gpt-5.6-sol': { efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' } },
        }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText('Task defaults and environment'));
    const effort = await screen.findByRole('combobox', { name: 'Default reasoning effort' });
    expect(effort).toHaveTextContent('Model default');
    await user.click(effort);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Model defaultMedium', 'None', 'Low', 'Medium', 'High', 'Xhigh', 'Max',
    ]);
    await user.click(screen.getByRole('option', { name: /^Low/ }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ default_reasoning_effort: 'low' })));
  });

  it('offers no reasoning default for a model that advertises no levels', async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        models={[{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' }]}
        modelMeta={{ modelProviders: { 'gpt-5.6-sol': 'openai' }, modelEfforts: {} }}
        onClose={vi.fn()}
        onSave={vi.fn(async () => project)}
      />,
    );

    await user.click(screen.getByText('Task defaults and environment'));
    expect(await screen.findByRole('combobox', { name: 'Default coding model' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Default reasoning effort' })).toBeNull();
  });
});
