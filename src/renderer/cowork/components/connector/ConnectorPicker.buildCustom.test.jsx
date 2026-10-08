// Building a connector from the directory:
//   • a search with no match offers to build one for that name
//   • a permanent entry at the end serves people who browse instead
//   • a saved custom connector shows in Featured with a Custom badge
//   • org mode shows neither entry point (local installs only for now)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

const fetchConnectors = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));

import ConnectorPicker, { connectorInitials } from './ConnectorPicker';

const GMAIL = { id: 'gmail', label: 'Gmail', category: 'communication', featured: true };
const KINAXIS = {
  id: 'kinaxis', label: 'Kinaxis RapidResponse', category: 'erp', featured: true, custom: true,
  logo_color: '#3a7',
};

function section(title) {
  return screen.getByText(title, { exact: false }).closest('div').parentElement;
}

async function openWith(connectors, props = {}) {
  fetchConnectors.mockResolvedValue(connectors);
  const onBuildCustom = vi.fn();
  render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} onBuildCustom={onBuildCustom} {...props} />);
  await screen.findAllByText(connectors[0].label, { exact: false });
  return onBuildCustom;
}

afterEach(() => {
  setOrgMode(false);
  fetchConnectors.mockReset();
});

describe('ConnectorPicker build a custom connector', () => {
  it('offers to build the searched name when nothing matches', async () => {
    const onBuildCustom = await openWith([GMAIL]);

    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: '  Acme ERP ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build a custom connector for “Acme ERP”' }));

    expect(onBuildCustom).toHaveBeenCalledWith('Acme ERP');
  });

  it('shows no build button while the search still matches something', async () => {
    await openWith([GMAIL]);

    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'gma' } });

    expect(screen.queryByRole('button', { name: /Build a custom connector for/ })).toBeNull();
  });

  it('ends the list with a permanent entry that carries no query', async () => {
    const onBuildCustom = await openWith([GMAIL]);

    fireEvent.click(screen.getByRole('button', { name: /^Build a custom connector Connect a system/ }));

    expect(onBuildCustom).toHaveBeenCalledWith('');
  });

  it('lists a featured custom connector in Featured with a Custom badge and initials', async () => {
    await openWith([KINAXIS, GMAIL]);

    const tile = within(section('Featured')).getByRole('button', { name: /Kinaxis RapidResponse/ });
    expect(within(tile).getByText('Custom')).toBeTruthy();
    expect(within(tile).getByText('KR')).toBeTruthy();
  });

  it('shows neither entry point in org mode', async () => {
    setOrgMode(true);
    await openWith([GMAIL]);

    expect(screen.queryByText('Build a custom connector')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'acme' } });
    expect(screen.queryByRole('button', { name: /Build a custom connector/ })).toBeNull();
  });

  it('shows neither entry point when the host does not handle building', async () => {
    fetchConnectors.mockResolvedValue([GMAIL]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findAllByText('Gmail', { exact: false });

    expect(screen.queryByText('Build a custom connector')).toBeNull();
  });
});

describe('connectorInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(connectorInitials('Kinaxis RapidResponse')).toBe('KR');
    expect(connectorInitials('httpbin')).toBe('H');
    expect(connectorInitials('  acme  supply  chain ')).toBe('AS');
    expect(connectorInitials('')).toBe('?');
  });
});
