import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceModeOptions } from './api';
import {
  WORKTREE_ONLY,
  effectiveWorkspaceMode,
  offersWorkspaceChoice,
  storeWorkspaceMode,
  storedWorkspaceMode,
  workspaceReasonText,
  worktreeUnavailableText,
} from './workspaceMode';

const BOTH: WorkspaceModeOptions = { supported: ['worktree', 'in_place'], default: 'worktree' };

describe('workspace mode choice', () => {
  afterEach(() => window.localStorage.clear());

  it('is offered only when the server accepts more than one mode', () => {
    expect(offersWorkspaceChoice(BOTH)).toBe(true);
    expect(offersWorkspaceChoice(WORKTREE_ONLY)).toBe(false);
  });

  it('keeps the remembered choice when the task can use it', () => {
    expect(effectiveWorkspaceMode(BOTH, { remembered: 'in_place' })).toBe('in_place');
  });

  it('falls back to the server default when the remembered choice is not available here', () => {
    expect(effectiveWorkspaceMode(WORKTREE_ONLY, { remembered: 'in_place' })).toBe('worktree');
    expect(effectiveWorkspaceMode({ supported: ['worktree', 'in_place'], default: 'in_place' }, {})).toBe('in_place');
  });

  it('prefers this task’s choice, then the project default, then the remembered choice, then the server', () => {
    expect(effectiveWorkspaceMode(BOTH, { explicit: 'worktree', projectDefault: 'in_place', remembered: 'in_place' })).toBe('worktree');
    expect(effectiveWorkspaceMode(BOTH, { projectDefault: 'in_place', remembered: 'worktree' })).toBe('in_place');
    expect(effectiveWorkspaceMode(BOTH, { projectDefault: 'worktree', remembered: 'in_place' })).toBe('worktree');
    expect(effectiveWorkspaceMode(BOTH, { remembered: 'in_place' })).toBe('in_place');
    expect(effectiveWorkspaceMode(BOTH, {})).toBe('worktree');
  });

  it('lets an unusable project default fall to the server default, not the remembered choice', () => {
    const remoteOnly: WorkspaceModeOptions = { supported: ['worktree'], default: 'worktree' };
    expect(effectiveWorkspaceMode(remoteOnly, { projectDefault: 'in_place', remembered: 'in_place' })).toBe('worktree');
    expect(effectiveWorkspaceMode(remoteOnly, { explicit: 'in_place' })).toBe('worktree');
  });

  it('remembers the last choice and ignores anything it does not recognise', () => {
    expect(storedWorkspaceMode()).toBeNull();
    storeWorkspaceMode('in_place');
    expect(storedWorkspaceMode()).toBe('in_place');
    window.localStorage.setItem('mindshub-code:workspace-mode', 'container');
    expect(storedWorkspaceMode()).toBeNull();
  });
});

describe('workspace mode reasons', () => {
  it('words a known reason in the UI language, naming the folder when there is one', () => {
    expect(workspaceReasonText('not_a_repository', null, 'server text'))
      .toBe('This folder isn’t a Git repository. Initialize Git to use a Worktree.');
    expect(workspaceReasonText('no_commits', 'Notes', 'server text'))
      .toBe('Notes has no commits yet. Make a first commit to use a Worktree.');
    expect(worktreeUnavailableText({
      supported: ['in_place'], default: 'in_place',
      worktree_unavailable_reason: 'Notes: This folder isn\'t a Git repository',
      worktree_unavailable_code: 'not_a_repository', worktree_unavailable_folder: 'Notes',
    })).toBe('Notes isn’t a Git repository. Initialize Git to use a Worktree.');
  });

  it('shows the server text for a code it does not know, or none', () => {
    expect(workspaceReasonText('needs_a_newer_app', null, 'From a newer server')).toBe('From a newer server');
    expect(workspaceReasonText(null, null, 'From an older server')).toBe('From an older server');
    // A message that needs a folder the server did not send falls back too.
    expect(workspaceReasonText('no_local_checkout', null, 'lib has no checkout')).toBe('lib has no checkout');
    expect(worktreeUnavailableText(BOTH)).toBe('');
  });
});
