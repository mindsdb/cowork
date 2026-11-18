import { describe, expect, it } from 'vitest';
import { isPermissionMode, PERMISSION_LABELS, permissionOptions } from './permissions';


describe('permissionOptions', () => {
  it('offers the three modes for new work, in order of how much the agent may do unasked', () => {
    expect(permissionOptions().map((option) => option.label)).toEqual([
      'Ask for approval',
      'Approve for me',
      'Full access',
    ]);
    expect(permissionOptions('supervised').map((option) => option.value)).toEqual(['supervised', 'workspace', 'full_access']);
  });

  it('keeps Read only in the picker of a project or task saved with it', () => {
    expect(permissionOptions('read_only').map((option) => option.value)).toEqual([
      'read_only',
      'supervised',
      'workspace',
      'full_access',
    ]);
  });

  it('says what each offered mode lets the agent do', () => {
    const titles = Object.fromEntries(permissionOptions().map((option) => [option.value, option.title]));
    expect(titles.supervised).toBe('Always ask before editing files outside the task or using the internet.');
    expect(titles.workspace).toBe('A reviewer approves routine requests and blocks risky ones.');
    expect(titles.full_access).toBe('Unrestricted access to the internet and every file on your computer.');
  });
});

describe('saved modes', () => {
  it('still names and accepts Read only, which the server keeps for saved work', () => {
    expect(PERMISSION_LABELS.read_only).toBe('Read only');
    expect(isPermissionMode('read_only')).toBe(true);
    expect(isPermissionMode('ask_first')).toBe(false);
  });
});
