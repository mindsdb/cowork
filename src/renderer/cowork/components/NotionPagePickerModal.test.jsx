import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotionPagePickerModal from './NotionPagePickerModal';

const apiMock = vi.hoisted(() => ({ searchNotionPages: vi.fn() }));
vi.mock('../api', () => apiMock);

const TWO_WORKSPACES = [
  { name: 'mindsdb-ws', display_name: 'MindsDB' },
  { name: 'personal-ws', display_name: "Martyna's Space" },
];

function renderModal(connections = TWO_WORKSPACES) {
  const onConfirm = vi.fn();
  render(<NotionPagePickerModal open connections={connections} onClose={vi.fn()} onConfirm={onConfirm} />);
  return { onConfirm };
}

function search(text) {
  fireEvent.change(screen.getByLabelText('Search Notion pages'), { target: { value: text } });
}

beforeEach(() => vi.clearAllMocks());

describe('NotionPagePickerModal', () => {
  it('searches every workspace and labels results with their workspace', async () => {
    apiMock.searchNotionPages.mockImplementation(async (name) => (name === 'mindsdb-ws'
      ? [{ id: 'p1', title: 'ML Research', url: 'https://www.notion.so/p1', type: 'page' }]
      : [{ id: 'p2', title: 'Reading list', url: 'https://www.notion.so/p2', type: 'page' }]));
    renderModal();

    search('re');

    expect(await screen.findByText('ML Research')).toBeInTheDocument();
    expect(screen.getByText('Reading list')).toBeInTheDocument();
    expect(screen.getByText('MindsDB')).toBeInTheDocument();
    expect(apiMock.searchNotionPages.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['mindsdb-ws', 're'], ['personal-ws', 're'],
    ]);
  });

  it('does not search for a single character', async () => {
    renderModal();
    search('r');
    await new Promise((r) => setTimeout(r, 450));
    expect(apiMock.searchNotionPages).not.toHaveBeenCalled();
  });

  it('returns the selected pages with the connection they came from', async () => {
    apiMock.searchNotionPages.mockImplementation(async (name) => (name === 'mindsdb-ws'
      ? [{ id: 'p1', title: 'ML Research', url: 'https://www.notion.so/p1', type: 'page' }]
      : []));
    const { onConfirm } = renderModal();

    search('ml');
    fireEvent.click(await screen.findByRole('option', { name: /ML Research/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));

    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({
      id: 'p1', url: 'https://www.notion.so/p1', connectionName: 'mindsdb-ws', workspace: 'MindsDB',
    })]);
  });

  it("shows one workspace's results when another fails", async () => {
    apiMock.searchNotionPages.mockImplementation(async (name) => {
      if (name === 'personal-ws') throw new Error('Notion needs to be reconnected.');
      return [{ id: 'p1', title: 'ML Research', url: 'https://www.notion.so/p1', type: 'page' }];
    });
    renderModal();

    search('ml');

    expect(await screen.findByText('ML Research')).toBeInTheDocument();
    expect(screen.queryByText('Notion needs to be reconnected.')).not.toBeInTheDocument();
  });

  it('shows the error when every workspace fails', async () => {
    apiMock.searchNotionPages.mockRejectedValue(new Error('Notion needs to be reconnected.'));
    renderModal([TWO_WORKSPACES[0]]);

    search('ml');

    await waitFor(() => expect(screen.getByText('Notion needs to be reconnected.')).toBeInTheDocument());
  });
});
