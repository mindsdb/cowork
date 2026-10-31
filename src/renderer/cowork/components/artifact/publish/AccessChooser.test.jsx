import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  buildAccessPayload,
  addedIndividuals,
  ACCESS_LABELS,
  newAccessDraft,
} from './AccessChooser';

// A "Specific people" draft.
const restricted = (emailsText, orgAllowed = false) => ({
  mode: 'specific', password: '', emailsText, orgAllowed,
});

describe('isAccessDraftValid — restricted', () => {
  it('rejects an empty selection', () => {
    // "Only me" is its own option now, so an empty "Specific people" is an
    // unfinished choice rather than a silent private publish.
    expect(isAccessDraftValid(restricted(''))).toBe(false);
  });

  it('accepts Everyone at the org on its own', () => {
    expect(isAccessDraftValid({ mode: 'org' })).toBe(true);
  });

  it('accepts the owner-only mode on its own', () => {
    expect(isAccessDraftValid({ mode: 'private' })).toBe(true);
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

  it('counts teams and people only with sharing in MindsHub mode', () => {
    const draft = { ...restricted(''), teamIds: ['t1'], userIds: [] };
    expect(isAccessDraftValid(draft)).toBe(false);
    expect(isAccessDraftValid(draft, { orgSharing: true })).toBe(true);
    expect(isAccessDraftValid({ ...restricted(''), teamIds: [], userIds: ['u1'] }, { orgSharing: true })).toBe(true);
    expect(isAccessDraftValid({ ...restricted(''), teamIds: [], userIds: [] }, { orgSharing: true })).toBe(false);
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

  it('sends Everyone at the org as org_allowed and nothing else', () => {
    expect(buildAccessPayload({ mode: 'org', emailsText: 'a@x.com', teamIds: ['t1'], userIds: ['u1'] }, { orgMode: true })).toEqual({
      mode: 'restricted', org_allowed: true, owner_only: false,
      allowed_emails: [], allowed_team_ids: [], allowed_user_ids: [],
    });
  });

  it('never sends org_allowed for specific people', () => {
    expect(buildAccessPayload(restricted('a@x.com', true))).toEqual({
      mode: 'restricted', emails: ['a@x.com'], org_allowed: false, owner_only: false,
    });
  });

  it('splits specific teams, people and outside emails in MindsHub mode, under the canonical names only', () => {
    expect(buildAccessPayload({ mode: 'specific', emailsText: 'zed@partner.io', teamIds: ['t1'], userIds: ['u1', 'u1'] }, { orgMode: true })).toEqual({
      mode: 'restricted', org_allowed: false, owner_only: false,
      allowed_emails: ['zed@partner.io'], allowed_team_ids: ['t1'], allowed_user_ids: ['u1'],
    });
  });

  // The org access route answers `emails` with a 400.
  it('never sends emails in MindsHub mode, Only me and Specific people included', () => {
    expect(buildAccessPayload({ mode: 'private', emailsText: 'a@x.com' }, { orgMode: true })).toEqual({
      mode: 'restricted', org_allowed: false, owner_only: true,
      allowed_emails: [], allowed_team_ids: [], allowed_user_ids: [],
    });
    const specific = buildAccessPayload(restricted('a@x.com'), { orgMode: true });
    expect(specific).toEqual({
      mode: 'restricted', org_allowed: false, owner_only: false,
      allowed_emails: ['a@x.com'], allowed_team_ids: [], allowed_user_ids: [],
    });
    expect(specific).not.toHaveProperty('emails');
  });
});

/* A draft mode the payload doesn't know (Everyone at ‹org› reaching a
   desktop save, a mode a later chooser adds) saves as Only me, never as
   Public, which would open the link to anyone who has it. */
describe('buildAccessPayload: a mode it does not know', () => {
  it.each(['org', 'link', '', undefined])('saves %j on desktop as Only me, never Public', (mode) => {
    expect(buildAccessPayload({ mode, emailsText: 'a@x.com' })).toEqual({
      mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
    });
  });

  it.each(['link', '', undefined])('saves %j in MindsHub mode as Only me, never Public', (mode) => {
    expect(buildAccessPayload({ mode, emailsText: 'a@x.com', teamIds: ['t1'] }, { orgMode: true })).toEqual({
      mode: 'restricted', org_allowed: false, owner_only: true,
      allowed_emails: [], allowed_team_ids: [], allowed_user_ids: [],
    });
  });

  it('still saves Public when Public is picked', () => {
    expect(buildAccessPayload({ mode: 'public' })).toEqual({ mode: 'public' });
    expect(buildAccessPayload({ mode: 'public' }, { orgMode: true })).toEqual({ mode: 'public' });
  });
});

describe('ACCESS_LABELS', () => {
  it('is exported for reuse by PublishMenu', () => {
    expect(ACCESS_LABELS.specificPeople.title).toBe('Specific people');
    expect(ACCESS_LABELS.specificPeople.desc).toBe('Only the people you list');
    expect(ACCESS_LABELS.specific.title).toBe('Specific teams and people');
    expect(ACCESS_LABELS.specific.desc).toBe('Pick teams, colleagues or outside emails');
    expect(ACCESS_LABELS.private.title).toBe('Only me');
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
    expect(buildAccessPayload({ mode: 'private' })).toEqual({
      mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
    });
  });

  it('drops a stale recipient list when the user switches to Only me', () => {
    expect(buildAccessPayload({ mode: 'private', emailsText: 'alice@x.com', orgAllowed: true }))
      .toEqual({ mode: 'restricted', emails: [], org_allowed: false, owner_only: true });
  });

  it('reads an owner-only artifact back as the owner-only mode', () => {
    expect(accessDraftFromArtifact({
      accessMode: 'restricted', accessEmails: [], orgAllowed: false, ownerOnly: true,
    }).mode).toBe('private');
  });

  it('reads a shared artifact back as Specific people', () => {
    const draft = accessDraftFromArtifact({
      accessMode: 'restricted', accessEmails: ['a@x.com'], orgAllowed: false, ownerOnly: false,
    });
    expect(draft.mode).toBe('specific');
    expect(draft.emailsText).toBe('a@x.com');
  });

  it('falls back to deriving owner-only for a record written before the flag', () => {
    const mode = (artifact) => accessDraftFromArtifact({ accessMode: 'restricted', ...artifact }).mode;
    expect(mode({ accessEmails: [], orgAllowed: false })).toBe('private');
    expect(mode({ accessEmails: ['a@x.com'], orgAllowed: false })).toBe('specific');
    expect(mode({ accessEmails: [], orgAllowed: true })).toBe('specific');
  });

  it('prefers the server flag over the derivation when both are present', () => {
    expect(accessDraftFromArtifact({ accessMode: 'restricted', ownerOnly: false, accessEmails: [], orgAllowed: false }).mode)
      .toBe('specific');
  });

  it('offers Only me and Specific people as separate choices, private first', () => {
    const { container } = render(
      <AccessChooser value={{ mode: 'private', emailsText: '', orgAllowed: false }} onChange={() => {}} />,
    );
    expect(screen.getByText('Only me')).toBeInTheDocument();
    expect(screen.getByText('Specific people')).toBeInTheDocument();
    const order = [...container.querySelectorAll('span')]
      .map((n) => n.textContent)
      .filter((t) => ['Only me', 'Specific people', 'Password protected', 'Public'].includes(t));
    expect(order).toEqual(['Only me', 'Specific people', 'Password protected', 'Public']);
  });

  it('does not show the recipient field for Only me', () => {
    render(
      <AccessChooser value={{ mode: 'private', emailsText: '', orgAllowed: false }} onChange={() => {}} />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('a first share with the platform UI on', () => {
  it('starts on Public', () => {
    expect(newAccessDraft().mode).toBe('public');
    expect(accessDraftFromArtifact({ publishedUrl: '' }).mode).toBe('public');
  });

  it('describes Public and Password as reaching the internet', () => {
    expect(ACCESS_LABELS.public.desc).toBe('Anyone on the internet with the URL');
    expect(ACCESS_LABELS.password.desc).toBe('Anyone on the internet with the password');
  });
});

describe('notifying added people', () => {
  const draft = (over) => ({ mode: 'specific', password: '', emailsText: '', teamIds: [], userIds: [], ...over });

  it('adds notify with exactly the people to email, on a restricted payload only', () => {
    expect(buildAccessPayload(draft({ emailsText: 'a@x.io' }), { notify: { userIds: [], emails: ['a@x.io'] } }))
      .toEqual(expect.objectContaining({ mode: 'restricted', notify: { user_ids: [], emails: ['a@x.io'] } }));
    expect(buildAccessPayload(draft({ emailsText: 'a@x.io' }), { orgMode: true, notify: { userIds: ['u1', 'u1'], emails: ['a@x.io'] } }))
      .toEqual(expect.objectContaining({ allowed_emails: ['a@x.io'], notify: { user_ids: ['u1'], emails: ['a@x.io'] } }));
    // Not asked, or Don't notify: no notify at all.
    expect(buildAccessPayload(draft({ emailsText: 'a@x.io' }))).not.toHaveProperty('notify');
    expect(buildAccessPayload(draft({ emailsText: 'a@x.io' }), { notify: null })).not.toHaveProperty('notify');
    expect(buildAccessPayload(draft({ emailsText: 'a@x.io' }), { notify: { userIds: [], emails: [] } })).not.toHaveProperty('notify');
    expect(buildAccessPayload({ mode: 'password', password: 'pw' }, { notify: { emails: ['a@x.io'] } })).toEqual({ mode: 'password', password: 'pw' });
    expect(buildAccessPayload({ mode: 'public' }, { notify: { emails: ['a@x.io'] } })).toEqual({ mode: 'public' });
  });

  it('counts only people and emails the saved access lacks', () => {
    const saved = draft({ emailsText: 'a@x.io', userIds: ['u1'], teamIds: ['t1'] });
    const next = draft({ emailsText: 'a@x.io, b@x.io', userIds: ['u1', 'u2'], teamIds: ['t1', 't2'] });
    expect(addedIndividuals(next, saved, { orgSharing: true })).toEqual({ userIds: ['u2'], emails: ['b@x.io'] });
    // Without sharing in MindsHub mode there are no user ids.
    expect(addedIndividuals(next, saved)).toEqual({ userIds: [], emails: ['b@x.io'] });
    // Only a Specific draft adds anyone.
    expect(addedIndividuals({ ...next, mode: 'org' }, saved, { orgSharing: true })).toEqual({ userIds: [], emails: [] });
  });
});
