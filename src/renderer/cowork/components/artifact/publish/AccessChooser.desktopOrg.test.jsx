import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AUDIENCE_CHOICE } from '../../../lib/orgSharing';
import { setOrgMode } from '../../../../lib/orgMode';
import {
  AccessChooser, accessDraftFromArtifact, accessSummaryLabel, buildAccessPayload, isAccessDraftValid,
} from './AccessChooser';

const DESKTOP_ORG = (over = {}) => ({
  status: 'ready',
  orgName: 'Acme',
  capabilities: {
    enabled: false, orgAudience: true, canShareSkillsOrg: false, canWriteSkillsOrg: false,
    canShareArtifactsOrg: true, permissionsKnown: true, teamsKnown: true, ...over,
  },
});
const published = (over) => ({
  publishedUrl: 'https://share/abc', accessMode: 'restricted', accessEmails: [], orgAllowed: false, ownerOnly: false, ...over,
});

function Harness({ initial, sharing }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <AccessChooser value={draft} onChange={setDraft} sharing={sharing} />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}

describe('accessDraftFromArtifact on Desktop', () => {
  it('reads org_allowed as Everyone with the organization audience', () => {
    expect(accessDraftFromArtifact(published({ orgAllowed: true }), { orgAudience: true }).mode).toBe(AUDIENCE_CHOICE.ORG);
    expect(accessDraftFromArtifact(published({ orgAllowed: true, accessEmails: ['a@x.com'] }), { orgAudience: true }).mode)
      .toBe(AUDIENCE_CHOICE.ORG);
  });

  it('keeps org_allowed on a list when the card is not offered', () => {
    const draft = accessDraftFromArtifact(published({ orgAllowed: true, accessEmails: ['a@x.com'] }));
    expect(draft).toMatchObject({ mode: AUDIENCE_CHOICE.SPECIFIC, keepOrgAllowed: true, emailsText: 'a@x.com' });
  });

  it('adds nothing to a list without org_allowed', () => {
    const draft = accessDraftFromArtifact(published({ accessEmails: ['a@x.com'] }));
    expect(draft.keepOrgAllowed).toBeUndefined();
  });

  it('keeps nothing in MindsHub mode, whose payload never reads it', () => {
    setOrgMode(true);
    try {
      const draft = accessDraftFromArtifact(published({ orgAllowed: true }));
      expect(draft.keepOrgAllowed).toBeUndefined();
      expect(isAccessDraftValid(draft)).toBe(false);
    } finally {
      setOrgMode(false);
    }
  });
});

describe('isAccessDraftValid with a kept organization', () => {
  it('accepts an empty list the organization still reaches', () => {
    expect(isAccessDraftValid({ mode: AUDIENCE_CHOICE.SPECIFIC, emailsText: '', keepOrgAllowed: true })).toBe(true);
    expect(isAccessDraftValid({ mode: AUDIENCE_CHOICE.SPECIFIC, emailsText: '' })).toBe(false);
  });
});

describe('buildAccessPayload on Desktop', () => {
  it('sends Everyone as org_allowed with no emails', () => {
    expect(buildAccessPayload({ mode: AUDIENCE_CHOICE.ORG })).toEqual({
      mode: 'restricted', emails: [], org_allowed: true, owner_only: false,
    });
  });

  it('keeps org_allowed on a list', () => {
    expect(buildAccessPayload({ mode: AUDIENCE_CHOICE.SPECIFIC, emailsText: 'a@x.com', keepOrgAllowed: true })).toEqual({
      mode: 'restricted', emails: ['a@x.com'], org_allowed: true, owner_only: false,
    });
  });

  it('keeps org_allowed when every email is removed', () => {
    expect(buildAccessPayload({ mode: AUDIENCE_CHOICE.SPECIFIC, emailsText: '', keepOrgAllowed: true })).toEqual({
      mode: 'restricted', emails: [], org_allowed: true, owner_only: false,
    });
  });

  it('drops it for Public and Only me', () => {
    expect(buildAccessPayload({ mode: AUDIENCE_CHOICE.PUBLIC, keepOrgAllowed: true })).toEqual({ mode: 'public' });
    expect(buildAccessPayload({ mode: AUDIENCE_CHOICE.PRIVATE, keepOrgAllowed: true })).toEqual({
      mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
    });
  });
});

describe('accessSummaryLabel on Desktop', () => {
  it('names everyone at the organization', () => {
    expect(accessSummaryLabel(published({ orgAllowed: true }), { orgAudience: true, orgName: 'Acme' }).title).toBe('Everyone at Acme');
  });
  it('stays Specific people without the audience', () => {
    expect(accessSummaryLabel(published({ orgAllowed: true }), {}).title).toBe('Specific people');
  });
});

describe('AccessChooser with the Desktop organization audience', () => {
  it('offers Everyone between Only me and Specific people, and no teams', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ mode: AUDIENCE_CHOICE.PRIVATE, emailsText: '' }} sharing={DESKTOP_ORG()} />);
    await user.click(screen.getByTestId('access-dropdown'));
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label') || r.textContent);
    const iOnly = names.findIndex((n) => /Only me/.test(n));
    const iOrg = names.findIndex((n) => /Everyone at Acme/.test(n));
    const iSpecific = names.findIndex((n) => /Specific people/.test(n));
    expect(iOnly).toBeLessThan(iOrg);
    expect(iOrg).toBeLessThan(iSpecific);
    expect(names.some((n) => /teams/.test(n))).toBe(false);
  });

  it('locks Everyone with the role hint without the permission', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ mode: AUDIENCE_CHOICE.PRIVATE, emailsText: '' }} sharing={DESKTOP_ORG({ canShareArtifactsOrg: false })} />);
    await user.click(screen.getByTestId('access-dropdown'));
    // The hint is a tooltip: it shows on hover.
    await user.hover(screen.getByTestId('org-option-locked'));
    expect(await screen.findByText("Your role can't share with everyone in the organization")).toBeInTheDocument();
  });

  it('locks Everyone with the unreachable hint when auth was not asked', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ mode: AUDIENCE_CHOICE.PRIVATE, emailsText: '' }} sharing={DESKTOP_ORG({ canShareArtifactsOrg: false, permissionsKnown: false })} />);
    await user.click(screen.getByTestId('access-dropdown'));
    await user.hover(screen.getByTestId('org-option-locked'));
    expect(await screen.findByText("Couldn't reach MindsHub")).toBeInTheDocument();
  });

  it('shows the kept organization under the list when the card is not offered', () => {
    render(<Harness initial={{ mode: AUDIENCE_CHOICE.SPECIFIC, emailsText: 'a@x.com', keepOrgAllowed: true }} sharing={null} />);
    expect(screen.getByTestId('org-also-has-access')).toHaveTextContent('The organization can also open this.');
  });
});
