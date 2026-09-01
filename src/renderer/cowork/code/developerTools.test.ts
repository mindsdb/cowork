import { describe, expect, it } from 'vitest';

import { parseDeveloperSourceUrl } from './developerTools';


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
