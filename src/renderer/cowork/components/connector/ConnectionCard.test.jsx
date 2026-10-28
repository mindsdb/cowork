import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectionCard, { ConnectionRow } from './ConnectionCard';

const connection = { engine: 'github', label: 'GitHub', name: 'ianu82', display_name: 'ianu82' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ConnectionCard', () => {
  it('uses a bundled app logo and a text-labelled healthy state', () => {
    const { container } = render(<ConnectionCard connection={connection} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'logos/github.svg');
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('ianu82')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('keeps the app logo when reconnection is needed; never labels it connected', () => {
    const { container } = render(<ConnectionCard connection={{ ...connection, status: 'needs_reconnect' }} onModify={vi.fn()} />);
    expect(container.querySelector('img')).toBeInTheDocument();
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect GitHub: ianu82' })).toBeInTheDocument();
  });

  it.each([
    ['card', ConnectionCard],
    ['row', ConnectionRow],
  ])('never names a managed %s that needs reconnecting Reconnect', async (_, Item) => {
    // How a connection someone else shares reaches the caller once its access expires.
    const managed = { ...connection, managed: true, shared: true, status: 'needs_reconnect' };
    const onModify = vi.fn();
    render(<Item connection={managed} onModify={onModify} />);
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reconnect/ })).not.toBeInTheDocument();
    // Its details open read-only, with no Reconnect of their own.
    await userEvent.click(screen.getByRole('button', { name: 'View GitHub: ianu82' }));
    expect(onModify).toHaveBeenCalledExactlyOnceWith(managed);
  });

  it("names the creator's own shared connection that needs reconnecting Reconnect", () => {
    render(<ConnectionCard connection={{ ...connection, shared: true, status: 'needs_reconnect' }} onModify={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reconnect GitHub: ianu82' })).toBeInTheDocument();
  });

  it('does not present unfamiliar explicit statuses as healthy', () => {
    const { container } = render(<ConnectionCard connection={{ ...connection, status: 'unavailable' }} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(container.querySelector('[class*="bg-[var(--success)]"]')).toBeNull();
  });

  it('does not present a blank-but-present status as healthy', () => {
    const { container } = render(<ConnectionCard connection={{ ...connection, status: '' }} />);
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="bg-[var(--success)]"]')).toBeNull();
  });

  it.each(['../private', '..\\private', '/github', 'https://example.com/icon', 'github?x=1', 'github#icon', '%2e%2e%2fprivate'])('does not construct a logo URL from an unsafe engine: %s', (engine) => {
    const { container } = render(<ConnectionCard connection={{ engine, label: 'Private connector', name: 'one' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('falls back to an initial when a safe connector ID has no public logo', () => {
    const { container } = render(<ConnectionCard connection={{ engine: 'private_connector_2', label: 'Private connector', name: 'one' }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'logos/private_connector_2.svg');
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('recovers from a failed image and retries when the connector changes', () => {
    const { container, rerender } = render(<ConnectionCard connection={connection} />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('G')).toBeInTheDocument();
    rerender(<ConnectionCard connection={{engine:'linear',label:'Linear',name:'work'}} />);
    expect(container.querySelector('img').getAttribute('src')).toContain('linear.svg');
  });

  it.each(['{Enter}', ' '])('opens details using native keyboard activation: %s', async (key) => {
    const onModify = vi.fn();
    render(<ConnectionCard connection={connection} onModify={onModify} />);
    const button = screen.getByRole('button', {name:'Manage GitHub: ianu82'});
    button.focus();
    await userEvent.keyboard(key);
    expect(onModify).toHaveBeenCalledExactlyOnceWith(connection);
  });

  it('disconnects only the selected connection, without opening its details', async () => {
    let resolve;
    const onDelete = vi.fn(() => new Promise(r => { resolve = r; }));
    const onModify = vi.fn();
    render(<ConnectionCard connection={connection} onModify={onModify} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', {name:'Disconnect'}));

    // The card's own button only asks; nothing is deleted until the dialog is
    // answered.
    const confirm = await screen.findByRole('dialog', {name:/Disconnect GitHub\?/i});
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', {name:'Disconnect'}));

    expect(onDelete).toHaveBeenCalledExactlyOnceWith(connection);
    expect(onModify).not.toHaveBeenCalled();
    // The dialog owns the in-flight state now: it says what is happening and
    // its disabled button is what stops a second delete.
    expect(within(confirm).getByRole('button', {name:'Disconnecting…'})).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', {name:'Disconnect'})).toBeEnabled());
  });

  it('leaves the connection untouched when the user cancels', async () => {
    const onDelete = vi.fn();
    render(<ConnectionCard connection={connection} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', {name:'Disconnect'}));

    const confirm = await screen.findByRole('dialog', {name:/Disconnect GitHub\?/i});
    await userEvent.click(within(confirm).getByRole('button', {name:'Cancel'}));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name:'Disconnect'})).toBeEnabled();
  });

  it('answers a failed disconnect in the dialog rather than silently', async () => {
    const onDelete = vi.fn(() => Promise.reject(new Error('the relay refused')));
    render(<ConnectionCard connection={connection} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', {name:'Disconnect'}));

    const confirm = await screen.findByRole('dialog', {name:/Disconnect GitHub\?/i});
    await userEvent.click(within(confirm).getByRole('button', {name:'Disconnect'}));

    expect(await within(confirm).findByText('the relay refused')).toBeInTheDocument();
  });

  it('names a database connection by what removing it costs', async () => {
    const datasource = { ...connection, __datasource__: true, engine: 'postgres', name: 'Analytics' };
    render(<ConnectionCard connection={datasource} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', {name:'Disconnect'}));

    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText(/stored credentials deleted/i)).toBeInTheDocument();
  });

  it.each([
    // The operator's own connection, which no person created.
    ['card', ConnectionCard, { ...connection, managed: true }, 'Managed', 'Shared'],
    ['row', ConnectionRow, { ...connection, managed: true }, 'Managed', 'Shared'],
    // How a connection someone else shares reaches the caller.
    ['card shared with the caller', ConnectionCard, { ...connection, managed: true, shared: true }, 'Shared', 'Managed'],
    ['row shared with the caller', ConnectionRow, { ...connection, managed: true, shared: true }, 'Shared', 'Managed'],
  ])('shows a managed connection as a read-only %s with its badge and no Disconnect', async (_, Item, managed, badge, otherBadge) => {
    const onModify = vi.fn();
    render(<Item connection={managed} onModify={onModify} onDelete={vi.fn()} />);
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.queryByText(otherBadge)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    // The details still open, read-only, from the item itself, named View.
    expect(screen.queryByRole('button', { name: /^Manage/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View GitHub: ianu82' }));
    expect(onModify).toHaveBeenCalledExactlyOnceWith(managed);
  });

  it.each([
    ['card', ConnectionCard, { ...connection, shared: true }],
    ['row', ConnectionRow, { ...connection, shared: true }],
    ['card with managed false', ConnectionCard, { ...connection, shared: true, managed: false }],
  ])("shows the creator's own shared connection as a %s with a Shared badge and Disconnect", async (_, Item, shared) => {
    const onDelete = vi.fn();
    render(<Item connection={shared} onModify={vi.fn()} onDelete={onDelete} />);
    expect(screen.getByText('Shared')).toBeInTheDocument();
    expect(screen.queryByText('Managed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage GitHub: ianu82' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Disconnect' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(shared);
  });

  it.each([
    ['card', ConnectionCard],
    ['row', ConnectionRow],
  ])("says before a %s disconnects the creator's own shared connection that everyone loses it and its name stays taken", async (_, Item) => {
    const onDelete = vi.fn();
    render(<Item connection={{ ...connection, shared: true }} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText(
      /It's shared, so everyone it's shared with loses it too\. A new connection can't use its name until your operator stops sharing it\./,
    )).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it.each([
    ['with shared false', { ...connection, shared: false }],
    ['with a non-boolean shared value', { ...connection, shared: 'true' }],
  ])('asks only the plain question before disconnecting a connection %s', async (_, conn) => {
    render(<ConnectionCard connection={conn} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).queryByText(/It's shared/)).not.toBeInTheDocument();
  });

  it.each([
    ['without either field', connection],
    ['with managed false', { ...connection, managed: false }],
    ['with a non-boolean managed value', { ...connection, managed: 'true' }],
    ['with shared false', { ...connection, shared: false }],
    ['with a non-boolean shared value', { ...connection, shared: 'true' }],
  ])('keeps Disconnect and no badge for a connection %s', (_, conn) => {
    render(<ConnectionCard connection={conn} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.queryByText('Managed')).not.toBeInTheDocument();
    expect(screen.queryByText('Shared')).not.toBeInTheDocument();
  });

  it('renders the same content and actions as a list row', async () => {
    const onModify = vi.fn();
    render(<ConnectionRow connection={connection} onModify={onModify} />);
    expect(screen.getByText('ianu82')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Manage GitHub: ianu82' }));
    expect(onModify).toHaveBeenCalledExactlyOnceWith(connection);
  });
});
