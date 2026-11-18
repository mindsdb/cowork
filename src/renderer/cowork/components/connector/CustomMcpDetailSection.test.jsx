import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  customMcpSummary: vi.fn(),
  customMcpTools: vi.fn(),
  customMcpSetTools: vi.fn(),
  customMcpReconnect: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({ host: bridge }));

import CustomMcpDetailSection from './CustomMcpDetailSection';

const CONNECTION = { engine: 'custom_mcp', name: `cm-${'a'.repeat(32)}` };
const TOOLS = [
  { name: 'search', description: 'Find issues', readOnly: true, allowed: true },
  { name: 'delete_issue', description: '', readOnly: false, allowed: false },
];

function renderSection(props = {}) {
  const onDisconnect = vi.fn(async () => true);
  const confirm = vi.fn(async () => true);
  render(<CustomMcpDetailSection connection={CONNECTION} onDisconnect={onDisconnect} confirm={confirm} {...props} />);
  return { onDisconnect, confirm };
}

beforeEach(() => {
  bridge.customMcpSummary.mockResolvedValue({ ok: true, label: 'Tracker', serverUrl: 'https://mcp.example.com/mcp' });
  bridge.customMcpTools.mockResolvedValue({ ok: true, tools: TOOLS });
});

afterEach(() => {
  for (const fn of Object.values(bridge)) fn.mockReset();
});

describe('CustomMcpDetailSection', () => {
  it('shows the held label and URL and every tool with its switch', async () => {
    renderSection();

    expect(await screen.findByText('Tracker')).toBeTruthy();
    expect(screen.getByText('https://mcp.example.com/mcp')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Let Anton use search' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('false');
    expect(bridge.customMcpSummary).toHaveBeenCalledWith(CONNECTION.name);
  });

  it('switches a tool on by sending the whole new list', async () => {
    bridge.customMcpSetTools.mockResolvedValue({ ok: true, tools: ['search', 'delete_issue'] });
    renderSection();

    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' }));

    expect(bridge.customMcpSetTools).toHaveBeenCalledWith(CONNECTION.name, ['search', 'delete_issue']);
    expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('true');
  });

  it('puts a switch back and says why when the change is refused', async () => {
    bridge.customMcpSetTools.mockResolvedValue({ ok: false, code: 'unavailable', reason: 'x' });
    renderSection();

    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use search' }));

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let Anton use search' }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText("MCP servers by URL aren't available right now. Restart the app and try again.")).toBeTruthy();
  });

  it('tells the user to reconnect when the server no longer accepts the login', async () => {
    bridge.customMcpTools.mockResolvedValue({ ok: false, code: 'token_rejected', reason: 'the server answered 409' });
    renderSection();

    expect(await screen.findByText('The server no longer accepts this login. Reconnect to sign in again.')).toBeTruthy();
  });

  it('says a refused switch was not a valid request, not a bad URL', async () => {
    bridge.customMcpSetTools.mockResolvedValue({ ok: false, code: 'invalid_request', reason: 'Tools must be a list of at most 500 names.' });
    renderSection();

    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' }));

    expect(await screen.findByText("That request isn't valid: Tools must be a list of at most 500 names.")).toBeTruthy();
  });

  it('says so when the server cannot list its tools', async () => {
    bridge.customMcpTools.mockResolvedValue({ ok: false, code: 'unreachable', reason: 'the server answered 502' });
    renderSection();

    expect(await screen.findByText("The server couldn't be reached. Try again later.")).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the login hosts before reconnecting, then reconnects with them', async () => {
    bridge.customMcpReconnect
      .mockResolvedValueOnce({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com'] })
      .mockResolvedValueOnce({ ok: true });
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    const hosts = await screen.findByRole('group', { name: 'Your login and its code will go to:' });
    expect(hosts.textContent).toContain('auth.example.com');
    expect(bridge.customMcpReconnect).toHaveBeenCalledWith(CONNECTION.name, undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(bridge.customMcpReconnect).toHaveBeenLastCalledWith(CONNECTION.name, ['auth.example.com']);
    expect(await screen.findByText('Reconnected. Your tool choices are kept.')).toBeTruthy();
  });

  it('keeps a switch made while the tools reload after a reconnect, then reloads', async () => {
    const both = [{ ...TOOLS[0] }, { ...TOOLS[1], allowed: true }];
    const added = [...TOOLS, { name: 'new_tool', description: 'Added later', readOnly: true, allowed: false }];
    let finishReload;
    bridge.customMcpTools
      .mockResolvedValueOnce({ ok: true, tools: both })
      .mockImplementationOnce(() => new Promise((resolve) => { finishReload = resolve; }))
      .mockResolvedValueOnce({ ok: true, tools: added });
    bridge.customMcpReconnect.mockResolvedValue({ ok: true });
    bridge.customMcpSetTools.mockResolvedValue({ ok: true });
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await screen.findByText('Reconnected. Your tool choices are kept.');
    await userEvent.click(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }));
    expect(bridge.customMcpSetTools).toHaveBeenLastCalledWith(CONNECTION.name, ['search']);
    // The reload read the switches before the user's change.
    finishReload({ ok: true, tools: both });

    // The dropped reload runs again once the switch is saved.
    expect(await screen.findByRole('switch', { name: 'Let Anton use new_tool' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('false');
    await userEvent.click(screen.getByRole('switch', { name: 'Let Anton use search' }));
    expect(bridge.customMcpSetTools).toHaveBeenLastCalledWith(CONNECTION.name, []);
  });

  it('holds a reload that starts while a switch is saving until it is saved', async () => {
    let finishSave;
    let finishReconnect;
    const saved = [{ ...TOOLS[0] }, { ...TOOLS[1], allowed: true }];
    bridge.customMcpTools
      .mockResolvedValueOnce({ ok: true, tools: TOOLS })
      .mockResolvedValue({ ok: true, tools: saved });
    bridge.customMcpReconnect.mockImplementation(() => new Promise((resolve) => { finishReconnect = resolve; }));
    bridge.customMcpSetTools.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; })).mockResolvedValue({ ok: true });
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }));
    finishReconnect({ ok: true });
    await screen.findByText('Reconnected. Your tool choices are kept.');
    // No reload reads the switches while the switch is still on its way.
    expect(bridge.customMcpTools).toHaveBeenCalledTimes(1);
    finishSave({ ok: true });

    await waitFor(() => expect(bridge.customMcpTools).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('true'));
    await userEvent.click(screen.getByRole('switch', { name: 'Let Anton use search' }));
    expect(bridge.customMcpSetTools).toHaveBeenLastCalledWith(CONNECTION.name, ['delete_issue']);
  });

  it('disconnects only once confirmed', async () => {
    const { onDisconnect, confirm } = renderSection();
    confirm.mockResolvedValueOnce(false);

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Disconnect Tracker?', destructive: true }));
    expect(onDisconnect).toHaveBeenCalledWith(CONNECTION);
  });
});
