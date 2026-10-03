// Characterization tests for the Cmd+K search modal: they pin focus on open,
// the debounced search call (App passes `searchCowork` as `onSearch`), result
// rendering with type badges, selecting a result, the hint / searching / no
// result / error states, and the ways to close it, so the move onto Dialog +
// Autocomplete keeps what it does. Queries go by role, label and visible text.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('lists results with title, subtitle and type badge', async () => {
    const { user } = setup();
    await user.type(input(), 'report');
    const task = await screen.findByRole('button', { name: /Quarterly report/ });
    expect(task).toHaveTextContent('Metrics project');
    expect(task).toHaveTextContent('task');
    expect(screen.getByRole('button', { name: /Reporting/ })).toHaveTextContent('project');
    expect(screen.getByRole('button', { name: /Report deck/ })).toHaveTextContent('artifact');
  });

  it('selects a result and closes', async () => {
    const { user, props } = setup();
    await user.type(input(), 'report');
    await user.click(await screen.findByRole('button', { name: /Reporting/ }));
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
});
