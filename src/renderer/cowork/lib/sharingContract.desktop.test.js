import { describe, expect, it } from 'vitest';
import { desktopRestrictedAccessRequest } from './sharingContract';

describe('desktopRestrictedAccessRequest', () => {
  it('sends no organization by default', () => {
    expect(desktopRestrictedAccessRequest({ emails: ['a@x.com'], ownerOnly: false })).toEqual({
      mode: 'restricted', emails: ['a@x.com'], org_allowed: false, owner_only: false,
    });
  });
  it('sends the organization when asked', () => {
    expect(desktopRestrictedAccessRequest({ emails: [], ownerOnly: false, orgAllowed: true })).toEqual({
      mode: 'restricted', emails: [], org_allowed: true, owner_only: false,
    });
  });
});
