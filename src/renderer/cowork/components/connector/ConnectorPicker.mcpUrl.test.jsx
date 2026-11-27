// Adding an MCP server by URL from the directory: offered only when the host
// says custom MCP servers can be added. On desktop that is main, never in org
// mode; on the web it is cowork-server's config, which only org mode offers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setOrgMode } from '../../../lib/orgMode';

const fetchConnectors = vi.fn();
const fetchCanBuildCustomConnector = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
  fetchCanBuildCustomConnector: (...args) => fetchCanBuildCustomConnector(...args),
}));
const customMcpAvailable = vi.hoisted(() => vi.fn());
const shell = vi.hoisted(() => ({ isWeb: false, isMobileShell: false }));
vi.mock('../../../platform/host', () => ({
  host: {
    openExternal: vi.fn(),
    customMcpAvailable,
    get isWeb() { return shell.isWeb; },
    get isMobileShell() { return shell.isMobileShell; },
  },
}));

import ConnectorPicker from './ConnectorPicker';

const GMAIL = { id: 'gmail', label: 'Gmail', category: 'communication', featured: true };
const TILE = /^Add an MCP server by URL/;

async function openWith(props = {}) {
  fetchConnectors.mockResolvedValue([GMAIL]);
  const onAddMcpUrl = vi.fn();
  render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} onBuildCustom={vi.fn()} onAddMcpUrl={onAddMcpUrl} {...props} />);
  await screen.findAllByText('Gmail', { exact: false });
  return onAddMcpUrl;
}

beforeEach(() => {
  fetchCanBuildCustomConnector.mockResolvedValue(true);
  customMcpAvailable.mockResolvedValue(true);
});

afterEach(() => {
  setOrgMode(false);
  shell.isWeb = false;
  shell.isMobileShell = false;
  fetchConnectors.mockReset();
  fetchCanBuildCustomConnector.mockReset();
  customMcpAvailable.mockReset();
});

describe('ConnectorPicker add an MCP server by URL', () => {
  it('offers the tile beside the build tile and opens the form from it', async () => {
    const onAddMcpUrl = await openWith();

    await userEvent.click(await screen.findByRole('button', { name: TILE }));

    expect(onAddMcpUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^Build a custom connector Connect/ })).toBeTruthy();
  });

  it('never asks or offers it in the mobile app, whose webview opens no sign-in pop-up', async () => {
    shell.isWeb = true;
    shell.isMobileShell = true;
    setOrgMode(true);
    await openWith();

    await screen.findByRole('button', { name: /^Build a custom connector Connect/ });
    expect(screen.queryByRole('button', { name: TILE })).toBeNull();
    expect(customMcpAvailable).not.toHaveBeenCalled();
  });

  it('hides the tile when main says custom MCP is not available', async () => {
    customMcpAvailable.mockResolvedValue(false);
    await openWith();

    await screen.findByRole('button', { name: /^Build a custom connector Connect/ });
    expect(screen.queryByRole('button', { name: TILE })).toBeNull();
  });

  it('hides the tile when main cannot answer', async () => {
    customMcpAvailable.mockRejectedValue(new Error('no bridge'));
    await openWith();

    await screen.findByRole('button', { name: /^Build a custom connector Connect/ });
    expect(screen.queryByRole('button', { name: TILE })).toBeNull();
  });

  it('never asks or offers it in org mode', async () => {
    setOrgMode(true);
    await openWith();

    expect(customMcpAvailable).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: TILE })).toBeNull();
  });

  it('offers the tile on the web in org mode when the server says it is available', async () => {
    shell.isWeb = true;
    setOrgMode(true);
    const onAddMcpUrl = await openWith();

    await userEvent.click(await screen.findByRole('button', { name: TILE }));

    expect(customMcpAvailable).toHaveBeenCalledTimes(1);
    expect(onAddMcpUrl).toHaveBeenCalledTimes(1);
  });

  it('hides the tile on the web in org mode when the server says it is not available', async () => {
    shell.isWeb = true;
    setOrgMode(true);
    customMcpAvailable.mockResolvedValue(false);
    await openWith();

    await waitFor(() => expect(customMcpAvailable).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: TILE })).toBeNull();
  });

  it('offers nothing to a host without the handler', async () => {
    await openWith({ onAddMcpUrl: undefined });

    await screen.findByRole('button', { name: /^Build a custom connector Connect/ });
    expect(customMcpAvailable).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: TILE })).toBeNull();
  });
});
