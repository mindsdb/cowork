import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactStatus, artifactStatusHint } from './ArtifactStatus.jsx';

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

// ENG-2177: "Draft" and "Restricted" were shown with no explanation, and
// nothing said which state can be shared. Each idle label now carries a
// one-line hint saying what it means for who can open the artifact.
describe('ArtifactStatus hints (ENG-2177)', () => {
  const published = { publishedUrl: 'https://x.test/a' };

  it('explains Draft as a file type that cannot become a web link', () => {
    expect(artifactStatusHint({}, false))
      .toBe('Not shared. Only web pages and Markdown documents can be shared as a link.');
  });

  it('tells the user how to share a Not shared artifact', () => {
    expect(artifactStatusHint({}, true))
      .toBe('Not shared yet. Open it and choose Share to get a web link.');
  });

  it('explains Restricted for specific people', () => {
    expect(artifactStatusHint({ ...published, accessMode: 'restricted', accessEmails: ['a@b.com'] }, true))
      .toBe('Shared. Only the people you chose can open the link.');
  });

  it('explains Restricted for an owner-only link', () => {
    expect(artifactStatusHint({ ...published, accessMode: 'restricted', ownerOnly: true }, true))
      .toBe('Shared, but only you can open the link.');
  });

  it('does not claim a known audience when the access mode is unknown', () => {
    expect(artifactStatusHint({ ...published }, true))
      .toBe('Shared. Who can open the link could not be confirmed, so it is treated as restricted.');
    expect(artifactStatusHint({ ...published, accessMode: 'org' }, true))
      .toBe('Shared. Who can open the link could not be confirmed, so it is treated as restricted.');
  });

  it('shows the Draft hint on hover', async () => {
    render(<ArtifactStatus artifact={{}} publishable={false} />);
    await userEvent.hover(screen.getByText('Draft'));
    expect(await screen.findByText(/Only web pages and Markdown documents/)).toBeInTheDocument();
  });

  it('shows the Restricted hint on hover', async () => {
    render(<ArtifactStatus artifact={{ ...published, accessMode: 'restricted', accessEmails: ['a@b.com'] }} />);
    await userEvent.hover(screen.getByText('Restricted'));
    expect(await screen.findByText('Shared. Only the people you chose can open the link.')).toBeInTheDocument();
  });
});

// ENG-2979: the "Another member" tag rides in the status row. As a sibling of
// ArtifactStatus it wrapped to a second line on every published card, because
// the published row is `w-full`.
describe('ArtifactStatus extra slot (ENG-2979)', () => {
  const published = { publishedUrl: 'https://x.test/a', accessMode: 'restricted', accessEmails: ['a@b.com'] };
  const extra = <span data-testid="extra">tag</span>;
  const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('puts extra in the published row, after the access badge and before Unshared changes', () => {
    render(<ArtifactStatus artifact={{ ...published, modified: true }} extra={extra} />);
    const tag = screen.getByTestId('extra');
    const row = screen.getByText('Unshared changes').closest('.flex-wrap');
    expect(row).toContainElement(tag);
    expect(row).toContainElement(screen.getByText('Restricted'));
    expect(follows(screen.getByText('Restricted'), tag)).toBe(true);
    expect(follows(tag, screen.getByText('Unshared changes'))).toBe(true);
  });

  it('keeps the inline list layout the same way', () => {
    render(<ArtifactStatus artifact={{ ...published, modified: true }} extra={extra} inlineChanges />);
    const tag = screen.getByTestId('extra');
    expect(follows(screen.getByText('Restricted'), tag)).toBe(true);
    expect(follows(tag, screen.getByText('Unshared changes'))).toBe(true);
  });

  it('puts extra right after the Not shared badge', () => {
    render(<ArtifactStatus artifact={{}} publishable extra={extra} />);
    const tag = screen.getByTestId('extra');
    expect(tag.parentElement).toContainElement(screen.getByText('Not shared'));
    expect(follows(screen.getByText('Not shared'), tag)).toBe(true);
  });

  it('puts extra right after a transient phase badge', () => {
    render(<ArtifactStatus artifact={{}} phase="publishing" extra={extra} />);
    const tag = screen.getByTestId('extra');
    expect(tag.parentElement).toContainElement(screen.getByText('Sharing…'));
  });

  it('puts extra after the failure message', () => {
    render(<ArtifactStatus artifact={{}} phase="failed" extra={extra} />);
    const tag = screen.getByTestId('extra');
    expect(follows(screen.getByText('Sharing failed'), tag)).toBe(true);
  });

  // Base UI Tooltip ids come from React useId, a global counter, so two
  // renders can differ in id/aria-* even with identical structure. Strip them.
  const structure = (html) => html.replace(/\s(?:id|aria-describedby|aria-controls|aria-labelledby)="[^"]*"/g, '');

  it('renders exactly today\'s DOM without extra', () => {
    const cases = [
      { artifact: {}, publishable: true },
      { artifact: {}, phase: 'deleting' },
      { artifact: { ...published, modified: true } },
    ];
    for (const props of cases) {
      const without = render(<ArtifactStatus {...props} />);
      const html = structure(without.container.innerHTML);
      without.unmount();
      const withNull = render(<ArtifactStatus {...props} extra={null} />);
      expect(structure(withNull.container.innerHTML)).toBe(html);
      withNull.unmount();
    }
  });
});
