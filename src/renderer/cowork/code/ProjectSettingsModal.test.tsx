import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodingCatalog } from './useCodingCatalog';

import type { CodeProject, PlaybookStatus, SkillLibraryItem } from './api';

const { engines, models, pickCodeFolder, playbook, skillLibrary, githubRepositories } = vi.hoisted(() => ({
  githubRepositories: vi.fn(async () => ({ items: [{ full_name: 'acme/private', clone_url: 'https://github.com/acme/private.git', private: true, default_branch: 'develop', archived: false, connection_name: 'work' }], next_page: null })),
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

const credentialListeners = vi.hoisted(() => new Set<() => void>());
vi.mock('../../platform/host', () => ({
  onMindsHubCredentialChanged: (listener: () => void) => {
    credentialListeners.add(listener);
    return () => credentialListeners.delete(listener);
  },
  host: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    pickCodeFolder,
  },
}));

vi.mock('./api', () => ({
  codingApi: {
    githubRepositories,
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
    credentialListeners.clear();
    resetSkillLibraryCache();
  });

  it('saves a picked repository and its required connection together, with the default branch', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    render(<ProjectSettingsModal open project={null} busy={false} connections={[{ engine: 'github', name: 'work', display_name: 'Work', status: 'connected' }]}
      onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /^(Clone a repository|Add repository)/ }));
    await user.click(await screen.findByRole('button', { name: 'acme/private Private Add' }));
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('private');
    // Creating shows no Connectors section, yet the picked account is still saved with the project.
    expect(screen.queryByRole('checkbox', { name: /Work/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^(Create project|Save changes)$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'private', resources: [expect.objectContaining({ source_url: 'https://github.com/acme/private.git', connector_name: 'work', use_connector_for_clone: true, provider: 'github', repository: 'acme/private', default_branch: 'develop' })],
      connections: [{ provider: 'github', name: 'work', label: 'Work' }],
    })));
  });

  it.each([undefined, false, true])('preserves saved clone authentication (%s) without inferring it from the connection', async (useConnector) => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    const savedProject = {
      ...project,
      resources: project.resources.map((resource) => ({ ...resource, connector_name: 'work', use_connector_for_clone: useConnector })),
      connections: [{ provider: 'github' as const, name: 'work', label: 'Work' }],
    };
    render(<ProjectSettingsModal open project={savedProject} busy={false}
      connections={[{ engine: 'github', name: 'work', display_name: 'Work', status: 'connected' }]}
      onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /^(Create project|Save changes)$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].resources[0].use_connector_for_clone).toBe(useConnector);
    expect(onSave.mock.calls[0][0].resources[0].connector_name).toBe('work');
  });

  it('does not bind a pasted public GitHub URL to a connected account', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    render(<ProjectSettingsModal open project={null} busy={false}
      connections={[{ engine: 'github', name: 'work', display_name: 'Work', status: 'connected' }]}
      onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /^(Clone a repository|Add repository)/ }));
    await user.click(screen.getByRole('button', { name: 'Paste repository URL' }));
    await user.type(screen.getByRole('textbox', { name: 'Git repository URL' }), 'https://github.com/acme/public.git{Enter}');
    await user.click(screen.getByRole('button', { name: /^(Create project|Save changes)$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].resources[0].use_connector_for_clone).toBeUndefined();
    expect(onSave.mock.calls[0][0].resources[0].connector_name).toBeUndefined();
  });

  it('keeps non-GitHub URL entry working and prevents URL-variant duplicates', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    render(<ProjectSettingsModal open project={project} busy={false} connections={[]} onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /^(Clone a repository|Add repository)/ }));
    await user.click(screen.getByRole('button', { name: 'Paste repository URL' }));
    const input = screen.getByRole('textbox', { name: 'Git repository URL' });
    await user.type(input, 'https://github.com/mindsdb/cowork/{Enter}');
    expect(screen.getByText('That repository is already in this project.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'https://gitlab.com/acme/api.git{Enter}');
    await user.click(screen.getByRole('button', { name: /^(Create project|Save changes)$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'MindsHub', resources: [project.resources[0], expect.objectContaining({ source_url: 'https://gitlab.com/acme/api.git' })], connections: [],
    })));
  });

  it('can restore a missing project connection used by an existing repository', async () => {
    const user = userEvent.setup();
    render(<ProjectSettingsModal open busy={false}
      project={{ ...project, resources: project.resources.map((resource) => ({ ...resource, connector_name: 'work' })) }}
      connections={[{ engine: 'github', name: 'work', display_name: 'Work', status: 'connected' }]}
      onClose={vi.fn()} onSave={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: /Work/ });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeEnabled();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute('aria-disabled', 'true');
  });

  it.each(['local', 'shared'])('refreshes an open project’s %s catalogue without resetting its draft', async (source) => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    function Editor() {
      const catalog = useCodingCatalog(source === 'shared');
      return <ProjectSettingsModal open project={project} connections={[]} busy={false}
        catalog={source === 'shared' ? catalog : undefined} onClose={vi.fn()} onSave={onSave} />;
    }
    render(<Editor />);
    await user.click(screen.getByRole('combobox', { name: 'Default coding model' }));
    expect(screen.getByRole('option', { name: /fable/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.clear(screen.getByRole('textbox', { name: 'Project name' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Keep my project draft');

    models.mockResolvedValueOnce({ items: ['gpt-5.6-sol', 'new-account-model'] });
    act(() => credentialListeners.forEach((listener) => listener()));
    await waitFor(() => expect(models).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('combobox', { name: 'Default coding model' }));
    expect(screen.getByRole('option', { name: /new-account-model/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /fable/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /new-account-model/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Keep my project draft', default_model: 'new-account-model', resources: project.resources,
    })));
  });

  it('asks only for a name and code while creating a project', () => {
    render(<ProjectSettingsModal open project={null} connections={[]} busy={false} onClose={vi.fn()} onSave={vi.fn()} onOpenConnectors={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'New code project' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Project name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Choose a folder/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Connectors' })).toBeNull();
    expect(screen.queryByText(/^(Skills|Task defaults|Environment)$/)).toBeNull();
  });

  it('offers Connectors in Project settings and keeps skills in their own group', async () => {
    const user = userEvent.setup();
    const onOpenConnectors = vi.fn();
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onOpenConnectors={onOpenConnectors}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Project settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Connectors' }));
    expect(onOpenConnectors).toHaveBeenCalledOnce();
    expect(await screen.findByText('1 available')).toBeInTheDocument();
    expect(screen.getByText('Choose skills')).toBeInTheDocument();
  });

  it('enables Create project once a folder names the project', async () => {
    const user = userEvent.setup();
    render(<ProjectSettingsModal open project={null} connections={[]} busy={false} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Choose a folder/ }));
    // The first folder names the project, so nothing is missing any more.
    expect(await screen.findByText('new-project')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('new-project');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Add repository' })).toBeNull();
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

  it('shows MindsHub-maintained skills as included in Project settings', async () => {
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
        project={project}
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

    await user.click(screen.getByText('2 skills added', { selector: 'strong' }));
    expect(screen.getByRole('checkbox', { name: /Thermo-Nuclear Code Quality Review/ })).toBeChecked();
  });

  it('assigns team skills to an existing project', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (values) => ({ ...project, ...values } as CodeProject));
    render(
      <ProjectSettingsModal
        open
        project={project}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(await screen.findByText('Choose skills'));
    await user.click(screen.getByRole('checkbox', { name: /Thermo-Nuclear Code Quality Review/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

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

    await user.click(screen.getByText('1 skill added', { selector: 'strong' }));
    await user.click(screen.getByRole('checkbox', { name: /Thermo-Nuclear Code Quality Review/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

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
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

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
    await user.click(screen.getByRole('button', { name: 'Manage connectors' }));
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

    await user.click(await screen.findByRole('combobox', { name: 'Default coding model' }));
    await user.click(screen.getByRole('option', { name: 'Claude Fable 5' }));
    await user.click(screen.getByRole('combobox', { name: 'Default coding permissions' }));
    await user.click(screen.getByRole('option', { name: 'Workspace auto' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

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
    const name = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(name);
    await user.type(name, 'Unsaved project name');

    rerender(<ProjectSettingsModal {...props} open={false} suspended />);
    rerender(<ProjectSettingsModal {...props} open suspended={false} />);

    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Unsaved project name');
  });

  it('keeps a cleared connection cleared when the project refreshes', async () => {
    const user = userEvent.setup();
    const saved = { ...project, connections: [{ provider: 'github' as const, name: 'work', label: 'Work' }] };
    const props = {
      open: true,
      connections: [{ engine: 'github', name: 'work', display_name: 'Work', status: 'connected' as const }],
      busy: false,
      onClose: vi.fn(),
      onSave: vi.fn(),
      onOpenConnectors: vi.fn(),
    };
    const { rerender } = render(<ProjectSettingsModal {...props} project={saved} />);
    const checkbox = screen.getByRole('checkbox', { name: /Work/ });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    rerender(<ProjectSettingsModal {...props} project={{ ...saved, connections: [...saved.connections] }} />);
    expect(screen.getByRole('checkbox', { name: /Work/ })).not.toBeChecked();
  });

  it('resolves the legacy default id to the live GPT 5.6 Sol catalog model', async () => {
    models.mockResolvedValueOnce({ items: ['gpt', 'gpt-codex'] });
    render(
      <ProjectSettingsModal
        open
        project={project}
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

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Default coding agent' })).toHaveTextContent('Codex'));
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
        revision: 0,
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

    expect(screen.getByRole('combobox', { name: 'Default coding model' })).toHaveTextContent('GPT 5.6 Sol');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

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
    await userEvent.setup().click(screen.getByRole('button', { name: 'Details' }));
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

    const effort = await screen.findByRole('combobox', { name: 'Default reasoning effort' });
    expect(effort).toHaveTextContent('Model default');
    await user.click(effort);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Model defaultMedium', 'None', 'Low', 'Medium', 'High', 'Xhigh', 'Max',
    ]);
    await user.click(screen.getByRole('option', { name: /^Low/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ default_reasoning_effort: 'low' })));
  });

  it('offers no reasoning default for a model that advertises no levels', async () => {
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

    expect(await screen.findByRole('combobox', { name: 'Default coding model' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Default reasoning effort' })).toBeNull();
  });
});
