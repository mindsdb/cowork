import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArtifactStatus } from './ArtifactStatus.jsx';

// The Badge success variant (green "available to all" look) is the one that
// must NEVER appear on a protected artifact — badgeVariants tags it with
// `text-success-text`. Every badge shares the `rounded-full` pill class, so
// that's the stable anchor for "the badge wrapping this label".
const badgeFor = (label) => screen.getByText(label).closest('.rounded-full');
const isSuccess = (label) => badgeFor(label).className.includes('text-success-text');
// The neutral (default) variant positively — `!isSuccess` alone also passes for
// warning/danger, so protected badges assert this to pin the exact treatment.
const isNeutral = (label) => badgeFor(label).className.includes('text-ink-2');
const hasIcon = (label) => !!badgeFor(label).querySelector('svg');

describe('ArtifactStatus access labelling (ENG-1212)', () => {
  const published = { publishedUrl: 'https://x.test/a' };

  it('shows a neutral "Restricted" badge for an email-protected artifact — never "Shared"', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'restricted', accessEmails: ['a@b.com'] }} />);
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByText('Shared')).toBeNull();
    // The green "available to all" treatment must not be applied; it must be neutral.
    expect(isSuccess('Restricted')).toBe(false);
    expect(isNeutral('Restricted')).toBe(true);
    // The icon-only narrow-card collapse relies on the badge carrying an icon.
    expect(hasIcon('Restricted')).toBe(true);
  });

  it('shows a neutral "Password" badge for a password-protected artifact', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'password' }} />);
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.queryByText('Shared')).toBeNull();
    expect(isNeutral('Password')).toBe(true);
    expect(hasIcon('Password')).toBe(true);
  });

  it('falls back to "Password" (neutral) when only the legacy accessProtected flag is set', () => {
    render(<ArtifactStatus artifact={{ ...published, accessProtected: true }} />);
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(isNeutral('Password')).toBe(true);
  });

  it('shows the green "Public" badge only for a genuinely public artifact', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'public' }} />);
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(isSuccess('Public')).toBe(true);
    expect(hasIcon('Public')).toBe(true);
  });

  it('fails CLOSED for an artifact with no access fields — neutral, never green Public', () => {
    render(<ArtifactStatus artifact={{ ...published }} />);
    // Access state unknown (e.g. a chat-bubble stub): must not read as public.
    expect(screen.queryByText('Public')).toBeNull();
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(isNeutral('Restricted')).toBe(true);
  });

  it('fails CLOSED for an unrecognised access mode — neutral, never green Public', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'org' }} />);
    expect(screen.queryByText('Public')).toBeNull();
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(isNeutral('Restricted')).toBe(true);
    expect(hasIcon('Restricted')).toBe(true);
  });

  it('does not treat a prototype-chain key (constructor) as a known mode', () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'constructor' }} />);
    // Object.hasOwn guard: renders the neutral fallback pill, not a blank one.
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(isNeutral('Restricted')).toBe(true);
    expect(hasIcon('Restricted')).toBe(true);
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

describe('ArtifactStatus access-label visibility (ENG-1475)', () => {
  // The access badge is a plain inline-flex pill (Badge is whitespace-nowrap and
  // sizes to its content), so its label is always shown. It must NOT be
  // collapsed to icon-only by a container-width query — that keyed off the whole
  // card / status cell, hiding the label even when the pill had ample room.
  // Container queries can't be exercised in happy-dom, so assert on the
  // stylesheet directly that no such collapse rule is reintroduced.
  it('never hides the access label with a card/cell-width container query', () => {
    // vitest runs from the package root, so resolve globals.css from cwd.
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/cowork/styles/globals.css'),
      'utf8',
    );
    expect(css).not.toMatch(/@container\s+(?:artcard|statuscell)\b/);
  });
});
