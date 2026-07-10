import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { writeUvOverrides } from './uv-paths';

describe('writeUvOverrides', () => {
  it('returns {} for no overrides (nothing to force)', () => {
    expect(writeUvOverrides([])).toEqual({});
  });

  it('writes the requirement lines to a file and points UV_OVERRIDE at it', () => {
    const overrides = [
      'anton-agent @ git+https://github.com/mindsdb/anton.git@feat/x',
      'other-pkg @ /local/other',
    ];
    const env = writeUvOverrides(overrides);

    expect(env.UV_OVERRIDE).toBeTruthy();
    const contents = fs.readFileSync(env.UV_OVERRIDE as string, 'utf8');
    expect(contents).toBe(overrides.join('\n') + '\n');
  });
});
