import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { codingApi, type CodeComputer } from './api';
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
const computer = {
  id: 'local', name: 'This computer', is_local: true, status: 'online',
  capabilities: { agent_engines: ['codex'], supports_local_folders: true },
} as CodeComputer;

function App() {
  const [view, setView] = useState('task');
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  return <>
    <button onClick={() => setView('projects')}>Navigate to projects</button>
    <button onClick={() => setView('task')}>Navigate to new task</button>
    <button onClick={() => setView('connectors')}>Navigate to connectors</button>
    <CodeView sessions={[]} selectedId={null} newTask={view === 'task'} projectsOpen={view === 'projects'} connectorsOpen={view === 'connectors'}
      defaultEngineId="codex" defaultModel="gpt" models={[{ id: 'gpt', name: 'GPT' }]} modelMeta={{ modelEnabled: { gpt: true } }}
      connections={connections} onConnectionsChange={setConnections} onSessionsChange={() => {}} onSelectionChange={() => {}}
      onOpenConnectors={() => setView('connectors')} onOpenNewTask={() => setView('task')} />
  </>;
}

describe('New task connector detour', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(codingApi, 'sessions').mockResolvedValue({ items: [] });
    vi.spyOn(codingApi, 'projects').mockResolvedValue({ items: [] });
    vi.spyOn(codingApi, 'engines').mockResolvedValue([{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]);
    vi.spyOn(codingApi, 'models').mockResolvedValue({ items: ['gpt'] });
    vi.spyOn(codingApi, 'computers').mockResolvedValue({ items: [computer] });
    vi.spyOn(codingApi, 'inspect').mockImplementation(async (path) => ({ path, exists: true, is_directory: true, is_git: false, dirty: false }));
    vi.spyOn(codingApi, 'updateProject');
    vi.spyOn(codingApi, 'searchWorkItems').mockResolvedValue({ items: [], incomplete: false });
    mocks.fetchDatasources.mockResolvedValue({ connections: [account] });
    mocks.oauthConnect.mockResolvedValue({ ok: true, name: account.name });
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
