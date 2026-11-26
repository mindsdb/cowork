import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A web build without the platform UI whose server publishes with the person's
// own key: the SPA wrapper's tag says no shared publish token is set.
vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../../../lib/sharedPublishToken', () => ({ hasSharedPublishToken: () => false }));

import { AUDIENCE_CHOICE } from '../../../lib/orgSharing';
import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  newAccessDraft,
  ACCESS_LABELS,
} from './AccessChooser';

describe('AccessChooser with the platform UI off and no shared publish token', () => {
  it('starts a first share and an unpublished artifact on Only me', () => {
    expect(newAccessDraft().mode).toBe(AUDIENCE_CHOICE.PRIVATE);
    expect(isAccessDraftValid(newAccessDraft())).toBe(true);
    expect(accessDraftFromArtifact({ publishedUrl: '', accessMode: 'public' }).mode).toBe(AUDIENCE_CHOICE.PRIVATE);
  });

  it('says Public and Password links reach the internet', () => {
    expect(ACCESS_LABELS.public.desc).toBe('Anyone on the internet with the URL');
    expect(ACCESS_LABELS.password.desc).toBe('Anyone on the internet with the password');
  });

  it('renders Only me selected and offers it first', async () => {
    const user = userEvent.setup();
    render(<AccessChooser value={newAccessDraft()} onChange={() => {}} />);
    // Closed, the dropdown names the chosen access; open, it lists them all.
    expect(screen.getByTestId('access-dropdown')).toHaveAccessibleName('Who can access your app: Only me');
    await user.click(screen.getByTestId('access-dropdown'));
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios[0]).toHaveAccessibleName(/Only me/);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    for (const radio of radios.slice(1)) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Anyone on the internet with the URL')).toBeInTheDocument();
  });

  it('asks for an email in an empty Specific people', () => {
    render(<AccessChooser value={{ ...newAccessDraft(), mode: 'specific' }} onChange={() => {}} />);
    expect(screen.getByTestId('recipient-summary')).toHaveTextContent('Add at least one email.');
    expect(screen.getByRole('combobox', { name: 'Add people by email' })).toBeInTheDocument();
  });
});
