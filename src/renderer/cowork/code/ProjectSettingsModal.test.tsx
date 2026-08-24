import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { engines, models } = vi.hoisted(() => ({
  engines: vi.fn(async () => [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]),
  models: vi.fn(async () => ({ items: ['gpt-5.6-sol', 'fable'] })),
}));

vi.mock('../../platform/host', () => ({
  host: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    pickCodeFolder: vi.fn(),
  },
}));

vi.mock('./api', () => ({
  codingApi: {
    engines,
    models,
    playbook: vi.fn(),
  },
}));

import type { CodeProject } from './api';
import { ProjectSettingsModal } from './ProjectSettingsModal';

const project: CodeProject = {
  schema_version: 1,
  id: 'project-1',
  name: 'MindsHub',
  folders: [{ id: 'cowork', name: 'cowork', path: '/work/cowork', base_branch: 'staging', commands: [] }],
  connections: [],
  environment: { variables: {}, port_names: ['PORT'] },
  default_engine_id: 'codex',
  default_model: 'gpt-5.6-sol',
  permission_mode: 'supervised',
  created_at: '2026-08-23T09:00:00Z',
  updated_at: '2026-08-23T09:00:00Z',
};

describe('ProjectSettingsModal', () => {
  it('keeps account management out of an unsaved project draft', () => {
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
    expect(screen.getByText('Save this project, then choose skills from the organisation library.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Connectors' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage skills' })).not.toBeInTheDocument();
  });

  it('summarises project skill selection and opens the shared Skills Library', async () => {
    const user = userEvent.setup();
    const onOpenSkills = vi.fn();
    render(
      <ProjectSettingsModal
        open
        project={{
          ...project,
          skill_sources: [
            { source_id: 'engineering', enabled_paths: ['review/SKILL.md', 'AGENTS.md'] },
          ],
        }}
        connections={[]}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onOpenSkills={onOpenSkills}
      />,
    );

    expect(screen.getByText('2 team items enabled')).toBeInTheDocument();
    expect(screen.getByText('1 shared source')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage skills' }));
    expect(onOpenSkills).toHaveBeenCalledOnce();
  });

  it('uses the first-class developer tools section and routes account management to Connectors', async () => {
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

    expect(screen.getByText('Developer tools')).toBeInTheDocument();
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
});
