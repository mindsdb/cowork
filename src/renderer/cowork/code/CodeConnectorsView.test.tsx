import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorConnection } from '../api';
import type { CodeProject } from './api';

const mocks = vi.hoisted(() => ({
  oauthConnect: vi.fn(),
  oauthCancel: vi.fn(),
  keychainRevoke: vi.fn(),
  fetchDatasources: vi.fn(),
  fetchConnector: vi.fn(),
  fetchSavedConnection: vi.fn(),
  deleteDatasource: vi.fn(),
  validateAndSaveConnector: vi.fn(),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    oauthConnect: mocks.oauthConnect,
    oauthCancel: mocks.oauthCancel,
    keychainRevoke: mocks.keychainRevoke,
  },
}));

vi.mock('../api', () => ({
  ANTON_VAULT_KEEP: 'ANTON_VAULT_KEEP',
  fetchDatasources: mocks.fetchDatasources,
  fetchConnector: mocks.fetchConnector,
  fetchSavedConnection: mocks.fetchSavedConnection,
  deleteDatasource: mocks.deleteDatasource,
  validateAndSaveConnector: mocks.validateAndSaveConnector,
}));

import { CodeConnectorsView } from './CodeConnectorsView';

const github: ConnectorConnection = {
  engine: 'github',
  name: 'github-ian',
  display_name: 'ian@mindsdb.com',
  status: 'connected',
};

const project: CodeProject = {
  schema_version: 2,
  id: 'mindshub',
  name: 'MindsHub',
  resources: [{
    kind: 'repository',
    id: 'cowork',
    name: 'cowork',
    local_path: '/work/cowork',
    computer_id: 'local',
    checkout_strategy: 'worktree',
    commands: [],
  }],
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
    mocks.oauthCancel.mockResolvedValue({ ok: true });
    mocks.keychainRevoke.mockResolvedValue({ ok: true });
    mocks.fetchDatasources.mockResolvedValue({ connections: [] });
    mocks.fetchConnector.mockImplementation(async (provider: 'github' | 'linear') => ({
      id: provider,
      logo_url: `logos/${provider}.svg`,
      form: {
        form_id: `${provider}-connector`,
        methods: provider === 'github'
          ? [{
              id: 'fine-grained-pat',
              label: 'Fine-grained personal access token',
              fields: [{ name: 'access_token', label: 'Personal access token', type: 'password', required: true }],
            }]
          : [{
              id: 'personal-api-key',
              label: 'Personal API key',
              fields: [{ name: 'api_key', label: 'API key', type: 'password', required: true }],
            }],
      },
    }));
    mocks.fetchSavedConnection.mockResolvedValue({ method: 'personal-api-key', fields: {} });
    mocks.deleteDatasource.mockResolvedValue(undefined);
    mocks.validateAndSaveConnector.mockResolvedValue({ ok: true, name: 'github-ian' });
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

  it('lets the user cancel a browser authorization that is still waiting', async () => {
    const user = userEvent.setup();
    let finishAuthorization: (value: { ok: boolean }) => void = () => {};
    mocks.oauthConnect.mockImplementation(() => new Promise((resolve) => { finishAuthorization = resolve; }));
    render(<CodeConnectorsView connections={[]} projects={[]} onConnectionsChange={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    expect(await screen.findByText('Continue in your browser')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.oauthCancel).toHaveBeenCalledOnce();
    expect(screen.queryByText('Continue in your browser')).not.toBeInTheDocument();
    finishAuthorization({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.fetchDatasources).not.toHaveBeenCalled();
  });

  it('falls back to verified personal-token setup when hosted OAuth is unavailable', async () => {
    const user = userEvent.setup();
    const onConnectionsChange = vi.fn();
    mocks.oauthConnect.mockResolvedValue({
      ok: false,
      code: 'oauth_credentials_missing',
      reason: "OAuth credentials not configured for 'github'.",
    });
    mocks.fetchDatasources.mockResolvedValue({ connections: [github] });
    render(<CodeConnectorsView connections={[]} projects={[]} onConnectionsChange={onConnectionsChange} />);

    await user.click(screen.getAllByRole('button', { name: 'Connect' })[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Connect GitHub' });
    expect(within(dialog).queryByText(/OAuth credentials not configured/i)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Label'), 'Work GitHub');
    await user.type(within(dialog).getByLabelText('Personal access token'), 'github_pat_secret');
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(mocks.validateAndSaveConnector).toHaveBeenCalledWith('github', {
      method: 'fine-grained-pat',
      name: '',
      replace_existing: false,
      values: { access_token: 'github_pat_secret', user_label: 'Work GitHub' },
    }));
    expect(onConnectionsChange).toHaveBeenCalledWith([github]);
    expect(screen.queryByRole('dialog', { name: 'Connect GitHub' })).not.toBeInTheDocument();
  });

  it('supports an older desktop shell that only returns the missing-credentials reason', async () => {
    const user = userEvent.setup();
    mocks.oauthConnect.mockResolvedValue({
      ok: false,
      reason: "OAuth credentials not configured for 'linear'.",
    });
    render(<CodeConnectorsView connections={[]} projects={[]} onConnectionsChange={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: 'Connect' })[1]);

    expect(await screen.findByRole('dialog', { name: 'Connect Linear' })).toBeInTheDocument();
  });

  it('keeps personal-token setup open when provider validation fails', async () => {
    const user = userEvent.setup();
    mocks.oauthConnect.mockResolvedValue({ ok: false, code: 'oauth_credentials_missing' });
    mocks.validateAndSaveConnector.mockRejectedValue(new Error('GitHub rejected this token.'));
    render(<CodeConnectorsView connections={[]} projects={[]} onConnectionsChange={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Connect GitHub' });
    await user.type(within(dialog).getByLabelText('Personal access token'), 'bad-token');
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));

    expect(await within(dialog).findByText('GitHub rejected this token.')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it('does not retain or resubmit a saved secret when refreshing the account list fails', async () => {
    const user = userEvent.setup();
    mocks.oauthConnect.mockResolvedValue({ ok: false, code: 'oauth_credentials_missing' });
    mocks.fetchDatasources.mockRejectedValue(new Error('Account list unavailable.'));
    render(<CodeConnectorsView connections={[]} projects={[]} onConnectionsChange={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Connect GitHub' });
    await user.type(within(dialog).getByLabelText('Personal access token'), 'github_pat_secret');
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/Connected, but could not finish updating Code/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Connect GitHub' })).not.toBeInTheDocument();
    expect(mocks.validateAndSaveConnector).toHaveBeenCalledOnce();
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
