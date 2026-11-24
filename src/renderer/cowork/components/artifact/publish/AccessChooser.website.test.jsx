// "Public website": a MindsHub mode artifact served at its own address.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AUDIENCE_CHOICE } from '../../../lib/orgSharing';
import {
  ACCESS_LABELS,
  AccessChooser,
  accessDraftFromArtifact,
  accessSummaryLabel,
  buildAccessPayload,
  isAccessDraftValid,
} from './AccessChooser';

// A website card as cowork-server answers it: not restricted, so its
// audience fields are empty, never null.
const WEBSITE_CARD = {
  publishedUrl: 'https://k3x9-staging.mindshub.co/',
  accessMode: 'website',
  accessProtected: false,
  accessEmails: [],
  orgAllowed: false,
  ownerOnly: false,
  allowedTeamIds: [],
  allowedUserIds: [],
};
const draft = (mode, extra = {}) => ({ mode, password: '', emailsText: '', teamIds: [], userIds: [], ...extra });
const cards = () => screen.getAllByRole('radio').map((radio) => radio.textContent);
const websiteCard = () => screen.queryByRole('radio', { name: /^Public website/ });

describe('Public website: the draft helpers', () => {
  it('names the choice "website"', () => {
    expect(AUDIENCE_CHOICE.WEBSITE).toBe('website');
  });

  it('is a complete selection on its own', () => {
    expect(isAccessDraftValid(draft('website'))).toBe(true);
    expect(isAccessDraftValid(draft('website'), { orgSharing: true })).toBe(true);
  });

  it('saves as website and nothing else in MindsHub mode', () => {
    const stale = draft('website', { password: 'pw', emailsText: 'a@x.com', teamIds: ['t1'], userIds: ['u1'] });
    expect(buildAccessPayload(stale, { orgMode: true })).toEqual({ mode: 'website' });
    expect(buildAccessPayload(stale, { orgMode: true, notify: { userIds: ['u1'], emails: [] } })).toEqual({ mode: 'website' });
  });

  it('never saves as website on desktop: there it is a mode the payload does not know, so Only me', () => {
    expect(buildAccessPayload(draft('website'))).toEqual({
      mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
    });
  });

  it('reads a website card back as the website choice', () => {
    expect(accessDraftFromArtifact(WEBSITE_CARD).mode).toBe('website');
    expect(accessDraftFromArtifact(WEBSITE_CARD, { orgSharing: true }).mode).toBe('website');
  });

  it('labels the summary "Public website"', () => {
    expect(accessSummaryLabel(WEBSITE_CARD)).toBe(ACCESS_LABELS.website);
    expect(accessSummaryLabel(WEBSITE_CARD, { orgSharing: true })).toBe(ACCESS_LABELS.website);
    expect(ACCESS_LABELS.website.title).toBe('Public website');
    expect(ACCESS_LABELS.website.desc).toBe('Its own web address, open to anyone on the internet');
    expect(typeof ACCESS_LABELS.website.icon).toBe('function');
  });
});

describe('Public website: the card', () => {
  it('is not offered unless the caller offers it', () => {
    render(<AccessChooser value={draft('public')} onChange={() => {}} />);
    expect(websiteCard()).toBeNull();
  });

  it('comes right after Public when offered', () => {
    render(<AccessChooser value={draft('public')} onChange={() => {}} website />);
    const titles = cards();
    expect(titles.at(-2)).toMatch(/^Public(?! website)/);
    expect(titles.at(-1)).toMatch(/^Public website/);
  });

  it('picks website', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AccessChooser value={draft('public')} onChange={onChange} website />);
    await user.click(websiteCard());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'website' }));
  });

  // A deployment that stops offering websites still shows an artifact that
  // is one; once the person picks another card, it is gone.
  it('stays listed, checked, for an artifact that already is a website', () => {
    render(<AccessChooser value={draft('website')} onChange={() => {}} />);
    expect(websiteCard()).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the website as the chosen card of the dropdown', () => {
    render(<AccessChooser layout="dropdown" value={draft('website')} onChange={() => {}} website />);
    expect(screen.getByTestId('access-dropdown')).toHaveAccessibleName('Who can access your app: Public website');
  });
});
