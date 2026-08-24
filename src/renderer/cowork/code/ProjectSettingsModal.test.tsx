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

  it('keeps unsaved playbook edits when the selected project object refreshes', async () => {
    const user = userEvent.setup();
    const props = {
      open: true,
      connections: [],
      busy: false,
      onClose: vi.fn(),
      onSave: vi.fn(async (values) => ({ ...project, ...values } as CodeProject)),
    };
    const { rerender } = render(<ProjectSettingsModal {...props} project={project} />);
    const repository = screen.getByPlaceholderText('Repository URL or local Git folder');
    const branch = screen.getByPlaceholderText('Branch');

    await user.type(repository, '/work/team-playbook');
    await user.clear(branch);
    await user.type(branch, 'staging');
    rerender(
      <ProjectSettingsModal
        {...props}
        project={{ ...project, updated_at: '2026-08-23T10:00:00Z' }}
      />,
    );

    expect(repository).toHaveValue('/work/team-playbook');
    expect(branch).toHaveValue('staging');
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
    expect(await screen.findByRole('combobox', { name: 'Default coding model' })).toHaveTextContent('GPT 5.6 Sol');
  });
});
