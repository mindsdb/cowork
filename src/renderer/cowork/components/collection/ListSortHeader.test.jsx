import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ListSortHeader } from './ListSortHeader';

// A long list's sort header (ENG-4455): its labels sort as the pill does, a
// second click on a two-way column reverses it.
const COLUMNS = [
  { id: 'name', label: 'Name', sorts: ['name'] },
  { id: 'type', label: 'Type', sorts: ['type'] },
  { id: 'updated', label: 'Updated', sorts: ['recent', 'oldest'] },
];

function Harness({ initial = 'recent', onChange = vi.fn() }) {
  const [sort, setSort] = useState(initial);
  return <ListSortHeader columns={COLUMNS} value={sort} onChange={(next) => { setSort(next); onChange(next); }} />;
}

const button = (name) => screen.getByRole('button', { name: `Sort by ${name}` });

describe('ListSortHeader', () => {
  it('marks the column the list is sorted by', () => {
    render(<Harness />);
    expect(screen.getByRole('toolbar', { name: 'Sort the list' })).toBeInTheDocument();
    expect(button('Updated')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Name')).toHaveAttribute('aria-pressed', 'false');
  });

  it('sorts by a column on a click, and a second click reverses a two-way column', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(button('Name'));
    expect(onChange).toHaveBeenLastCalledWith('name');
    expect(button('Name')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button('Updated'));
    expect(onChange).toHaveBeenLastCalledWith('recent');
    fireEvent.click(button('Updated'));
    expect(onChange).toHaveBeenLastCalledWith('oldest');
    expect(button('Updated')).toHaveAttribute('aria-pressed', 'true');
  });

  it('does nothing on a click of the one-way column already in use', () => {
    const onChange = vi.fn();
    render(<Harness initial="type" onChange={onChange} />);
    fireEvent.click(button('Type'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
