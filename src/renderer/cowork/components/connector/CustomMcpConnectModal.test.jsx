import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const customMcpConnect = vi.hoisted(() => vi.fn());
const oauthCancel = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/host', () => ({ host: { customMcpConnect, oauthCancel } }));

import CustomMcpConnectModal, { CUSTOM_MCP_REDIRECT_URI } from './CustomMcpConnectModal';

const URL = 'https://mcp.example.com/mcp';

function renderModal(props = {}) {
  const onClose = vi.fn();
  const onConnected = vi.fn();
  render(<CustomMcpConnectModal open onClose={onClose} onConnected={onConnected} {...props} />);
  return { onClose, onConnected };
}

async function fill(user, { label = 'Tracker', url = URL } = {}) {
  await user.type(screen.getByLabelText(/^Name/), label);
  await user.type(screen.getByLabelText(/^Server URL/), url);
}

afterEach(() => {
  customMcpConnect.mockReset();
});

describe('CustomMcpConnectModal', () => {
  it('connects a server with no login and says how many tools are on', async () => {
    const user = userEvent.setup();
    customMcpConnect.mockResolvedValue({ ok: true, id: 'cm-1', label: 'Tracker', serverUrl: URL, toolsOn: 2, toolsUnavailable: false });
    const { onConnected } = renderModal();

    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(customMcpConnect).toHaveBeenCalledWith({ label: 'Tracker', url: URL });
    expect(await screen.findByText('Connected. 2 read-only tools are on.')).toBeTruthy();
    expect(onConnected).toHaveBeenCalledWith({ id: 'cm-1', label: 'Tracker' });
  });

  it('shows every login host before the browser opens, and sends them back on Continue', async () => {
    const user = userEvent.setup();
    customMcpConnect
      .mockResolvedValueOnce({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com', 'token.example.net'] })
      .mockResolvedValueOnce({ ok: true, id: 'cm-1', label: 'Tracker', serverUrl: URL, toolsOn: 1, toolsUnavailable: false });
    renderModal();

    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const hosts = await screen.findByRole('group', { name: 'Your login and its code will go to:' });
    expect(hosts.textContent).toContain('auth.example.com');
    expect(hosts.textContent).toContain('token.example.net');
    expect(customMcpConnect).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(customMcpConnect).toHaveBeenLastCalledWith({
      label: 'Tracker', url: URL, confirmedLoginHosts: ['auth.example.com', 'token.example.net'],
    });
    expect(await screen.findByText('Connected. 1 read-only tool is on.')).toBeTruthy();
  });

  it('goes back to the fields from the host list without connecting', async () => {
    const user = userEvent.setup();
    customMcpConnect.mockResolvedValue({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com'] });
    renderModal();

    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText(/^Server URL/)).toBeTruthy();
    expect(customMcpConnect).toHaveBeenCalledTimes(1);
  });

  it('sends a client ID and secret given under Advanced and shows the redirect URI', async () => {
    const user = userEvent.setup();
    customMcpConnect.mockResolvedValue({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com'] });
    renderModal();

    await fill(user);
    await user.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText(CUSTOM_MCP_REDIRECT_URI)).toBeTruthy();
    await user.type(screen.getByLabelText(/^Client ID/), 'my-client');
    await user.type(screen.getByLabelText(/^Client secret/), 'shh');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(customMcpConnect).toHaveBeenCalledWith({ label: 'Tracker', url: URL, clientId: 'my-client', clientSecret: 'shh' });
  });

  it('keeps Connect off until a name and URL are given, and for a secret with no client ID', async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByRole('button', { name: 'Connect' }).disabled).toBe(true);
    await fill(user);
    expect(screen.getByRole('button', { name: 'Connect' }).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: /Advanced/ }));
    await user.type(screen.getByLabelText(/^Client secret/), 'shh');
    expect(screen.getByRole('button', { name: 'Connect' }).disabled).toBe(true);
  });

  it.each([
    [{ code: 'not_public', reason: 'x' }, "This address isn't on the public internet, so Anton won't connect to it."],
    [{ code: 'proxy_network', reason: 'x' }, "This network only allows connections through a proxy, which MCP servers added by URL can't use."],
    [{ code: 'needs_client_id', reason: 'x' }, 'This server needs a client ID. Add one under Advanced.'],
    [{ code: 'login_failed', reason: 'cancelled' }, "The login didn't finish: cancelled"],
    [{ code: 'grant_refused', reason: 'the token endpoint answered 400: invalid_grant' }, "The login didn't finish: the token endpoint answered 400: invalid_grant"],
    [{ code: 'keychain_unavailable', reason: 'x' }, "The system keychain isn't available, so the connection can't be stored safely."],
    [{ code: 'not_mcp', reason: 'x' }, "This address didn't answer as an MCP server. Check that it's the server's MCP address."],
    [{ code: 'something_else', reason: 'it broke' }, "Couldn't connect the server: it broke"],
  ])('shows its own message for %j', async (refusal, message) => {
    const user = userEvent.setup();
    customMcpConnect.mockResolvedValue({ ok: false, ...refusal });
    renderModal();

    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText(/^Server URL/)).toBeTruthy();
  });

  it('cancels a login in progress', async () => {
    const user = userEvent.setup();
    let finish = () => {};
    customMcpConnect.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ ok: false, code: 'login_failed', reason: 'cancelled' });
    }));
    oauthCancel.mockImplementation(async () => finish());
    renderModal();

    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(oauthCancel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("The login didn't finish: cancelled")).toBeTruthy();
  });

  it('warns when the server could not list its tools', async () => {
    const user = userEvent.setup();
    customMcpConnect.mockResolvedValue({ ok: true, id: 'cm-1', label: 'Tracker', serverUrl: URL, toolsOn: 0, toolsUnavailable: true });
    renderModal();

    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/the server's tools could not be listed/)).toBeTruthy();
  });

  it('drops a typed secret once closed and opened again', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CustomMcpConnectModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Advanced/ }));
    await user.type(screen.getByLabelText(/^Client secret/), 'shh');

    rerender(<CustomMcpConnectModal open={false} onClose={vi.fn()} />);
    rerender(<CustomMcpConnectModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Advanced/ }));

    await waitFor(() => expect(screen.getByLabelText(/^Client secret/).value).toBe(''));
  });
});
