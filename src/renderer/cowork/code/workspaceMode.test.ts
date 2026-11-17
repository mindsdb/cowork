import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceModeOptions } from './api';
import {
  WORKTREE_ONLY,
  effectiveWorkspaceMode,
  offersWorkspaceChoice,
  storeWorkspaceMode,
  storedWorkspaceMode,
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
