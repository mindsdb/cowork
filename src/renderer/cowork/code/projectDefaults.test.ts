import { describe, expect, it } from 'vitest';

import { countEnvironmentVariables, describeTaskDefaults, parseEnvironmentVariables, parsePortNames } from './projectDefaults';


describe('projectDefaults', () => {
  it('parses NAME=value lines and keeps the value verbatim after the first equals sign', () => {
    expect(parseEnvironmentVariables('API_URL=http://x/?a=b\n\n  NODE_ENV = dev ')).toEqual([
      ['API_URL', 'http://x/?a=b'],
      ['NODE_ENV', ' dev '],
    ]);
    expect(() => parseEnvironmentVariables('=nope')).toThrow('Environment line needs NAME=value');
  });

  it('counts variable lines without validating them, so a half-typed line cannot break the summary', () => {
    expect(countEnvironmentVariables('API_URL=x\nNODE_EN\n\n')).toBe(2);
    expect(countEnvironmentVariables('')).toBe(0);
  });

  it('counts a name typed twice once, matching what saving keeps', () => {
    expect(countEnvironmentVariables('API_URL=old\nAPI_URL=new\nNODE_ENV=development')).toBe(2);
    expect(countEnvironmentVariables(' API_URL =a\nAPI_URL=b')).toBe(1);
  });

  it('splits port names on commas and whitespace', () => {
    expect(parsePortNames('PORT, API_PORT  DB_PORT')).toEqual(['PORT', 'API_PORT', 'DB_PORT']);
    expect(parsePortNames('')).toEqual([]);
  });

  it('describes the defaults in one line and leaves out what is not set', () => {
    expect(describeTaskDefaults({ agent: 'Codex', model: 'GPT 5.6 Sol', permission: 'Ask first', variableCount: 0, portNames: [] }))
      .toBe('Codex · GPT 5.6 Sol · Ask first');
    expect(describeTaskDefaults({ agent: 'Codex', model: 'GPT 5.6 Sol', permission: 'Ask first', variableCount: 1, portNames: ['PORT'] }))
      .toBe('Codex · GPT 5.6 Sol · Ask first · 1 variable · PORT');
  });
});
