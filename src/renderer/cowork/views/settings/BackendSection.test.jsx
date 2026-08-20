import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({
  isWeb: false,
  serverDiagnostics: vi.fn(async () => ({ port: 26866, lastStartAt: null })),
  getCustomServer: vi.fn(async () => ({ url: null, token: null })),
  setCustomServer: vi.fn(async () => true),
  restartApp: vi.fn(async () => {}),
}));
vi.mock('../../../platform/host', () => ({ host: hostMock }));

import BackendSection from './BackendSection';

describe('BackendSection — custom server (Advanced)', () => {
  beforeEach(() => {
    hostMock.getCustomServer.mockClear().mockResolvedValue({ url: null, token: null });
    hostMock.setCustomServer.mockClear().mockResolvedValue(true);
    hostMock.restartApp.mockClear();
  });

  it('shows the local Status card and an Advanced toggle when no custom server is configured', async () => {
    render(<BackendSection serverOnline />);
    await waitFor(() => expect(hostMock.getCustomServer).toHaveBeenCalled());

    expect(screen.getByText('MindsHub backend is running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advanced: Custom Server/ })).toBeInTheDocument();
    // Fields are collapsed by default.
    expect(screen.queryByLabelText('Server URL')).not.toBeInTheDocument();
  });

  it('saves a custom server URL/token and shows the restart banner', async () => {
    const user = userEvent.setup();
    render(<BackendSection serverOnline />);
    await waitFor(() => expect(hostMock.getCustomServer).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Advanced: Custom Server/ }));
    await user.type(screen.getByLabelText('Server URL'), 'http://127.0.0.1:27866');
    await user.type(screen.getByLabelText('Bearer token'), 'test-token-12345');
    await user.click(screen.getByRole('button', { name: 'Save & Restart' }));

    await waitFor(() => expect(hostMock.setCustomServer).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:27866',
      token: 'test-token-12345',
    }));
    expect(await screen.findByText(/Restart the app to connect/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(hostMock.restartApp).toHaveBeenCalled();
  });

  it('hides the local Status card and shows only the custom-server fields once one is configured', async () => {
    hostMock.getCustomServer.mockResolvedValue({ url: 'http://127.0.0.1:27866', token: 'test-token-12345' });
    render(<BackendSection serverOnline />);

    expect(await screen.findByLabelText('Server URL')).toHaveValue('http://127.0.0.1:27866');
    expect(screen.getByLabelText('Bearer token')).toHaveValue('test-token-12345');
    expect(screen.queryByText('MindsHub backend is running')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use local server instead' })).toBeInTheDocument();
  });

  it('reverts to the local server on "Use local server instead"', async () => {
    hostMock.getCustomServer.mockResolvedValue({ url: 'http://127.0.0.1:27866', token: 'test-token-12345' });
    const user = userEvent.setup();
    render(<BackendSection serverOnline />);
    await screen.findByLabelText('Server URL');

    await user.click(screen.getByRole('button', { name: 'Use local server instead' }));

    await waitFor(() => expect(hostMock.setCustomServer).toHaveBeenCalledWith({ url: null, token: null }));
    expect(await screen.findByText(/Restart the app to connect/)).toBeInTheDocument();
  });
});
