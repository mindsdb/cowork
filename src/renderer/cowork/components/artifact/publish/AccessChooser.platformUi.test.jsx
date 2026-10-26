import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));

import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  newAccessDraft,
  ACCESS_LABELS,
} from './AccessChooser';

describe('AccessChooser with the platform UI off', () => {
  it('starts a first share with nothing picked, and refuses it as it is', () => {
    const draft = newAccessDraft();
    expect(draft.mode).toBe('');
    expect(isAccessDraftValid(draft)).toBe(false);
  });

  it('starts an unpublished artifact with nothing picked', () => {
    expect(accessDraftFromArtifact({ publishedUrl: '' }).mode).toBe('');
    expect(accessDraftFromArtifact(undefined).mode).toBe('');
  });

  it('ignores the access an earlier publish left on an unpublished artifact', () => {
    const draft = accessDraftFromArtifact({ publishedUrl: '', accessMode: 'public' });
    expect(draft.mode).toBe('');
  });

  it('keeps a published artifact on its live choice', () => {
    expect(accessDraftFromArtifact({ publishedUrl: 'https://view.example/r/a', accessMode: 'public' }).mode)
      .toBe('public');
    expect(accessDraftFromArtifact({ publishedUrl: 'https://view.example/r/a' }).mode).toBe('public');
  });

  it('says who Public and Password reach without claiming the internet', () => {
    expect(ACCESS_LABELS.public.desc).toBe('Anyone who can reach this deployment, with the URL');
    expect(ACCESS_LABELS.password.desc).toBe('Anyone who can reach this deployment, with the password');
  });

  it('renders no choice selected and offers no "Only you"', () => {
    render(<AccessChooser value={newAccessDraft()} onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Only you')).toBeNull();
    expect(screen.getByText('Anyone who can reach this deployment, with the URL')).toBeInTheDocument();
  });

  it('asks for someone without pointing to "Only you" when Specific people is empty', () => {
    render(<AccessChooser value={{ ...newAccessDraft(), mode: 'restricted' }} onChange={() => {}} />);
    expect(screen.getByText(/^Add someone ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Only you/)).toBeNull();
  });
});
