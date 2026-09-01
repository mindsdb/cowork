import { describe, expect, it } from 'vitest';
import type { CodingSession, TaskCapabilities } from './api';
import { supportsTaskCapability } from './taskCapabilities';

const session = (values: Partial<CodingSession>): CodingSession => ({
  id: 'task',
  schema_version: 1,
  title: 'Task',
  engine_id: 'codex',
  engine_adapter_version: '1',
  model: 'gpt',
  permission_mode: 'workspace',
  status: 'ready',
  source_path: '/source',
  workspace_path: '/workspace',
  workspace_kind: 'local_copy',
  source_dirty: false,
  event_count: 0,
  created_at: '2026-08-31T00:00:00Z',
  updated_at: '2026-08-31T00:00:00Z',
  ...values,
});

it('keeps legacy local tasks usable', () => {
  expect(supportsTaskCapability(session({ computer_is_local: true }), 'files')).toBe(true);
});

it('fails closed for a legacy connected computer', () => {
  expect(supportsTaskCapability(session({ computer_is_local: false }), 'files')).toBe(false);
});

it('uses the connected runtime contract exactly when advertised', () => {
  const capabilities = Object.fromEntries(
    ['files', 'review', 'terminal', 'project_actions', 'slash_commands', 'task_controls', 'extensions', 'platform_settings', 'fork', 'open_workspace']
      .map((name) => [name, name === 'terminal']),
  ) as unknown as TaskCapabilities;
  const remote = session({ computer_is_local: false, task_capabilities: capabilities });

  expect(supportsTaskCapability(remote, 'terminal')).toBe(true);
  expect(supportsTaskCapability(remote, 'files')).toBe(false);
});
