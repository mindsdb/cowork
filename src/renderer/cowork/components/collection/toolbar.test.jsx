import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchInput } from './SearchInput';
import { SortPill } from './SortPill';

const OPTIONS = [{ id: 'recent', label: 'Recent' }, { id: 'name', label: 'Name' }];

describe('SortPill', () => {
  it('reads "Sort: <current>" and reports the picked option id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortPill value="recent" onChange={onChange} options={OPTIONS} />);
    const pill = screen.getByRole('combobox', { name: 'Sort' });
    expect(pill).toHaveTextContent('Sort:Recent');
    await user.click(pill);
    await user.click(screen.getByRole('option', { name: 'Name' }));
    expect(onChange).toHaveBeenCalledWith('name');
  });

  it('shows the first option for an unknown value and takes a custom label', () => {
    render(<SortPill value="gone" onChange={() => {}} options={OPTIONS} label="Order" />);
    expect(screen.getByRole('combobox', { name: 'Order' })).toHaveTextContent('Order:Recent');
  });
});

describe('SearchInput', () => {
  it('forwards the ref to the input and reports the typed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ref = createRef();
    render(<SearchInput value="" onChange={onChange} inputRef={ref} placeholder="Search tasks" />);
    const input = screen.getByRole('textbox', { name: 'Search tasks' });
    expect(ref.current).toBe(input);
    await user.type(input, 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it.each([[undefined, true], ['', false], [null, false]])('shortcut=%j shows the ⌘K hint: %s', (shortcut, shown) => {
    render(<SearchInput value="" onChange={() => {}} {...(shortcut === undefined ? {} : { shortcut })} />);
    expect(!!screen.queryByText('⌘K')).toBe(shown);
  });
});
