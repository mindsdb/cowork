import { describe, it, expect } from 'vitest';
import { isAccessDraftValid, buildAccessPayload, ACCESS_LABELS } from './AccessChooser';

const restricted = (emailsText, orgAllowed = false) => ({
  mode: 'restricted', password: '', emailsText, orgAllowed,
});

describe('isAccessDraftValid — restricted', () => {
  it('accepts an empty selection (owner-only)', () => {
    expect(isAccessDraftValid(restricted(''))).toBe(true);
  });

  it('accepts valid addresses', () => {
    expect(isAccessDraftValid(restricted('a@x.com, b@x.com'))).toBe(true);
  });

  it('rejects an invalid-only input', () => {
    expect(isAccessDraftValid(restricted('colleague@corp'))).toBe(false);
  });

  it('rejects mixed valid + invalid input', () => {
    expect(isAccessDraftValid(restricted('a@x.com, colleague@corp'))).toBe(false);
  });

  it('accepts org-only with an empty list', () => {
    expect(isAccessDraftValid(restricted('', true))).toBe(true);
  });
});

describe('buildAccessPayload — restricted', () => {
  it('marks an empty selection as owner_only', () => {
    expect(buildAccessPayload(restricted(''))).toEqual({
      mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
    });
  });

  it('does not set owner_only when addresses are listed', () => {
    expect(buildAccessPayload(restricted('a@x.com'))).toEqual({
      mode: 'restricted', emails: ['a@x.com'], org_allowed: false, owner_only: false,
    });
  });

  it('does not set owner_only when the org is allowed', () => {
    expect(buildAccessPayload(restricted('', true))).toEqual({
      mode: 'restricted', emails: [], org_allowed: true, owner_only: false,
    });
  });
});

describe('ACCESS_LABELS', () => {
  it('is exported for reuse by PublishMenu', () => {
    expect(ACCESS_LABELS.restricted.title).toBe('For you and selected users');
    expect(ACCESS_LABELS.restricted.desc).toBe('Only you and people you list — or your whole org');
    expect(typeof ACCESS_LABELS.public.icon).toBe('function');
  });
});
