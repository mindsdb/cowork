import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorConnection } from '../api';
import type { CodeProject } from './api';

const mocks = vi.hoisted(() => ({
  oauthConnect: vi.fn(),
  keychainRevoke: vi.fn(),
  fetchDatasources: vi.fn(),
  fetchSavedConnection: vi.fn(),
  deleteDatasource: vi.fn(),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    oauthConnect: mocks.oauthConnect,
    keychainRevoke: mocks.keychainRevoke,
  },
}));

vi.mock('../api', () => ({
  fetchDatasources: mocks.fetchDatasources,
  fetchSavedConnection: mocks.fetchSavedConnection,
  deleteDatasource: mocks.deleteDatasource,
}));

import { CodeConnectorsView } from './CodeConnectorsView';

const github: ConnectorConnection = {
  engine: 'github',
  name: 'github-ian',
  display_name: 'ian@mindsdb.com',
  status: 'connected',
};

const project: CodeProject = {
  schema_version: 1,
  id: 'mindshub',
  name: 'MindsHub',
  folders: [{ id: 'cowork', name: 'cowork', path: '/work/cowork', commands: [] }],
  connections: [{ provider: 'github', name: github.name, label: 'Ian GitHub' }],
  environment: { variables: {}, port_names: ['PORT'] },
  default_engine_id: 'codex',
  default_model: 'gpt-5.6-sol',
  permission_mode: 'workspace',
  created_at: '2026-08-23T09:00:00Z',
  updated_at: '2026-08-24T09:00:00Z',
};

describe('CodeConnectorsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.oauthConnect.mockResolvedValue({ ok: true });
    mocks.keychainRevoke.mockResolvedValue({ ok: true });
    mocks.fetchDatasources.mockResolvedValue({ connections: [] });
    mocks.fetchSavedConnection.mockResolvedValue({ method: 'personal-api-key', fields: {} });
    mocks.deleteDatasource.mockResolvedValue(undefined);
  });

  it('shows only the developer connectors and the projects using each account', () => {
    render(
      <CodeConnectorsView
        connections={[github, { engine: 'slack', name: 'ignored' }]}
        projects={[project]}
        onConnectionsChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linear' })).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
    expect(screen.getByText('ian@mindsdb.com')).toBeInTheDocument();
    expect(screen.getByText('Used by 1 project')).toBeInTheDocument();
  });

  it('connects a provider through the desktop OAuth flow and refreshes shared account state', async () => {
    const user = userEvent.setup();
    const onConnectionsChange = vi.fn();
    const linear: ConnectorConnection = { engine: 'linear', name: 'linear-ian', display_name: 'MindsDB' };
    mocks.fetchDatasources.mockResolvedValue({ connections: [linear] });
    render(<CodeConnectorsView connections={[]} projects={[]} onConnectionsChange={onConnectionsChange} />);

    const connectButtons = screen.getAllByRole('button', { name: 'Connect' });
    await user.click(connectButtons[1]);

    await waitFor(() => expect(mocks.oauthConnect).toHaveBeenCalledWith({ engine: 'linear', name: '' }));
    expect(onConnectionsChange).toHaveBeenCalledWith([linear]);
  });

  it('disconnects a saved account through the shared vault path', async () => {
    const user = userEvent.setup();
    const onConnectionsChange = vi.fn();
    render(<CodeConnectorsView connections={[github]} projects={[]} onConnectionsChange={onConnectionsChange} />);

    await user.click(screen.getByRole('button', { name: 'Disconnect ian@mindsdb.com' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(mocks.deleteDatasource).toHaveBeenCalledWith('github', 'github-ian'));
    expect(onConnectionsChange).toHaveBeenCalledWith([]);
  });
});
