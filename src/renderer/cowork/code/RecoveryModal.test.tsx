import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CodeComputer, RecoveryPlan } from './api';
import { RecoveryModal } from './RecoveryModal';


const capabilities = {
  platform: 'darwin' as const,
  architecture: 'arm64',
  runtime_version: '1',
  protocol_versions: ['1.0'],
  agent_engines: ['codex'],
  shells: ['bash'],
  has_git: true,
  has_terminal: true,
  supports_local_folders: true,
  max_concurrent_runs: 4,
};

function computer(id: string, name: string, platform: 'darwin' | 'linux' = 'darwin'): CodeComputer {
  return {
    schema_version: 1,
    id,
    name,
    status: 'online',
    active_run_count: 0,
    last_seen_at: '2026-08-30T10:00:00Z',
    capabilities: { ...capabilities, platform },
  };
}

const plan: RecoveryPlan = {
  run_id: 'run-1',
  options: [
    {
      computer: computer('original', 'Ian’s MacBook'),
      mode: 'restore',
      preserves_workspace_changes: true,
      recommended: true,
      detail: 'Resume the preserved workspace and its current changes.',
    },
    {
      computer: computer('remote', 'Linux build computer', 'linux'),
      mode: 'recreate',
      preserves_workspace_changes: false,
      recommended: false,
      detail: 'Create a fresh isolated workspace from the task’s saved repository definitions.',
    },
  ],
};


describe('RecoveryModal', () => {
  it('makes cross-computer workspace loss explicit before continuing', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <RecoveryModal
        plan={plan}
        selectedComputerId="original"
        busy={false}
        error=""
        onSelect={onSelect}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/Resume workspace/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Linux build computer/ }));
    expect(onSelect).toHaveBeenCalledWith('remote');

    rerender(
      <RecoveryModal
        plan={plan}
        selectedComputerId="remote"
        busy={false}
        error=""
        onSelect={onSelect}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/Unpushed changes on the previous computer cannot move/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start fresh workspace' }));
    expect(onConfirm).toHaveBeenCalledWith(plan.options[1]);
  });
});
