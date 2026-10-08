import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectionCard from './ConnectionCard';

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
    vi.stubGlobal('confirm', vi.fn(() => true));
    let resolve;
    const onDelete = vi.fn(() => new Promise(r => { resolve = r; }));
    const onModify = vi.fn();
    render(<ConnectionCard connection={connection} onModify={onModify} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', {name:'Disconnect'}));
    expect(window.confirm).toHaveBeenCalledWith('Disconnect github/ianu82?');
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(connection);
    expect(onModify).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name:'Removing…'})).toBeDisabled();
    expect(screen.getByRole('button', {name:'Manage GitHub: ianu82'})).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', {name:'Disconnect'})).toBeEnabled());
  });

  it('leaves the connection untouched when the user cancels', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const onDelete = vi.fn();
    render(<ConnectionCard connection={connection} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', {name:'Disconnect'}));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name:'Disconnect'})).toBeEnabled();
  });
});

describe('ConnectionCard for custom and legacy connectors', () => {
  it('shows a custom connector by its own name, initials in its color and a Custom badge', () => {
    const { container } = render(<ConnectionCard connection={{
      engine: 'kinaxis', name: 'kinaxis-1a2b3c4d', label: 'Kinaxis RapidResponse', custom: true, logo_color: '#3a7',
    }} />);
    expect(screen.getByText('Kinaxis RapidResponse')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    const initials = screen.getByText('KR');
    expect(initials).toHaveStyle({ color: '#3a7' });
    expect(container.querySelector('img')).toBeNull();
  });

  it('names a legacy generated-id connection plainly and says how to repair it', () => {
    render(<ConnectionCard connection={{ engine: 'fm_ec163d25cf', name: 'fm_ec163d25cf-2cf3a6' }} />);
    expect(screen.getByText('Unrecognized connector')).toBeInTheDocument();
    expect(screen.getByText('Saved by an older version. Disconnect it and connect again.')).toBeInTheDocument();
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
  });

  it('tells a screen reader the card is custom, or how to repair a legacy one', () => {
    const { unmount } = render(<ConnectionCard
      connection={{ engine: 'kinaxis', name: 'kinaxis-1a2b3c4d', label: 'Kinaxis', custom: true }}
      onModify={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: 'Manage Kinaxis (custom connector): kinaxis-1a2b3c4d' })).toBeInTheDocument();
    unmount();

    render(<ConnectionCard connection={{ engine: 'fm_ec163d25cf', name: 'fm_ec163d25cf-2cf3a6' }} onModify={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Disconnect it and connect again/ })).toBeInTheDocument();
  });

  it('adds neither to a built-in connection', () => {
    render(<ConnectionCard connection={connection} />);
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
    expect(screen.queryByText(/Saved by an older version/)).not.toBeInTheDocument();
  });
});
