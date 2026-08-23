import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';
import { ReviewPanel } from './ReviewPanel';


const directSession: CodingSession = {
  schema_version: 1,
  id: 'direct-task',
  title: 'Update a plain folder',
  engine_id: 'codex',
  engine_adapter_version: '1',
  model: 'fable',
  permission_mode: 'supervised',
  status: 'completed',
  source_path: 'C:\\work\\plain-folder',
  workspace_path: 'C:\\work\\plain-folder',
  workspace_kind: 'direct_folder',
  source_dirty: false,
  event_count: 0,
  created_at: '2026-08-21T09:00:00Z',
  updated_at: '2026-08-21T09:05:00Z',
};


describe('ReviewPanel', () => {
  it('does not claim a direct folder is unchanged when no Git baseline exists', () => {
    render(
      <ReviewPanel
        open
        session={directSession}
        git={null}
        files={[]}
        busy={false}
        error=""
        onClose={vi.fn()}
        onBranch={vi.fn(async () => {})}
        onCommit={vi.fn(async () => {})}
        onApply={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('Change tracking unavailable')).toBeInTheDocument();
    expect(screen.getByText('Open the folder to review changes')).toBeInTheDocument();
    expect(screen.queryByText('Working tree unchanged')).toBeNull();
  });
});
