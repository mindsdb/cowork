// Characterization tests for the Cmd+K search modal: they pin focus on open,
// the debounced search call (App passes `searchCowork` as `onSearch`), result
// rendering with type badges, selecting a result, the hint / searching / no
// result / error states, and the ways to close it, so the move onto Dialog +
// Autocomplete keeps what it does. Queries go by role, label and visible text.
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SearchModal from './SearchModal';

const RESULTS = [
  { type: 'task', id: 't1', title: 'Quarterly report', subtitle: 'Metrics project' },
  { type: 'project', id: 'p1', title: 'Reporting', subtitle: '3 tasks' },
  { type: 'artifact', id: 'a1', title: 'Report deck', subtitle: 'deck.pptx' },
];

function setup(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onSearch: vi.fn().mockResolvedValue({ results: RESULTS }),
    onSelect: vi.fn(),
    ...overrides,
  };
  return { ...render(<SearchModal {...props} />), props, user: userEvent.setup() };
}

const input = () => screen.getByLabelText('Search MindsHub Cowork');

describe('SearchModal', () => {
  it('renders nothing while closed', () => {
    setup({ open: false });
    expect(screen.queryByLabelText('Search MindsHub Cowork')).not.toBeInTheDocument();
  });

  it('focuses the search field on open and explains what is searchable', async () => {
    setup();
    await waitFor(() => expect(input()).toHaveFocus());
    expect(screen.getByText(/Tasks, projects, artifacts, attachments, schedules, and pins are searchable/)).toBeInTheDocument();
  });

  it('searches once with the full query after typing settles', async () => {
    const { user, props } = setup();
    await user.type(input(), 'report');
    expect(props.onSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(props.onSearch).toHaveBeenCalledTimes(1));
    expect(props.onSearch).toHaveBeenCalledWith('report');
  });

  it('does not search for a blank query', async () => {
    const { user, props } = setup();
    await user.type(input(), '   ');
    await new Promise((r) => setTimeout(r, 250));
    expect(props.onSearch).not.toHaveBeenCalled();
  });

  it('lists results with title and subtitle under a heading for their type', async () => {
    const { user } = setup();
    await user.type(input(), 'report');
    const task = await screen.findByRole('option', { name: /Quarterly report/ });
    expect(task).toHaveTextContent('Metrics project');
    expect(within(screen.getByRole('group', { name: 'Tasks' })).getByRole('option', { name: /Quarterly report/ })).toBe(task);
    expect(within(screen.getByRole('group', { name: 'Projects' })).getByRole('option', { name: /Reporting/ })).toHaveTextContent('3 tasks');
    expect(within(screen.getByRole('group', { name: 'Artifacts' })).getByRole('option', { name: /Report deck/ })).toHaveTextContent('deck.pptx');
  });

  it('selects a result and closes', async () => {
    const { user, props } = setup();
    await user.type(input(), 'report');
    await user.click(await screen.findByRole('option', { name: /Reporting/ }));
    expect(props.onSelect).toHaveBeenCalledWith(RESULTS[1]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Searching... while the search is in flight', async () => {
    let resolve;
    const { user } = setup({ onSearch: vi.fn(() => new Promise((r) => { resolve = r; })) });
    await user.type(input(), 'report');
    expect(await screen.findByText('Searching...')).toBeInTheDocument();
    resolve({ results: [] });
    expect(await screen.findByText('No MindsHub Cowork results found.')).toBeInTheDocument();
    expect(screen.queryByText('Searching...')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const { user } = setup({ onSearch: vi.fn().mockResolvedValue({ results: [] }) });
    await user.type(input(), 'zzz');
    expect(await screen.findByText('No MindsHub Cowork results found.')).toBeInTheDocument();
  });

  it('shows the error when the search fails', async () => {
    const { user } = setup({ onSearch: vi.fn().mockRejectedValue(new Error('Search is down')) });
    await user.type(input(), 'report');
    expect(await screen.findByText('Search is down')).toBeInTheDocument();
    expect(screen.queryByText('No MindsHub Cowork results found.')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const { user, props } = setup();
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the Close button', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('is a labelled dialog', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Search' })).toContainElement(input());
  });

  it('groups by type in order of first appearance, keeping server order inside a group', async () => {
    const mixed = [
      { type: 'project', id: 'p1', title: 'Alpha project' },
      { type: 'task', id: 't1', title: 'First task' },
      { type: 'project', id: 'p2', title: 'Beta project' },
      { type: 'task', id: 't2', title: 'Second task' },
    ];
    const { user } = setup({ onSearch: vi.fn().mockResolvedValue({ results: mixed }) });
    await user.type(input(), 'a');
    await screen.findByRole('option', { name: /Alpha project/ });
    expect(screen.getAllByRole('group').map((g) => within(g).getAllByRole('option').map((o) => o.textContent)))
      .toEqual([['Alpha project', 'Beta project'], ['First task', 'Second task']]);
    expect(screen.getByRole('group', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('highlights the first result and moves with the arrow keys, wrapping at both ends', async () => {
    const { user } = setup();
    await user.type(input(), 'report');
    const [task, project, artifact] = await Promise.all([
      screen.findByRole('option', { name: /Quarterly report/ }),
      screen.findByRole('option', { name: /Reporting/ }),
      screen.findByRole('option', { name: /Report deck/ }),
    ]);
    await waitFor(() => expect(task).toHaveAttribute('data-highlighted'));
    await user.keyboard('{ArrowDown}');
    expect(project).toHaveAttribute('data-highlighted');
    await user.keyboard('{ArrowDown}');
    expect(artifact).toHaveAttribute('data-highlighted');
    await user.keyboard('{ArrowDown}');
    expect(task).toHaveAttribute('data-highlighted');
    await user.keyboard('{ArrowUp}');
    expect(artifact).toHaveAttribute('data-highlighted');
    expect(input()).toHaveFocus();
  });

  it('opens the highlighted result on Enter', async () => {
    const { user, props } = setup();
    await user.type(input(), 'report');
    await screen.findByRole('option', { name: /Reporting/ });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(RESULTS[1]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('highlights a result on hover', async () => {
    const { user } = setup();
    await user.type(input(), 'report');
    const deck = await screen.findByRole('option', { name: /Report deck/ });
    fireEvent.mouseMove(deck, { movementX: 2, movementY: 2 });
    expect(deck).toHaveAttribute('data-highlighted');
  });

  it('closes on a press outside the dialog', async () => {
    const { user, props } = setup();
    await waitFor(() => expect(input()).toHaveFocus());
    await user.click(document.body);
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('shows the keyboard hints', () => {
    setup();
    expect(screen.getByText(/to navigate/)).toBeInTheDocument();
    expect(screen.getByText(/to open/)).toBeInTheDocument();
    expect(screen.getByText(/to close/)).toBeInTheDocument();
  });

  it('returns focus to the opener when it closes', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open search</button>
          <SearchModal open={open} onClose={() => setOpen(false)} onSearch={vi.fn()} onSelect={vi.fn()} />
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'Open search' });
    await user.click(opener);
    await waitFor(() => expect(input()).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  describe('recents before typing', () => {
    const RECENTS = [
      { type: 'task', id: 't9', title: 'Churn summary', subtitle: 'Metrics' },
      { type: 'task', id: 't8', title: 'Board deck numbers' },
      { type: 'project', id: 'p9', title: 'Website refresh' },
    ];

    it('lists recent tasks and projects under their headings instead of the hint', () => {
      setup({ recents: RECENTS });
      expect(screen.getByText('Recent tasks')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Churn summary/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Website refresh/ })).toBeInTheDocument();
      expect(screen.queryByText(/are searchable/)).toBeNull();
    });

    it('opens a recent item with the arrow keys and Enter, without searching', async () => {
      const { user, props } = setup({ recents: RECENTS });
      await user.keyboard('{ArrowDown}{Enter}');
      expect(props.onSelect).toHaveBeenCalledWith(RECENTS[1]);
      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(props.onSearch).not.toHaveBeenCalled();
    });

    it('replaces recents with search results once a query is typed', async () => {
      const { user } = setup({ recents: RECENTS });
      await user.type(input(), 'report');
      expect(await screen.findByRole('option', { name: /Quarterly report/ })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Churn summary/ })).toBeNull();
      expect(screen.queryByText('Recent tasks')).toBeNull();
    });

    it('shows the hint when there are no recents', () => {
      setup({ recents: [] });
      expect(screen.getByText(/are searchable/)).toBeInTheDocument();
    });
  });
});
