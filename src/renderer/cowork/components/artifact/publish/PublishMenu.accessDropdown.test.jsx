// The access card of a published artifact is a dropdown (ENG-4455): it opens
// the access options, and picking another one starts the change.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublishMenu } from './PublishMenu';

function makeController(overrides = {}) {
  return {
    publishedUrl: 'https://share/abc',
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
    publish: vi.fn(async () => true),
    unpublish: vi.fn(),
    activate: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

const dropdown = () => screen.getByTestId('access-dropdown');
const update = () => screen.queryByRole('button', { name: 'Update' });

describe('PublishMenu — the access dropdown', () => {
  it('opens the options, and a pick closes them on the access view with Update', async () => {
    const user = userEvent.setup();
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    await user.click(screen.getByText('Shared'));

    // Closed, it names the live access.
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Public');
    expect(screen.queryByRole('radio')).toBeNull();
    await user.click(dropdown());
    expect(screen.getByRole('radio', { name: /^Public/ })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: /^Only me/ }));
    // The options close; the access view drafts the pick, with Dismiss and Update.
    expect(screen.queryByRole('radio')).toBeNull();
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Only me');
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
    expect(update()).toBeEnabled();
    expect(ctrl.publish).not.toHaveBeenCalled();

    await user.click(update());
    expect(ctrl.publish).toHaveBeenCalledWith(expect.objectContaining({ mode: 'restricted', owner_only: true }));
  });

  it('switches again from the access view, and Dismiss drops the draft', async () => {
    const user = userEvent.setup();
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    await user.click(screen.getByText('Shared'));
    await user.click(dropdown());
    await user.click(screen.getByRole('radio', { name: /^Password protected/ }));
    expect(within(screen.getByTestId('access-editor')).getByPlaceholderText('Add a password')).toBeInTheDocument();

    await user.click(dropdown());
    await user.click(screen.getByRole('radio', { name: /^Specific people/ }));
    // The field follows the pick: the people now, not the password.
    const editor = screen.getByTestId('access-editor');
    expect(within(editor).getByRole('combobox', { name: 'Add people by email' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Add a password')).toBeNull();

    await user.click(screen.getByText('Dismiss'));
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Public');
    expect(update()).toBeNull();
    expect(ctrl.publish).not.toHaveBeenCalled();
  });

  it('does nothing when the current access is picked again', async () => {
    const user = userEvent.setup();
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    await user.click(screen.getByText('Shared'));
    await user.click(dropdown());
    await user.click(screen.getByRole('radio', { name: /^Public/ }));

    // Still the summary: no access view, nothing to save.
    expect(screen.getByTestId('access-summary')).toBeInTheDocument();
    expect(screen.queryByText('Dismiss')).toBeNull();
    expect(screen.queryByTestId('access-editor')).toBeNull();
    expect(update()).toBeNull();
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Public');
    expect(ctrl.publish).not.toHaveBeenCalled();
  });

  // Only a list has people to edit; any other access changes from the dropdown.
  it.each([
    ['Public', {}],
    ['Password protected', { accessMode: 'password', accessPassword: 'pw' }],
    ['Only me', { accessMode: 'restricted', ownerOnly: true }],
    ['Everyone at Acme', {
      accessMode: 'restricted', orgAllowed: true,
      orgSharing: { capabilities: { enabled: true }, teams: { status: 'ready', reachable: true, teams: [] }, orgName: 'Acme' },
    }],
  ])('offers no Edit list on %s', async (title, over) => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController(over)} />);
    await user.click(screen.getByText(/^Shared?$/));

    expect(dropdown()).toHaveAccessibleName(`Who can access your app: ${title}`);
    expect(screen.queryByText('Edit list')).toBeNull();
  });

  it('offers Edit list on a Specific list, opening the access view on its people', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ accessMode: 'restricted', accessEmails: ['alice@x.com'] })} />);
    await user.click(screen.getByText('Shared'));
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Specific people');

    await user.click(screen.getByText('Edit list'));
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Specific people');
    expect(within(screen.getByTestId('access-editor')).getByRole('list', { name: 'Recipients' })).toHaveTextContent('alice@x.com');
    // Unchanged: nothing to save yet.
    expect(update()).toBeNull();
  });
});
