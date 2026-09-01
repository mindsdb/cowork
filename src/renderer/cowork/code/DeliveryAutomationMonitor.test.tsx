import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession, DeliveryPlan } from './api';

const mocks = vi.hoisted(() => ({
  deliveryPlan: vi.fn(),
  claimDeliveryAutomation: vi.fn(),
  turn: vi.fn(),
  pullRequestAction: vi.fn(),
  completeSource: vi.fn(),
  setArchived: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock('./api', () => ({ codingApi: mocks }));

import { DeliveryAutomationMonitor } from './DeliveryAutomationMonitor';

const policy = {
  fix_failing_checks: true,
  mark_ready_when_passing: false,
  merge_when_approved: false,
  complete_source_after_merge: false,
  archive_after_merge: false,
  max_fix_attempts: 2,
};

function session(id: string, status = 'completed'): CodingSession {
  return {
    id,
    status,
    project_id: 'project',
    archived: false,
    workspaces: [{ workspace_kind: 'git_worktree' }],
    source_contexts: [],
    deliveries: [],
    delivery_policy: policy,
  } as unknown as CodingSession;
}

function failingPlan(): DeliveryPlan {
  return {
    integrations: [],
    items: [{
      folder_id: 'frontend', folder_name: 'Frontend', workspace_path: '/task/frontend',
      remote_url: 'https://github.com/mindsdb/frontend.git', base_branch: 'staging',
      task_branch: 'cowork/task/frontend', status: 'published',
      external_url: 'https://github.com/mindsdb/frontend/pull/42', connection_name: 'work', detail: '',
      pull_request_status: {
        state: 'open', review_state: 'none', ci_state: 'failing', number: 42,
        title: 'Improve delivery', updated_at: '2026-08-25T09:00:00Z', feedback: [], detail: '',
        checks: [{ id: 'check-1', name: 'Tests', state: 'failing', url: '', detail: 'One test failed', annotations: [] }],
      },
    }],
  };
}

describe('DeliveryAutomationMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliveryPlan.mockResolvedValue(failingPlan());
    mocks.claimDeliveryAutomation.mockResolvedValue({ claimed: true, attempts: 1, limit: 2 });
    mocks.turn.mockResolvedValue({});
    mocks.sessions.mockResolvedValue({ items: [] });
  });

  it('continues opted-in delivery without requiring the review panel to be open', async () => {
    const onSessionsChange = vi.fn();
    render(
      <DeliveryAutomationMonitor
        sessions={[session('task-1')]}
        onSessionsChange={onSessionsChange}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(mocks.claimDeliveryAutomation).toHaveBeenCalledWith(
      'task-1',
      'https://github.com/mindsdb/frontend/pull/42:2026-08-25T09:00:00Z:check-1',
    ));
    expect(mocks.turn).toHaveBeenCalledWith('task-1', expect.stringContaining('One test failed'));
    await waitFor(() => expect(onSessionsChange).toHaveBeenCalledWith([]));
  });

  it('does not interrupt an agent that is already working', async () => {
    render(
      <DeliveryAutomationMonitor
        sessions={[session('task-1', 'running')]}
        onSessionsChange={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(mocks.deliveryPlan).not.toHaveBeenCalled();
  });

  it('forgets executed actions for tasks that leave the list', async () => {
    const props = { onSessionsChange: vi.fn(), onError: vi.fn() };
    const view = render(<DeliveryAutomationMonitor sessions={[session('task-1')]} {...props} />);
    await waitFor(() => expect(mocks.claimDeliveryAutomation).toHaveBeenCalledTimes(1));

    view.rerender(<DeliveryAutomationMonitor sessions={[]} {...props} />);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    view.rerender(<DeliveryAutomationMonitor sessions={[session('task-1')]} {...props} />);

    await waitFor(() => expect(mocks.claimDeliveryAutomation).toHaveBeenCalledTimes(2));
  });

  it('continues to monitor legacy single-workspace tasks', async () => {
    const legacy = session('task-legacy');
    delete legacy.workspaces;
    legacy.workspace_kind = 'git_worktree';

    render(
      <DeliveryAutomationMonitor
        sessions={[legacy]}
        onSessionsChange={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(mocks.deliveryPlan).toHaveBeenCalledWith('task-legacy'));
  });
});
