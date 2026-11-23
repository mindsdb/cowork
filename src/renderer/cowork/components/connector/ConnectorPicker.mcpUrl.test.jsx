// Adding an MCP server by URL from the directory: offered only when the
// desktop app's main process says the server keeps custom MCP settings, and
// never in org mode.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setOrgMode } from '../../../lib/orgMode';

const fetchConnectors = vi.fn();
const fetchCanBuildCustomConnector = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
  fetchCanBuildCustomConnector: (...args) => fetchCanBuildCustomConnector(...args),
}));
const customMcpAvailable = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn(), customMcpAvailable },
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

  it('offers nothing to a host without the handler', async () => {
    await openWith({ onAddMcpUrl: undefined });

    await screen.findByRole('button', { name: /^Build a custom connector Connect/ });
    expect(customMcpAvailable).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: TILE })).toBeNull();
  });
});
