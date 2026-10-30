import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const recipients = () => screen.getByRole('list', { name: 'Recipients' });
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();

    // Server list lands → draft re-seeds (user hasn't edited), so an empty
    // list can never be what "Update" would submit.
    rerender(<PublishMenu controller={makeController({
      ...base, accessEmails: ['alice@x.com', 'bob@x.com'], accessLoaded: true,
    })} />);
    expect(recipients()).toHaveTextContent('alice@x.com');
    expect(recipients()).toHaveTextContent('bob@x.com');
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
    // Published, but nobody else can open it — so the trigger still offers to
    // share rather than claiming the artifact already is shared.
    fireEvent.click(screen.getByText('Share'));

    expect(screen.getByText('Only you')).toBeInTheDocument();
    expect(screen.getByText('Nobody else can open this')).toBeInTheDocument();
  });

  it('summarises a restricted publish with recipients as the list variant', () => {
    render(<PublishMenu controller={makeController({
      ...PUBLISHED_RESTRICTED, accessEmails: ['alice@x.com'], orgAllowed: false, ownerOnly: false,
    })} />);
    fireEvent.click(screen.getByText('Shared'));

    expect(screen.getByText('Specific people')).toBeInTheDocument();
    expect(screen.queryByText('Only you')).toBeNull();
  });

  // Published is not the same as shared. On Cloud every artifact is published
  // from birth, so a trigger keyed on `publishedUrl` alone told every owner their
  // private artifact was already "Shared".
  describe('the trigger label', () => {
    it('reads "Share" for an owner-only artifact, published or not', () => {
      render(<PublishMenu controller={makeController({
        ...PUBLISHED_RESTRICTED, accessEmails: [], orgAllowed: false, ownerOnly: true,
      })} />);

      expect(screen.getByText('Share')).toBeInTheDocument();
      expect(screen.queryByText('Shared')).toBeNull();
    });

    it('reads "Shared" once someone else can open it', () => {
      render(<PublishMenu controller={makeController({
        ...PUBLISHED_RESTRICTED, accessEmails: ['alice@x.com'], orgAllowed: false, ownerOnly: false,
      })} />);

      expect(screen.getByText('Shared')).toBeInTheDocument();
    });

    it('reads "Shared" for an org-wide artifact with no named recipients', () => {
      render(<PublishMenu controller={makeController({
        ...PUBLISHED_RESTRICTED, accessEmails: [], orgAllowed: true, ownerOnly: false,
      })} />);

      expect(screen.getByText('Shared')).toBeInTheDocument();
    });

    const trigger = () => screen.getByText(/^Shared?$/).closest('button');
    it.each([
      ['public', { publishedUrl: 'https://share/abc', accessMode: 'public' }, 'Public link: anyone with the URL can open it'],
      ['password', { publishedUrl: 'https://share/abc', accessMode: 'password', accessPassword: 'pw' }, 'Password protected'],
      ['specific', { ...PUBLISHED_RESTRICTED, accessEmails: ['a@x.io', 'b@x.io'], ownerOnly: false }, 'Shared with 2 people'],
      ['org', {
        ...PUBLISHED_RESTRICTED, orgAllowed: true, ownerOnly: false,
        orgSharing: { enabled: true, orgName: 'Acme', teams: { status: 'ready', reachable: true, teams: [] } },
      }, 'Shared with everyone at Acme'],
      ['specific', {
        ...PUBLISHED_RESTRICTED, ownerOnly: false, allowedTeamIds: ['t1', 't2'], allowedUserIds: ['u1', 'u2', 'u3'],
        orgSharing: { enabled: true, orgName: 'Acme', teams: { status: 'ready', reachable: true, teams: [] } },
      }, 'Shared with 2 teams and 3 people'],
    ])('marks a %s share with its icon and says who in a tooltip', async (kind, over, hint) => {
      const user = userEvent.setup();
      render(<PublishMenu controller={makeController(over)} />);
      expect(trigger()).toHaveTextContent(/^Shared$/);
      expect(trigger()).toHaveAttribute('data-share-state', kind);
      expect(trigger().querySelector('svg')).not.toBeNull();
      await user.hover(trigger());
      expect(await screen.findByText(hint)).toBeInTheDocument();
    });

    it('has no tooltip while only its owner can open it', async () => {
      const user = userEvent.setup();
      render(<PublishMenu controller={makeController({ ...PUBLISHED_RESTRICTED, accessEmails: [], ownerOnly: true })} />);
      expect(trigger()).toHaveTextContent(/^Share$/);
      expect(trigger()).toHaveAttribute('data-share-state', 'private');
      await user.hover(trigger());
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText(/Only you can open it/)).toBeNull();
    });
  });
});

describe('PublishMenu — a first share with the platform UI on', () => {
  it('starts on Public, described as reaching the internet', () => {
    render(<PublishMenu controller={makeController()} />);
    fireEvent.click(screen.getByText('Share'));

    expect(screen.getByRole('radio', { name: /Public/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Anyone on the internet with the URL')).toBeInTheDocument();
    expect(screen.getByText('Only you')).toBeInTheDocument();
  });
});
