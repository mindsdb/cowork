import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionState } from './CollectionState';
import { ViewToggle, useCollectionView } from './ViewToggle';

const EMPTY = { title: 'Nothing yet', description: 'Make one.' };

describe('CollectionState', () => {
  it('shows skeletons while loading, not the empty state or children', () => {
    render(<CollectionState loading total={0} shown={0} empty={EMPTY}><p>items</p></CollectionState>);
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Nothing yet')).not.toBeInTheDocument();
    expect(screen.queryByText('items')).not.toBeInTheDocument();
  });

  it('draws group skeleton rows inside a list group, so loading matches the loaded rows', () => {
    render(<CollectionState loading skeleton="group" skeletonCount={3} total={0} shown={0} empty={EMPTY} />);
    const group = screen.getByLabelText('Loading');
    expect(group.tagName).toBe('SECTION');
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(group.querySelector('.rounded-card').children).toHaveLength(3);
  });

  it('renders the given empty state when the collection has no items', () => {
    render(<CollectionState total={0} shown={0} empty={EMPTY}><p>items</p></CollectionState>);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByText('Make one.')).toBeInTheDocument();
    expect(screen.queryByText('items')).not.toBeInTheDocument();
  });

  it('outlines the empty and no-match states with an unfilled frame placed by empty.className', () => {
    const { rerender } = render(<CollectionState total={0} shown={0} empty={{ ...EMPTY, className: 'mx-8' }} />);
    const frame = screen.getByText('Nothing yet').closest('.rounded-card');
    expect(frame).toHaveClass('border', 'border-line', 'mx-8');
    expect(frame).not.toHaveClass('bg-surface');
    rerender(<CollectionState total={3} shown={0} empty={{ ...EMPTY, className: 'mx-8' }} />);
    expect(screen.getByText('No results').closest('.rounded-card')).toHaveClass('border-line', 'mx-8');
  });

  it('names the query when nothing matches and clears it on request', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<CollectionState total={3} shown={0} query=" logs " onClear={onClear} empty={EMPTY} />);
    expect(screen.getByText('No results for “logs”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('takes custom no-match copy and action label', () => {
    render(
      <CollectionState total={3} shown={0} onClear={() => {}} noMatchTitle="No tasks match these filters." clearLabel="Clear filters" empty={EMPTY} />,
    );
    expect(screen.getByText('No tasks match these filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('renders children when there are visible items', () => {
    render(<CollectionState total={3} shown={2} empty={EMPTY}><p>items</p></CollectionState>);
    expect(screen.getByText('items')).toBeInTheDocument();
  });
});

function Harness({ storageKey, defaultView }) {
  const { view, setView, effectiveView } = useCollectionView(storageKey, { defaultView });
  return (
    <>
      <ViewToggle value={view} onValueChange={setView} />
      <output>{effectiveView}</output>
    </>
  );
}

describe('ViewToggle + useCollectionView', () => {
  const KEY = 'test:collection-view';
  const width = window.innerWidth;
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => { window.innerWidth = width; });

  it('defaults to grid, persists the choice under the given key, and restores it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness storageKey={KEY} />);
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('status')).toHaveTextContent('list');
    expect(localStorage.getItem(KEY)).toBe('list');
    unmount();
    render(<Harness storageKey={KEY} />);
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('forces grid and hides the toggle on phones without touching the stored choice', () => {
    localStorage.setItem(KEY, 'list');
    window.innerWidth = 390;
    render(<Harness storageKey={KEY} />);
    expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('grid');
    expect(localStorage.getItem(KEY)).toBe('list');
  });

  it('starts on the page default and stores nothing until the user picks', () => {
    render(<Harness storageKey={KEY} defaultView="list" />);
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a stored grid choice over a list default', () => {
    localStorage.setItem(KEY, 'grid');
    render(<Harness storageKey={KEY} defaultView="list" />);
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('gives phones the page default', () => {
    localStorage.setItem(KEY, 'grid');
    window.innerWidth = 390;
    render(<Harness storageKey={KEY} defaultView="list" />);
    expect(screen.getByRole('status')).toHaveTextContent('list');
    expect(localStorage.getItem(KEY)).toBe('grid');
  });
});
