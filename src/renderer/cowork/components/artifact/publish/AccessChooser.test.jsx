import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  isOwnerOnlySelection,
  buildAccessPayload,
  ACCESS_LABELS,
} from './AccessChooser';

const restricted = (emailsText, orgAllowed = false) => ({
  mode: 'restricted', password: '', emailsText, orgAllowed,
});

describe('isAccessDraftValid — restricted', () => {
  it('rejects an empty selection', () => {
    // "Only me" is its own option now, so an empty "Specific people" is an
    // unfinished choice rather than a silent private publish.
    expect(isAccessDraftValid(restricted(''))).toBe(false);
  });

  it('accepts an empty list once the org is included', () => {
    expect(isAccessDraftValid({ ...restricted(''), orgAllowed: true })).toBe(true);
  });

  it('accepts the owner-only mode on its own', () => {
    expect(isAccessDraftValid({ mode: 'ownerOnly' })).toBe(true);
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
    expect(ACCESS_LABELS.restricted.title).toBe('Specific people');
    expect(ACCESS_LABELS.restricted.desc).toBe('Only the people you list — or your whole org');
    expect(ACCESS_LABELS.ownerOnly.title).toBe('Only you');
    expect(typeof ACCESS_LABELS.public.icon).toBe('function');
  });
});

// "Only me" and "share with a list" were one radio, told apart only by whether
// the textarea underneath happened to be empty — so the choice a person had
// made was invisible in the choice they had selected. They are two options now,
// which means a UI mode that has to survive the round trip to the wire's three.

describe('owner-only as its own selection', () => {
  it('collapses to the wire shape, carrying the flag that keeps it private', () => {
    // Without `owner_only`, restricted-with-nothing-selected reads as an empty
    // selection and degrades to public — the exact opposite of the choice.
    expect(buildAccessPayload({ mode: 'ownerOnly' })).toEqual({
      mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
    });
  });

  it('drops a stale recipient list when the user switches to Only you', () => {
    expect(buildAccessPayload({ mode: 'ownerOnly', emailsText: 'alice@x.com', orgAllowed: true }))
      .toEqual({ mode: 'restricted', emails: [], org_allowed: false, owner_only: true });
  });

  it('reads an owner-only artifact back as the owner-only mode', () => {
    expect(accessDraftFromArtifact({
      accessMode: 'restricted', accessEmails: [], orgAllowed: false, ownerOnly: true,
    }).mode).toBe('ownerOnly');
  });

  it('reads a shared artifact back as Specific people', () => {
    const draft = accessDraftFromArtifact({
      accessMode: 'restricted', accessEmails: ['a@x.com'], orgAllowed: false, ownerOnly: false,
    });
    expect(draft.mode).toBe('restricted');
    expect(draft.emailsText).toBe('a@x.com');
  });

  it('falls back to deriving owner-only for a record written before the flag', () => {
    expect(isOwnerOnlySelection({ accessEmails: [], orgAllowed: false })).toBe(true);
    expect(isOwnerOnlySelection({ accessEmails: ['a@x.com'], orgAllowed: false })).toBe(false);
    expect(isOwnerOnlySelection({ accessEmails: [], orgAllowed: true })).toBe(false);
  });

  it('prefers the server flag over the derivation when both are present', () => {
    expect(isOwnerOnlySelection({ ownerOnly: false, accessEmails: [], orgAllowed: false }))
      .toBe(false);
  });

  it('offers Only you and Specific people as separate choices, private first', () => {
    const { container } = render(
      <AccessChooser value={{ mode: 'ownerOnly', emailsText: '', orgAllowed: false }} onChange={() => {}} />,
    );
    expect(screen.getByText('Only you')).toBeInTheDocument();
    expect(screen.getByText('Specific people')).toBeInTheDocument();
    const order = [...container.querySelectorAll('span')]
      .map((n) => n.textContent)
      .filter((t) => ['Only you', 'Specific people', 'Password protected', 'Public'].includes(t));
    expect(order).toEqual(['Only you', 'Specific people', 'Password protected', 'Public']);
  });

  it('does not show the recipient textarea for Only you', () => {
    render(
      <AccessChooser value={{ mode: 'ownerOnly', emailsText: '', orgAllowed: false }} onChange={() => {}} />,
    );
    expect(screen.queryByPlaceholderText('alice@acme.com, bob@acme.com')).toBeNull();
  });
});
