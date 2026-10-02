import { describe, expect, it } from 'vitest';

import { parseEnvironmentVariables, parsePortNames } from './projectDefaults';

describe('projectDefaults', () => {
  it('parses NAME=value lines and keeps the value verbatim after the first equals sign', () => {
    expect(parseEnvironmentVariables('API_URL=http://x/?a=b\n\n  NODE_ENV = dev ')).toEqual([
      ['API_URL', 'http://x/?a=b'],
      ['NODE_ENV', ' dev '],
    ]);
    expect(() => parseEnvironmentVariables('=nope')).toThrow('Environment line needs NAME=value');
  });

  it('splits port names on commas and whitespace', () => {
    expect(parsePortNames('PORT, API_PORT  DB_PORT')).toEqual(['PORT', 'API_PORT', 'DB_PORT']);
    expect(parsePortNames('')).toEqual([]);
  });
});
