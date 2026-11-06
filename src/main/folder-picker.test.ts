import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { folderPickerDefaultPath } from './folder-picker';

describe('folderPickerDefaultPath', () => {
  it('opens at home before anything was picked in this run', () => {
    expect(folderPickerDefaultPath(null, '/Users/me')).toBe('/Users/me');
  });

  it('opens next to the folder picked last', () => {
    const picked = path.join('/Users/me', 'code', 'repo');
    expect(folderPickerDefaultPath(picked, '/Users/me')).toBe(path.join('/Users/me', 'code'));
  });
});
