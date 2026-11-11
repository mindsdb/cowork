import { describe, expect, it } from 'vitest';
import { trustedAuthImageUrl } from './brand-image-url';

describe('trustedAuthImageUrl', () => {
  const host = 'auth.acme.com';
  it('keeps https on the auth host only', () => {
    expect(trustedAuthImageUrl(`https://${host}/v1/organizations/o/branding/icon`, host)).toBe(`https://${host}/v1/organizations/o/branding/icon`);
    for (const bad of [`http://${host}/i.png`, 'https://images.globex.com/i.png', `https://${host}.globex.com/i.png`, `https://u:p@${host}/i.png`, 'data:image/png;base64,AA==', 7]) {
      expect(trustedAuthImageUrl(bad, host)).toBeNull();
    }
    expect(trustedAuthImageUrl(`https://${host}/i.png`, null)).toBeNull();
  });
});
