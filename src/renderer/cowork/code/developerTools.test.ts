import { describe, expect, it } from 'vitest';

import { parseDeveloperSourceUrl, safeCodeExternalUrl } from './developerTools';

describe('developer source URLs', () => {
  it('accepts canonical Linear issue URLs with a title slug', () => {
    expect(parseDeveloperSourceUrl('https://linear.app/mindsdb/issue/ENG-421/fix-login')).toEqual({
      provider: 'linear',
      kind: 'issue',
      url: 'https://linear.app/mindsdb/issue/ENG-421/fix-login',
    });
  });

  it('retains support for Linear issue URLs without a title slug', () => {
    expect(parseDeveloperSourceUrl('https://linear.app/mindsdb/issue/ENG-421')).toEqual({
      provider: 'linear',
      kind: 'issue',
      url: 'https://linear.app/mindsdb/issue/ENG-421',
    });
  });
});

describe('safeCodeExternalUrl', () => {
  it('normalizes browser links', () => {
    expect(safeCodeExternalUrl('https://github.com/mindsdb/cowork/pull/1')).toBe(
      'https://github.com/mindsdb/cowork/pull/1',
    );
    expect(safeCodeExternalUrl('http://127.0.0.1:4173/preview')).toBe(
      'http://127.0.0.1:4173/preview',
    );
  });

  it.each([
    'file:///Applications/Calculator.app',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'vscode://file/tmp/source',
    'not a URL',
  ])('rejects a non-browser OS handler: %s', (value) => {
    expect(safeCodeExternalUrl(value)).toBeNull();
  });
});
