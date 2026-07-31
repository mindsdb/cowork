import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArtifactStatus } from './ArtifactStatus.jsx';

// The Badge success variant (green "available to all" look) is the one that
// must NEVER appear on a protected artifact — badgeVariants tags it with
// `text-success-text`. Every badge shares the `rounded-full` pill class, so
// that's the stable anchor for "the badge wrapping this label".
const badgeFor = (label) => screen.getByText(label).closest('.rounded-full');
const isSuccess = (label) => badgeFor(label).className.includes('text-success-text');

describe('ArtifactStatus access labelling (ENG-1212)', () => {
  const published = { publishedUrl: 'https://x.test/a' };

  it('shows a neutral "Restricted" badge for an email-protected artifact — never "Shared"', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'restricted', accessEmails: ['a@b.com'] }} />);
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByText('Shared')).toBeNull();
    // The green "available to all" treatment must not be applied.
    expect(isSuccess('Restricted')).toBe(false);
  });

  it('shows a neutral "Password" badge for a password-protected artifact', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'password' }} />);
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.queryByText('Shared')).toBeNull();
    expect(isSuccess('Password')).toBe(false);
  });

  it('falls back to "Password" (neutral) when only the legacy accessProtected flag is set', () => {
    render(<ArtifactStatus artifact={{ ...published, accessProtected: true }} />);
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(isSuccess('Password')).toBe(false);
  });

  it('shows the green "Public" badge only for a genuinely public artifact', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'public' }} />);
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(isSuccess('Public')).toBe(true);
  });

  it('defaults an artifact with no access fields to public', () => {
    render(<ArtifactStatus artifact={{ ...published }} />);
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(isSuccess('Public')).toBe(true);
  });

  it('shows "Not shared" for an unpublished, publishable artifact', () => {
    render(<ArtifactStatus artifact={{ accessMode: 'restricted' }} publishable />);
    expect(screen.getByText('Not shared')).toBeInTheDocument();
    expect(screen.queryByText('Restricted')).toBeNull();
  });

  it('still surfaces "Unshared changes" alongside a protected badge when modified', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'restricted', modified: true }} />);
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.getByText('Unshared changes')).toBeInTheDocument();
  });
});
