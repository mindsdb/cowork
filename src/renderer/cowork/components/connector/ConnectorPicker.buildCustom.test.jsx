// Building a connector from the directory, offered only where the server says
// one would be kept, and never in org mode.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setOrgMode } from '../../../lib/orgMode';

const fetchConnectors = vi.fn();
const fetchCanBuildCustomConnector = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
  fetchCanBuildCustomConnector: (...args) => fetchCanBuildCustomConnector(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));

import ConnectorPicker from './ConnectorPicker';

const GMAIL = { id: 'gmail', label: 'Gmail', category: 'communication', featured: true };
const POSTGRES = { id: 'postgres', label: 'PostgreSQL', category: 'database' };
const AMINTA = {
  id: 'aminta', label: 'Aminta Planner', category: 'erp', featured: true, custom: true,
  logo_color: '#3a7',
};

async function chooseCategory(label) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Filter by' }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

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

beforeEach(() => {
  fetchCanBuildCustomConnector.mockResolvedValue(true);
});

afterEach(() => {
  setOrgMode(false);
  fetchConnectors.mockReset();
  fetchCanBuildCustomConnector.mockReset();
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

    const tiles = screen.getAllByRole('button').filter((b) => b.tagName === 'BUTTON' && b.closest('[class*="grid"]'));
    expect(tiles.at(-1)).toHaveAccessibleName(/^Build a custom connector Connect a system/);
    fireEvent.click(tiles.at(-1));

    expect(onBuildCustom).toHaveBeenCalledWith('');
  });

  it('keeps the permanent entry while a search still matches', async () => {
    await openWith([GMAIL]);

    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'gma' } });

    expect(screen.getByRole('button', { name: /^Build a custom connector Connect a system/ })).toBeTruthy();
  });

  it('keeps the permanent entry when the directory is empty', async () => {
    fetchConnectors.mockResolvedValue([]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} onBuildCustom={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /^Build a custom connector Connect a system/ })).toBeTruthy();
  });

  it('does not offer to build a connector the category filter is only hiding', async () => {
    await openWith([GMAIL, POSTGRES]);

    await chooseCategory('Communication');
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'postgres' } });

    expect(screen.queryByRole('button', { name: /Build a custom connector for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Build a custom connector Connect a system/ })).toBeNull();
    expect(screen.getByText(/No connectors in this category match/)).toBeTruthy();
  });

  it('lists a featured custom connector in Featured with a Custom badge and initials', async () => {
    await openWith([AMINTA, GMAIL]);

    const tile = within(section('Featured')).getByRole('button', { name: /Aminta Planner/ });
    expect(within(tile).getByText('Custom')).toBeTruthy();
    expect(within(tile).getByText('AP')).toBeTruthy();
  });

  it('shows neither entry point in org mode', async () => {
    setOrgMode(true);
    await openWith([GMAIL]);

    expect(screen.queryByText('Build a custom connector')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'acme' } });
    expect(screen.queryByRole('button', { name: /Build a custom connector/ })).toBeNull();
  });

  it('shows neither entry point where the server says a connector would not be kept', async () => {
    fetchCanBuildCustomConnector.mockResolvedValue(false);
    await openWith([GMAIL]);

    expect(fetchCanBuildCustomConnector).toHaveBeenCalled();
    expect(screen.queryByText('Build a custom connector')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'acme' } });
    expect(screen.queryByRole('button', { name: /Build a custom connector/ })).toBeNull();
  });

  it('shows neither entry point while the server has not answered', async () => {
    fetchCanBuildCustomConnector.mockReturnValue(new Promise(() => {}));
    await openWith([GMAIL]);

    expect(screen.queryByText('Build a custom connector')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'acme' } });
    expect(screen.queryByRole('button', { name: /Build a custom connector/ })).toBeNull();
  });

  it('asks again on each open and never shows the previous answer', async () => {
    fetchConnectors.mockResolvedValue([GMAIL]);
    const props = { onPick: vi.fn(), onClose: vi.fn(), onBuildCustom: vi.fn() };
    const { rerender } = render(<ConnectorPicker open {...props} />);
    expect(await screen.findByRole('button', { name: /^Build a custom connector Connect a system/ })).toBeTruthy();

    rerender(<ConnectorPicker open={false} {...props} />);
    let answer;
    fetchCanBuildCustomConnector.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    rerender(<ConnectorPicker open {...props} />);
    await screen.findAllByText('Gmail', { exact: false });

    expect(screen.queryByText('Build a custom connector')).toBeNull();
    await act(async () => answer(false));
    expect(fetchCanBuildCustomConnector).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Build a custom connector')).toBeNull();
  });

  it('ignores an answer that arrives after the picker was closed', async () => {
    fetchConnectors.mockResolvedValue([GMAIL]);
    const props = { onPick: vi.fn(), onClose: vi.fn(), onBuildCustom: vi.fn() };
    let firstAnswer;
    fetchCanBuildCustomConnector.mockReturnValueOnce(new Promise((resolve) => { firstAnswer = resolve; }));
    const { rerender } = render(<ConnectorPicker open {...props} />);
    await screen.findAllByText('Gmail', { exact: false });

    rerender(<ConnectorPicker open={false} {...props} />);
    fetchCanBuildCustomConnector.mockReturnValue(new Promise(() => {}));
    rerender(<ConnectorPicker open {...props} />);
    await screen.findAllByText('Gmail', { exact: false });
    await act(async () => firstAnswer(true));

    expect(screen.queryByText('Build a custom connector')).toBeNull();
  });

  it('shows neither entry point when the host does not handle building', async () => {
    fetchConnectors.mockResolvedValue([GMAIL]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findAllByText('Gmail', { exact: false });

    expect(screen.queryByText('Build a custom connector')).toBeNull();
  });
});
