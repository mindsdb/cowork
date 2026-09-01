import { describe, expect, it } from 'vitest';
import { normalizeExternalBrowserUrl } from './external-url';

describe('normalizeExternalBrowserUrl', () => {
  it.each([
    ['https://github.com/mindsdb/cowork/pull/1', 'https://github.com/mindsdb/cowork/pull/1'],
    ['http://127.0.0.1:4173/preview', 'http://127.0.0.1:4173/preview'],
  ])('accepts browser URLs', (value, expected) => {
    expect(normalizeExternalBrowserUrl(value)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    'not a URL',
    'file:///tmp/source',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'vscode://file/tmp/source',
  ])('rejects a non-browser handler: %s', (value) => {
    expect(normalizeExternalBrowserUrl(value)).toBeNull();
  });
});
