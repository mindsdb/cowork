import { describe, expect, it } from 'vitest';

import type { DeliveryAutomationPolicy, DeliveryPlan } from './api';
import { nextDeliveryAutomationAction } from './deliveryAutomation';

const policy: DeliveryAutomationPolicy = {
  fix_failing_checks: false,
  mark_ready_when_passing: false,
  merge_when_approved: false,
  complete_source_after_merge: false,
  archive_after_merge: false,
  max_fix_attempts: 2,
};

const plan: DeliveryPlan = {
  integrations: [],
  items: [{
    folder_id: 'frontend', folder_name: 'Frontend', workspace_path: '/task/frontend',
    remote_url: 'https://github.com/mindsdb/frontend.git', base_branch: 'staging',
    task_branch: 'cowork/task/frontend', status: 'published', detail: '',
    external_url: 'https://github.com/mindsdb/frontend/pull/42', connection_name: 'work',
    pull_request_status: {
      state: 'merged', review_state: 'approved', ci_state: 'passing', number: 42,
      title: 'Improve delivery', checks: [], feedback: [], detail: '',
    },
  }],
};

describe('nextDeliveryAutomationAction', () => {
  it('completes linked work after final delivery and before archiving', () => {
    const source = {
      provider: 'linear' as const, kind: 'issue' as const, url: 'https://linear.app/mindsdb/issue/ENG-421',
      title: 'Checkout recovery', external_id: 'ENG-421', body: '',
    };
    const action = nextDeliveryAutomationAction({
      sessionId: 'task-1',
      plan,
      policy: { ...policy, complete_source_after_merge: true, archive_after_merge: true },
      sourceContexts: [source],
      deliveries: [{
        provider: 'linear', action: 'result', target_url: source.url, status: 'published', detail: '',
        created_at: '2026-08-25T09:00:00Z',
      }],
    });

    expect(action).toEqual({ kind: 'complete', key: `complete:linear:${source.url}`, context: source });
  });

  it('never completes work before a final update is published', () => {
    const action = nextDeliveryAutomationAction({
      sessionId: 'task-1',
      plan,
      policy: { ...policy, complete_source_after_merge: true, archive_after_merge: true },
      sourceContexts: [{
        provider: 'github', kind: 'issue', url: 'https://github.com/mindsdb/frontend/issues/41',
        title: 'Improve delivery', external_id: 'mindsdb/frontend#41', body: '',
      }],
      deliveries: [],
    });

    expect(action).toBeNull();
  });

  it('does not complete or archive while another repository still needs delivery', () => {
    const action = nextDeliveryAutomationAction({
      sessionId: 'task-1',
      plan: {
        ...plan,
        items: [
          ...plan.items,
          {
            folder_id: 'server', folder_name: 'Server', workspace_path: '/task/server',
            remote_url: 'https://github.com/mindsdb/server.git', base_branch: 'staging',
            task_branch: 'cowork/task/server', status: 'ready', detail: '',
          },
        ],
      },
      policy: { ...policy, archive_after_merge: true },
      sourceContexts: [],
      deliveries: [],
    });

    expect(action).toBeNull();
  });

  it('allows no-change repositories once every published pull request is merged', () => {
    const action = nextDeliveryAutomationAction({
      sessionId: 'task-1',
      plan: {
        ...plan,
        items: [
          ...plan.items,
          {
            folder_id: 'docs', folder_name: 'Docs', workspace_path: '/task/docs',
            status: 'no_changes', detail: '',
          },
        ],
      },
      policy: { ...policy, archive_after_merge: true },
      sourceContexts: [],
      deliveries: [],
    });

    expect(action).toEqual({ kind: 'archive', key: 'archive:task-1' });
  });
});
