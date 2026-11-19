import { describe, expect, it } from 'vitest';

import { releaseNotice } from './composerNotices';

describe('releaseNotice', () => {
  const base = { archived: false, workspace_released_at: null, workspace_kept_reason: null, workspace_restore_error: null };

  it('says nothing for a task with its workspace, or for an older server', () => {
    expect(releaseNotice(base)).toBeNull();
    expect(releaseNotice({ archived: true })).toBeNull();
  });

  it('explains a put-away workspace comes back with its changes', () => {
    const notice = releaseNotice({ ...base, archived: true, workspace_released_at: '2026-10-15T00:00:00Z' });
    expect(notice?.body).toContain('rebuilt with all its changes');
    expect(notice?.tone).toBe('warning');
  });

  it('puts a failed rebuild first and says the work is still saved', () => {
    const notice = releaseNotice({
      ...base,
      workspace_released_at: '2026-10-15T00:00:00Z',
      workspace_restore_error: 'The task’s branch fix is checked out in another folder. Switch that folder to another branch to reopen this task',
    });
    expect(notice?.tone).toBe('danger');
    expect(notice?.title).toBe('Could not reopen this task’s workspace');
    expect(notice?.body).toContain('checked out in another folder');
    expect(notice?.body).toContain('still saved');
    expect(notice?.dismissible).toBe(false);
  });

  it('says why an archived task kept its workspace', () => {
    const notice = releaseNotice({
      ...base,
      archived: true,
      workspace_kept_reason: 'Kept the workspace because ignored files would be lost (.env)',
    });
    expect(notice?.body).toBe('Kept the workspace because ignored files would be lost (.env), so it still uses disk.');
    expect(releaseNotice({ ...base, workspace_kept_reason: 'Kept the workspace because x' })).toBeNull();
  });
});
