import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  customMcpSummary: vi.fn(),
  customMcpTools: vi.fn(),
  customMcpSetTools: vi.fn(),
  customMcpReconnect: vi.fn(),
}));
const shell = vi.hoisted(() => ({ isWeb: false }));
vi.mock('../../../platform/host', () => ({ host: { ...bridge, get isWeb() { return shell.isWeb; } } }));

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
  shell.isWeb = false;
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

  it('puts a switch back and names the tool limit when too many tools would be on', async () => {
    bridge.customMcpSetTools.mockResolvedValue({ ok: false, code: 'too_many_tools', reason: 'auth text' });
    renderSection();

    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' }));

    expect(await screen.findByText('You can have at most 100 tools switched on across your MCP servers. Switch some off first.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('false');
  });

  it('reloads the tools when a switch is refused for a changed list, so the next switch is saved', async () => {
    bridge.customMcpSetTools
      .mockResolvedValueOnce({ ok: false, code: 'stale_revision', reason: 'The tool list changed.' })
      .mockResolvedValueOnce({ ok: true, tools: ['search', 'delete_issue'] });
    renderSection();

    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' }));

    expect(await screen.findByText("The tool list changed. It's been reloaded; try the switch again.")).toBeTruthy();
    await waitFor(() => expect(bridge.customMcpTools).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('false');

    await userEvent.click(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }));
    expect(bridge.customMcpSetTools).toHaveBeenLastCalledWith(CONNECTION.name, ['search', 'delete_issue']);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('true'));
  });

  it('says so when the server cannot list its tools', async () => {
    bridge.customMcpTools.mockResolvedValue({ ok: false, code: 'unreachable', reason: 'the server answered 502' });
    renderSection();

    expect(await screen.findByText("The server couldn't be reached. Try again later.")).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the stored tools when the list could not be refreshed, and their switches still work', async () => {
    bridge.customMcpTools.mockResolvedValue({ ok: true, tools: TOOLS, stale: true, staleCode: 'upstream_unavailable' });
    bridge.customMcpSetTools.mockResolvedValue({ ok: true, tools: ['search', 'delete_issue'] });
    renderSection();

    expect(await screen.findByText("The tool list couldn't be refreshed. These are the tools last listed, and their switches still work.")).toBeTruthy();
    expect(screen.queryByText("This server's tool list is too large to read.")).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }));

    expect(bridge.customMcpSetTools).toHaveBeenCalledWith(CONNECTION.name, ['search', 'delete_issue']);
  });

  it('says the tool list is too large to read', async () => {
    bridge.customMcpTools.mockResolvedValue({ ok: true, tools: TOOLS, stale: true, staleCode: 'listing_too_large' });
    renderSection();

    expect(await screen.findByText("This server's tool list is too large to read.")).toBeTruthy();
  });

  it('says why a tool was switched off, and keeps a tool Anton cannot use off', async () => {
    bridge.customMcpTools.mockResolvedValue({
      ok: true,
      tools: [
        { name: 'edit', description: '', readOnly: false, allowed: false, usable: true, reason: 'read_only_removed' },
        { name: 'big', description: '', readOnly: true, allowed: false, usable: true, reason: 'size_ceiling' },
        { name: 'changed', description: '', readOnly: true, allowed: false, usable: true, reason: 'definition_changed' },
        { name: 'extra', description: '', readOnly: true, allowed: false, usable: true, reason: 'count_ceiling' },
        { name: 'odd', description: '', readOnly: true, allowed: false, usable: false, reason: 'schema' },
      ],
    });
    renderSection();

    expect(await screen.findByText('Switched off: the server no longer marks this tool as read-only.')).toBeTruthy();
    expect(screen.getByText('Switched off: the tools you have on reached their size limit.')).toBeTruthy();
    expect(screen.getByText("Switched off: the server changed this tool's description or inputs. Review it and switch it back on.")).toBeTruthy();
    expect(screen.getByText('Switched off: you can have at most 100 tools switched on across your MCP servers.')).toBeTruthy();
    expect(screen.getByText("Anton can't use this tool.")).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Let Anton use odd' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Let Anton use edit' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('names the server by its label when the host holds no summary', async () => {
    bridge.customMcpSummary.mockResolvedValue({ ok: false, code: 'unavailable', reason: 'x' });
    renderSection({ connection: { ...CONNECTION, user_label: 'Tracker on the web' } });

    expect(await screen.findByText('Tracker on the web')).toBeTruthy();
  });

  it('shows the connection\'s server URL when the host holds no summary', async () => {
    shell.isWeb = true;
    bridge.customMcpSummary.mockResolvedValue({ ok: false, code: 'unavailable', reason: 'x' });
    renderSection({ connection: { ...CONNECTION, user_label: 'Tracker on the web', server_url: 'https://mcp.example.com/web' } });

    expect(await screen.findByText('Tracker on the web')).toBeTruthy();
    expect(screen.getByText('https://mcp.example.com/web')).toBeTruthy();
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

  it('a panel opened again while a switch still saves reads after the switch lands', async () => {
    let serverAllowed = ['search'];
    let finishSave;
    bridge.customMcpTools.mockImplementation(async () => ({
      ok: true, tools: TOOLS.map((tool) => ({ ...tool, allowed: serverAllowed.includes(tool.name) })),
    }));
    bridge.customMcpSetTools.mockImplementationOnce((_name, tools) => new Promise((resolve) => {
      finishSave = () => { serverAllowed = tools; resolve({ ok: true }); };
    }));
    const first = render(<CustomMcpDetailSection connection={CONNECTION} onDisconnect={vi.fn()} confirm={vi.fn()} />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' }));
    first.unmount();

    render(<CustomMcpDetailSection connection={CONNECTION} onDisconnect={vi.fn()} confirm={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.customMcpTools).toHaveBeenCalledTimes(1);
    finishSave();

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('true'));
    expect(bridge.customMcpTools).toHaveBeenCalledTimes(2);
  });

  it('a panel opened again shows its tools when the old panel\'s save fails outright', async () => {
    let failSave;
    bridge.customMcpSetTools.mockImplementationOnce(() => new Promise((_resolve, reject) => { failSave = reject; }));
    const first = render(<CustomMcpDetailSection connection={CONNECTION} onDisconnect={vi.fn()} confirm={vi.fn()} />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' }));
    first.unmount();

    render(<CustomMcpDetailSection connection={CONNECTION} onDisconnect={vi.fn()} confirm={vi.fn()} />);
    // The label does not wait for the switch.
    expect(await screen.findByText('Tracker')).toBeTruthy();
    failSave(new Error('ipc failed'));

    expect(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' })).toBeTruthy();
  });

  it('puts a switch back when its save fails outright', async () => {
    bridge.customMcpSetTools.mockRejectedValueOnce(new Error('ipc failed'));
    renderSection();

    await userEvent.click(await screen.findByRole('switch', { name: 'Let Anton use delete_issue' }));

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }).getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByText("Couldn't connect the server: the app did not answer")).toBeTruthy();
  });

  it('starts nothing when a reconnect answers after the panel closed', async () => {
    let finishReconnect;
    bridge.customMcpReconnect.mockImplementation(() => new Promise((resolve) => { finishReconnect = resolve; }));
    const { unmount } = render(<CustomMcpDetailSection connection={CONNECTION} onDisconnect={vi.fn()} confirm={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));

    unmount();
    finishReconnect({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridge.customMcpTools).toHaveBeenCalledTimes(1);
    expect(bridge.customMcpSummary).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when a switch answers after the panel closed', async () => {
    let finishSave;
    let finishReload;
    bridge.customMcpTools
      .mockResolvedValueOnce({ ok: true, tools: TOOLS })
      .mockImplementationOnce(() => new Promise((resolve) => { finishReload = resolve; }));
    bridge.customMcpReconnect.mockResolvedValue({ ok: true });
    bridge.customMcpSetTools.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const { unmount } = render(<CustomMcpDetailSection connection={CONNECTION} onDisconnect={vi.fn()} confirm={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await screen.findByText('Reconnected. Your tool choices are kept.');
    // The switch drops the reload in flight and owes one once saved.
    await userEvent.click(screen.getByRole('switch', { name: 'Let Anton use delete_issue' }));

    unmount();
    finishReload({ ok: true, tools: TOOLS });
    finishSave({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridge.customMcpTools).toHaveBeenCalledTimes(2);
  });

  it('disconnects only once confirmed', async () => {
    const { onDisconnect, confirm } = renderSection();
    confirm.mockResolvedValueOnce(false);

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Disconnect Tracker?', destructive: true }));
    expect(confirm.mock.lastCall[0].message).toContain('removed from this computer');
    expect(onDisconnect).toHaveBeenCalledWith(CONNECTION);
  });

  it('does not say the web disconnect removes anything from this computer', async () => {
    shell.isWeb = true;
    const { confirm } = renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Anton stops using this server, its login is revoked where the server allows it, and its settings are deleted.',
    }));
  });
});
