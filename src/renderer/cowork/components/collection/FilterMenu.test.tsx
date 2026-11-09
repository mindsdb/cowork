import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterChips, FilterMenu, type Filter } from './FilterMenu';

function filters(status = 'all', archived = false) {
  const onStatus = vi.fn();
  const onArchived = vi.fn();
  const list: Filter[] = [
    { id: 'status', label: 'Status', value: status, allValue: 'all', onChange: onStatus, options: [
      { value: 'all', label: 'All statuses' }, { value: 'failed', label: 'Failed' },
    ] },
    { id: 'archived', label: 'Archived', toggle: true, value: archived, onChange: onArchived },
  ];
  return { list, onStatus, onArchived };
}

describe('FilterMenu', () => {
  it('counts active facets on the button and shows the chosen value beside its facet', async () => {
    const user = userEvent.setup();
    render(<FilterMenu filters={filters('failed', true).list} />);
    await user.click(screen.getByRole('button', { name: 'Filter, 2 active' }));
    expect(screen.getByRole('menuitem', { name: /^Status/ })).toHaveTextContent('Failed');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Archived' })).toHaveAttribute('aria-checked', 'true');
  });

  it('picks an option from a facet submenu', async () => {
    const user = userEvent.setup();
    const { list, onStatus } = filters();
    render(<FilterMenu filters={list} />);
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    screen.getByRole('menuitem', { name: /^Status/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menuitemradio', { name: 'All statuses' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onStatus).toHaveBeenCalledWith('failed');
  });

  it('keeps a long facet list scrollable inside the viewport', async () => {
    const user = userEvent.setup();
    const options = Array.from({ length: 30 }, (_, i) => ({ value: `p${i}`, label: `Project ${i}` }));
    render(<FilterMenu filters={[{ id: 'project', label: 'Project', value: 'p0', allValue: 'p0', options, onChange: vi.fn() }]} />);
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    screen.getByRole('menuitem', { name: /^Project/ }).focus();
    await user.keyboard('{ArrowRight}');
    const list = (await screen.findByRole('menuitemradio', { name: 'Project 29' })).closest('[role="menu"]');
    // Layout is untestable in happy-dom; Chromium confirms these keep the last
    // option reachable by mouse wheel in a 768px-high window.
    expect(list?.className).toContain('max-h-[var(--available-height,_320px)]');
    expect(list?.className).toContain('overflow-y-auto');
  });

  it('flips a toggle and keeps the menu open for the next pick', async () => {
    const user = userEvent.setup();
    const { list, onArchived } = filters();
    render(<FilterMenu filters={list} />);
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Archived' }));
    expect(onArchived).toHaveBeenCalledWith(true);
    expect(screen.getByRole('menuitem', { name: /^Status/ })).toBeInTheDocument();
  });
});

describe('FilterChips', () => {
  it('renders nothing while no filter is active', () => {
    const { container } = render(<FilterChips filters={filters().list} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('removes one filter per chip and clears them all', async () => {
    const user = userEvent.setup();
    const { list, onStatus, onArchived } = filters('failed', true);
    const onClear = vi.fn();
    render(<FilterChips filters={list} onClear={onClear} />);
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent('StatusFailedArchived');
    await user.click(screen.getByRole('button', { name: 'Remove Status filter' }));
    expect(onStatus).toHaveBeenCalledWith('all');
    await user.click(screen.getByRole('button', { name: 'Remove Archived filter' }));
    expect(onArchived).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
