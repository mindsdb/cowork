import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  // A list's people are edited from "Edit list" beside the section label.
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
    fireEvent.click(screen.getByText('Edit list'));

    // The loading guard is not shown; the real Update button is clickable.
    expect(screen.queryByTitle('Loading current access…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Update' })).not.toBeDisabled();
  });

  it('offers no Edit list while the real list has not loaded yet (chat-bubble guard)', () => {
    const ctrl = makeController({
      ...RESTRICTED, accessEmails: [], accessLoaded: false, modified: true,
    });
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Shared'));

    // An empty list opened here could be saved over the real one.
    expect(screen.queryByText('Edit list')).toBeNull();
  });

  it('offers no access dropdown before the real list loads, so no pick drafts over it', async () => {
    const user = userEvent.setup();
    const base = { ...RESTRICTED, accessEmails: [], accessLoaded: false, modified: true };
    const { rerender } = render(<PublishMenu controller={makeController(base)} />);
    await user.click(screen.getByText('Shared'));
    expect(screen.queryByTestId('access-dropdown')).toBeNull();

    rerender(<PublishMenu controller={makeController({ ...base, accessEmails: ['alice@x.com'], accessLoaded: true })} />);
    expect(screen.getByTestId('access-dropdown')).toBeInTheDocument();
  });

  it('opens Edit list on the real list once it arrives (no empty overwrite)', () => {
    const base = { ...RESTRICTED, accessEmails: [], accessLoaded: false, modified: false };
    const { rerender } = render(<PublishMenu controller={makeController(base)} />);
    fireEvent.click(screen.getByText('Shared'));
    expect(screen.queryByText('Edit list')).toBeNull();

    // Server list lands: Edit list opens on it, so an empty list can never be
    // what "Update" would submit.
    rerender(<PublishMenu controller={makeController({
      ...base, accessEmails: ['alice@x.com', 'bob@x.com'], accessLoaded: true,
    })} />);
    fireEvent.click(screen.getByText('Edit list'));
    const recipients = screen.getByRole('list', { name: 'Recipients' });
    expect(recipients).toHaveTextContent('alice@x.com');
    expect(recipients).toHaveTextContent('bob@x.com');
  });
});

describe('PublishMenu — owner-only summary (ENG-1769)', () => {
  const PUBLISHED_RESTRICTED = {
    publishedUrl: 'https://share/abc',
    accessMode: 'restricted',
    accessLoaded: true,
  };

  it('summarizes an owner-only publish as "Only me"', () => {
    render(<PublishMenu controller={makeController({
      ...PUBLISHED_RESTRICTED, accessEmails: [], orgAllowed: false, ownerOnly: true,
    })} />);
    // Published, but nobody else can open it — so the trigger still offers to
    // share rather than claiming the artifact already is shared.
    fireEvent.click(screen.getByText('Share'));

    expect(screen.getByText('Only me')).toBeInTheDocument();
    expect(screen.getByText('Nobody else can open this')).toBeInTheDocument();
  });

  it('summarises a restricted publish with recipients as the list variant', () => {
    render(<PublishMenu controller={makeController({
      ...PUBLISHED_RESTRICTED, accessEmails: ['alice@x.com'], orgAllowed: false, ownerOnly: false,
    })} />);
    fireEvent.click(screen.getByText('Shared'));

    expect(screen.getByText('Specific people')).toBeInTheDocument();
    expect(screen.queryByText('Only me')).toBeNull();
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
        orgSharing: { capabilities: { enabled: true }, teams: { status: 'ready', reachable: true, teams: [] }, orgName: 'Acme' },
      }, 'Shared with everyone at Acme'],
      // No org name known: the organization, unnamed.
      ['org', {
        ...PUBLISHED_RESTRICTED, orgAllowed: true, ownerOnly: false,
        orgSharing: { capabilities: { enabled: true }, teams: { status: 'ready', reachable: true, teams: [] }, orgName: null },
      }, 'Shared with everyone in the organization'],
      ['specific', {
        ...PUBLISHED_RESTRICTED, ownerOnly: false, allowedTeamIds: ['t1', 't2'], allowedUserIds: ['u1', 'u2', 'u3'],
        orgSharing: { capabilities: { enabled: true }, teams: { status: 'ready', reachable: true, teams: [] }, orgName: 'Acme' },
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
      expect(screen.queryByText(/Nobody else can open this/)).toBeNull();
    });
  });
});

