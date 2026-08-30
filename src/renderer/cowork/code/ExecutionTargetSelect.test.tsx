import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ExecutionTargetSelect } from './ExecutionTargetSelect';
import type { CodeComputer } from './api';


const capability = {
  architecture: 'arm64', runtime_version: '1', protocol_versions: ['1.0'], agent_engines: ['codex'],
  shells: ['bash'], has_git: true, has_terminal: true, supports_local_folders: true, max_concurrent_runs: 4,
};

const computers: CodeComputer[] = [
  { schema_version: 1, id: 'local', name: 'Ian’s Mac', is_local: true, status: 'online', active_run_count: 0, last_seen_at: new Date().toISOString(), capabilities: { ...capability, platform: 'darwin' } },
  { schema_version: 1, id: 'remote', name: 'Build computer', is_local: false, status: 'online', active_run_count: 1, last_seen_at: new Date().toISOString(), capabilities: { ...capability, platform: 'linux' } },
];

describe('ExecutionTargetSelect', () => {
  it('shows local, connected, and future cloud targets', async () => {
    const user = userEvent.setup();
    render(<ExecutionTargetSelect computers={computers} computerId="local" onComputerChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Run task on' })).toHaveTextContent('This computer');

    await user.click(screen.getByRole('combobox', { name: 'Run task on' }));
    expect(screen.getByRole('option', { name: /Build computer/ })).toHaveTextContent('Linux · 1 active task');
    expect(screen.getByRole('option', { name: /MindsHub Cloud/ })).toHaveTextContent('Coming soon');
    expect(screen.getByRole('option', { name: /MindsHub Cloud/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps connected computers visible but unavailable for a local folder', async () => {
    const user = userEvent.setup();
    render(<ExecutionTargetSelect computers={computers} computerId="local" onComputerChange={vi.fn()} localOnly />);
    await user.click(screen.getByRole('combobox', { name: 'Run task on' }));
    const remote = screen.getByRole('option', { name: /Build computer/ });
    expect(remote).toHaveAttribute('aria-disabled', 'true');
    expect(remote).toHaveTextContent('Local folder');
  });

  it('does not mislabel an offline computer as blocked by local resources', async () => {
    const user = userEvent.setup();
    const offlineComputers = computers.map((computer) => computer.id === 'remote'
      ? { ...computer, status: 'offline' as const }
      : computer);
    render(
      <ExecutionTargetSelect
        computers={offlineComputers}
        computerId="local"
        onComputerChange={vi.fn()}
        availableComputerIds={['local']}
        unavailableReason="Local resources"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Run task on' }));
    const remote = screen.getByRole('option', { name: /Build computer/ });
    expect(remote).toHaveTextContent('Offline');
    expect(remote).not.toHaveTextContent('Local resources');
  });
});
