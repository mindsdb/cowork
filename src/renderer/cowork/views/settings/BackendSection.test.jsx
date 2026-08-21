import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({
  isWeb: false,
  serverDiagnostics: vi.fn(async () => ({ port: 26866, lastStartAt: null })),
  getCustomServer: vi.fn(async () => ({ url: null, token: null })),
  setCustomServer: vi.fn(async () => true),
  restartApp: vi.fn(async () => {}),
  getLocalAuth: vi.fn(async () => ({ enabled: false, token: null })),
  setLocalAuth: vi.fn(async () => ({ ok: true, enabled: true, token: 'a'.repeat(32) })),
}));
vi.mock('../../../platform/host', () => ({ host: hostMock }));

import BackendSection from './BackendSection';

describe('BackendSection — server URL + API key', () => {
  beforeEach(() => {
    hostMock.getCustomServer.mockClear().mockResolvedValue({ url: null, token: null });
    hostMock.setCustomServer.mockClear().mockResolvedValue(true);
    hostMock.restartApp.mockClear();
    hostMock.serverDiagnostics.mockClear().mockResolvedValue({ port: 26866, lastStartAt: null });
    hostMock.getLocalAuth.mockClear().mockResolvedValue({ enabled: false, token: null });
    hostMock.setLocalAuth.mockClear().mockResolvedValue({ ok: true, enabled: true, token: 'a'.repeat(32) });
  });

  it('shows the local server/key line with Edit at the end, and Started as plain text', async () => {
    hostMock.serverDiagnostics.mockResolvedValue({ port: 26866, lastStartAt: '2026-01-01T00:00:00Z' });
    render(<BackendSection serverOnline />);
    await waitFor(() => expect(hostMock.getCustomServer).toHaveBeenCalled());

    expect(screen.getByText('MindsHub backend is running')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:26866')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit server settings' })).toBeInTheDocument();
    expect(screen.getByText(/^Started /)).toBeInTheDocument();
    // Fields are hidden until Edit is clicked.
    expect(screen.queryByLabelText('Server URL')).not.toBeInTheDocument();
  });

  it('saves a custom server URL/API key and shows the restart banner', async () => {
    const user = userEvent.setup();
    render(<BackendSection serverOnline />);
    await waitFor(() => expect(hostMock.getCustomServer).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Edit server settings' }));
    await user.type(screen.getByLabelText('Server URL'), 'http://127.0.0.1:27866');
    await user.type(screen.getByLabelText('API key'), 'test-token-12345');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(hostMock.setCustomServer).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:27866',
      token: 'test-token-12345',
    }));
    expect(await screen.findByText(/Restart the app to connect/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(hostMock.restartApp).toHaveBeenCalled();
  });

  it('shows the saved server + masked key and hides local status once a custom server is configured', async () => {
    hostMock.getCustomServer.mockResolvedValue({ url: 'http://127.0.0.1:27866', token: 'test-token-12345' });
    render(<BackendSection serverOnline />);

    expect(await screen.findByText('http://127.0.0.1:27866')).toBeInTheDocument();
    expect(screen.getByText('•'.repeat('test-token-12345'.length))).toBeInTheDocument();
    expect(screen.queryByText('MindsHub backend is running')).not.toBeInTheDocument();
    expect(screen.getByText(/pointed at a server it didn't spawn/)).toBeInTheDocument();
  });

  it('reverts to the local server by clearing the URL field and saving', async () => {
    hostMock.getCustomServer.mockResolvedValue({ url: 'http://127.0.0.1:27866', token: 'test-token-12345' });
    const user = userEvent.setup();
    render(<BackendSection serverOnline />);
    await screen.findByText('http://127.0.0.1:27866');

    await user.click(screen.getByRole('button', { name: 'Edit server settings' }));
    const urlField = screen.getByLabelText('Server URL');
    await user.clear(urlField);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(hostMock.setCustomServer).toHaveBeenCalledWith({ url: null, token: 'test-token-12345' }));
    expect(await screen.findByText(/Restart the app to connect/)).toBeInTheDocument();
  });

  it('discards edits on Cancel', async () => {
    const user = userEvent.setup();
    render(<BackendSection serverOnline />);
    await waitFor(() => expect(hostMock.getCustomServer).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Edit server settings' }));
    await user.type(screen.getByLabelText('Server URL'), 'http://127.0.0.1:27866');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Server URL')).not.toBeInTheDocument();
    expect(hostMock.setCustomServer).not.toHaveBeenCalled();
  });
});

describe('BackendSection — local server auth toggle', () => {
  beforeEach(() => {
    hostMock.getCustomServer.mockClear().mockResolvedValue({ url: null, token: null });
    hostMock.restartApp.mockClear();
    hostMock.serverDiagnostics.mockClear().mockResolvedValue({ port: 26866, lastStartAt: null });
    hostMock.getLocalAuth.mockClear().mockResolvedValue({ enabled: false, token: null });
    hostMock.setLocalAuth.mockClear().mockResolvedValue({ ok: true, enabled: true, token: 'a'.repeat(32) });
  });

  it('shows an unchecked "Enable auth key" checkbox when local auth is off', async () => {
    render(<BackendSection serverOnline />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Enable auth key' });
    expect(checkbox).not.toBeChecked();
  });

  it('enables local auth on check, and shows the masked key once it lands', async () => {
    const user = userEvent.setup();
    render(<BackendSection serverOnline />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Enable auth key' });

    await user.click(checkbox);

    await waitFor(() => expect(hostMock.setLocalAuth).toHaveBeenCalledWith(true));
    expect(await screen.findByText('•'.repeat(16))).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  it('disables local auth on uncheck', async () => {
    hostMock.getLocalAuth.mockResolvedValue({ enabled: true, token: 'a'.repeat(32) });
    hostMock.setLocalAuth.mockResolvedValue({ ok: true, enabled: false, token: null });
    const user = userEvent.setup();
    render(<BackendSection serverOnline />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Enable auth key' });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    await waitFor(() => expect(hostMock.setLocalAuth).toHaveBeenCalledWith(false));
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it('does not show the local auth checkbox once a custom server is configured', async () => {
    hostMock.getCustomServer.mockResolvedValue({ url: 'http://127.0.0.1:27866', token: 'test-token-12345' });
    render(<BackendSection serverOnline />);
    await screen.findByText('http://127.0.0.1:27866');

    expect(screen.queryByRole('checkbox', { name: 'Enable auth key' })).not.toBeInTheDocument();
  });
});