describe('PublishMenu — a first share with the platform UI on', () => {
  it('starts on Only me, with Public described as reaching the internet', () => {
    render(<PublishMenu controller={makeController()} />);
    fireEvent.click(screen.getByText('Share'));

    expect(screen.getByRole('radio', { name: /Only me/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Public/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Anyone on the internet with the URL')).toBeInTheDocument();
  });
});

// jsdom does no layout, so these pin the CSS contract: the popup is capped at
// the height Base UI measures beside the trigger, and only the body scrolls,
// which keeps Update reachable on a short window.
describe('PublishMenu — fits a short window', () => {
  it('caps the unpublished panel and scrolls its body, keeping Share in the footer', () => {
    render(<PublishMenu controller={makeController()} />);
    fireEvent.click(screen.getByText('Share'));

    const body = screen.getByTestId('publish-menu-body');
    expect(body.className).toMatch(/\bmin-h-0\b/);
    expect(body.className).toMatch(/\boverflow-y-auto\b/);
    const popup = screen.getByRole('dialog');
    expect(popup.contains(body)).toBe(true);
    expect(popup.style.maxHeight).toBe('var(--available-height, 80vh)');
    expect(popup.style.flexDirection).toBe('column');
    // The trigger is a "Share" button too; the footer's is the last one.
    const share = screen.getAllByRole('button', { name: 'Share' }).at(-1);
    expect(popup.contains(share)).toBe(true);
    expect(body.contains(share)).toBe(false);
  });

  it('keeps Update outside the scrolling body of the access view', () => {
    const ctrl = makeController({
      publishedUrl: 'https://share/abc', accessMode: 'restricted', accessEmails: ['alice@x.com'], modified: true,
    });
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Shared'));
    fireEvent.click(screen.getByText('Edit list'));

    const body = screen.getByTestId('publish-menu-body');
    expect(body.className).toMatch(/\boverflow-y-auto\b/);
    const popup = screen.getByRole('dialog');
    expect(popup.style.maxHeight).toBe('var(--available-height, 80vh)');
    // The link row scrolls with the body rather than holding its height.
    expect(body.textContent).toContain('share/abc');
    const update = screen.getByRole('button', { name: 'Update' });
    expect(popup.contains(update)).toBe(true);
    expect(body.contains(update)).toBe(false);
  });

  it('lets a long notice and an error shrink beside the footer', () => {
    const ctrl = makeController({
      publishedUrl: 'https://share/abc', accessMode: 'public',
      notice: 'A long warning about the old link', error: 'Update failed',
    });
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Shared'));

    const body = screen.getByTestId('publish-menu-body');
    for (const text of ['A long warning about the old link', 'Update failed']) {
      const row = screen.getByText(text).closest('[role="alert"], [role="status"]') || screen.getByText(text);
      expect(body.contains(row)).toBe(false);
      const shell = [...screen.getByRole('dialog').children].find((el) => el.contains(row));
      expect(shell.className).toMatch(/\bmin-h-0\b/);
      expect(shell.className).toMatch(/\boverflow-y-auto\b/);
    }
  });
});

// The password field unfolds under its own option on a first share, and under
// the access dropdown on a change; it must still be the one the share is saved
// with.
describe('PublishMenu — password share', () => {
  it('publishes a new share with the typed password', async () => {
    const ctrl = makeController({ publish: vi.fn(async () => true) });
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Share'));
    fireEvent.click(screen.getByText('Password protected'));
    await userEvent.type(screen.getByPlaceholderText('Add a password'), 'hunter2');
    const buttons = screen.getAllByRole('button').filter((b) => /publish|share|save/i.test(b.textContent) && !b.disabled);
    fireEvent.click(buttons.at(-1));
    expect(ctrl.publish).toHaveBeenCalledWith(expect.objectContaining({ mode: 'password', password: 'hunter2' }), expect.anything());
  });

  it('changes a public share to a password one', async () => {
    const ctrl = makeController({ publishedUrl: 'https://share/abc', accessMode: 'public', publish: vi.fn(async () => true) });
    const user = userEvent.setup();
    render(<PublishMenu controller={ctrl} />);
    await user.click(screen.getByText('Shared'));
    await user.click(screen.getByTestId('access-dropdown'));
    await user.click(screen.getByRole('radio', { name: /^Password protected/ }));
    // The field shows under the dropdown, not among the options.
    const editor = screen.getByTestId('access-editor');
    await user.type(within(editor).getByPlaceholderText('Add a password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(ctrl.publish).toHaveBeenCalledWith(expect.objectContaining({ mode: 'password', password: 'hunter2' }), expect.anything());
  });
});
