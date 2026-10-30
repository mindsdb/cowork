import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// A web build without the platform UI whose server publishes with the person's
// own key: the SPA wrapper's tag says no shared publish token is set.
vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../../../lib/sharedPublishToken', () => ({ hasSharedPublishToken: () => false }));

import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  newAccessDraft,
  ACCESS_LABELS,
} from './AccessChooser';

describe('AccessChooser with the platform UI off and no shared publish token', () => {
  it('still starts a first share and an unpublished artifact with nothing picked', () => {
    expect(newAccessDraft().mode).toBe('');
    expect(isAccessDraftValid(newAccessDraft())).toBe(false);
    expect(accessDraftFromArtifact({ publishedUrl: '', accessMode: 'public' }).mode).toBe('');
  });

  it('says Public and Password links reach the internet', () => {
    expect(ACCESS_LABELS.public.desc).toBe('Anyone on the internet with the URL');
    expect(ACCESS_LABELS.password.desc).toBe('Anyone on the internet with the password');
  });

  it('renders no choice selected and offers "Only you" first', () => {
    render(<AccessChooser value={newAccessDraft()} onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    for (const radio of radios) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(radios[0]).toHaveAccessibleName(/Only you/);
    expect(screen.getByText('Anyone on the internet with the URL')).toBeInTheDocument();
  });

  it('asks for an email in an empty Specific people', () => {
    render(<AccessChooser value={{ ...newAccessDraft(), mode: 'restricted' }} onChange={() => {}} />);
    expect(screen.getByTestId('recipient-summary')).toHaveTextContent('Add at least one email.');
    expect(screen.getByRole('combobox', { name: 'Add people by email' })).toBeInTheDocument();
  });
});
