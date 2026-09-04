import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PublishMenu } from './PublishMenu';

function makeController(overrides = {}) {
  return {
    publishedUrl: '',
    phase: 'idle',
    busy: false,
    error: '',
    accessMode: 'public',
    accessPassword: '',
    accessEmails: [],
    orgAllowed: false,
    ownerOnly: false,
    accessLoaded: true,
    versions: [],
    modified: false,
    setError: vi.fn(),
    loadVersions: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    activate: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

describe('PublishMenu — outside-click dismiss', () => {
  it('closes when a click lands elsewhere on screen, not just on the trigger', () => {
    render(<PublishMenu controller={makeController()} />);

    fireEvent.click(screen.getByText('Share'));
    expect(screen.getByText('Share to the Web')).toBeInTheDocument();

    // The artifact preview renders as an <iframe>; a real click there would
    // hit-test to this overlay div (it visually covers the whole viewport),
    // never bubbling into the iframe's own document. Firing the press
    // directly on the overlay simulates that real-world hit-test.
    fireEvent.mouseDown(screen.getByTestId('publish-menu-outside-dismiss'));

    expect(screen.queryByText('Share to the Web')).toBeNull();
  });

  it('does not render the dismiss overlay when the popover is closed', () => {
    render(<PublishMenu controller={makeController()} />);
    expect(screen.queryByTestId('publish-menu-outside-dismiss')).toBeNull();
  });
});

describe('PublishMenu — restricted access change guard (ENG-931)', () => {
  const RESTRICTED = {
    publishedUrl: 'https://share/abc',
    accessMode: 'restricted',
  };

  it('offers an enabled Update (not the loading guard) when the list is loaded (grid/rail)', () => {
    const ctrl = makeController({
      ...RESTRICTED, accessEmails: ['alice@x.com'], accessLoaded: true, modified: true,
    });
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Shared'));
    fireEvent.click(screen.getByText('Change'));

    // The loading guard is not shown; the real Update button is clickable.
    expect(screen.queryByTitle('Loading current access…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Update' })).not.toBeDisabled();
  });

  it('blocks Update while the real list has not loaded yet (chat-bubble guard)', () => {
    const ctrl = makeController({
      ...RESTRICTED, accessEmails: [], accessLoaded: false, modified: true,
    });
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Shared'));
    fireEvent.click(screen.getByText('Change'));

    const guard = screen.getByTitle('Loading current access…');
    expect(guard).toBeDisabled();
  });

  it('re-seeds the draft when the real list arrives after Change was opened (no empty overwrite)', () => {
    const base = { ...RESTRICTED, accessEmails: [], accessLoaded: false, modified: false };
    const { rerender } = render(<PublishMenu controller={makeController(base)} />);
    fireEvent.click(screen.getByText('Shared'));
    fireEvent.click(screen.getByText('Change'));

    // Draft seeded empty (list not loaded yet).
    const ta = screen.getByPlaceholderText('alice@acme.com, bob@acme.com');
    expect(ta.value).toBe('');

    // Server list lands → draft re-seeds (user hasn't edited), so an empty
    // list can never be what "Update" would submit.
    rerender(<PublishMenu controller={makeController({
      ...base, accessEmails: ['alice@x.com', 'bob@x.com'], accessLoaded: true,
    })} />);
    expect(screen.getByPlaceholderText('alice@acme.com, bob@acme.com').value)
      .toBe('alice@x.com, bob@x.com');
  });
});

describe('PublishMenu — owner-only summary (ENG-1769)', () => {
  const PUBLISHED_RESTRICTED = {
    publishedUrl: 'https://share/abc',
    accessMode: 'restricted',
    accessLoaded: true,
  };

  it('summarises an owner-only publish as "Only you"', () => {
    render(<PublishMenu controller={makeController({
      ...PUBLISHED_RESTRICTED, accessEmails: [], orgAllowed: false, ownerOnly: true,
    })} />);
    fireEvent.click(screen.getByText('Shared'));

    expect(screen.getByText('Only you')).toBeInTheDocument();
    expect(screen.getByText('Nobody else can open this')).toBeInTheDocument();
  });

  it('summarises a restricted publish with recipients as the list variant', () => {
    render(<PublishMenu controller={makeController({
      ...PUBLISHED_RESTRICTED, accessEmails: ['alice@x.com'], orgAllowed: false, ownerOnly: false,
    })} />);
    fireEvent.click(screen.getByText('Shared'));

    expect(screen.getByText('For you and selected users')).toBeInTheDocument();
    expect(screen.queryByText('Only you')).toBeNull();
  });
});
