import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup, Radio } from './RadioGroup';

function Harness({ onChange = vi.fn(), disabled = false, initial = 'a' }: {
  onChange?: (value: string) => void;
  disabled?: boolean;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <RadioGroup
      aria-label="Letters"
      value={value}
      disabled={disabled}
      onValueChange={(next) => { setValue(next); onChange(next); }}
    >
      <Radio value="a"><span>Alpha</span></Radio>
      <Radio value="b"><span>Bravo</span></Radio>
      <Radio value="c" indicator="end"><span>Charlie</span></Radio>
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  it('names each row by its content and checks only the selected one', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Bravo' })).not.toBeChecked();
  });

  it('selects a row on click', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.getByRole('radio', { name: 'Charlie' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toBeChecked();
  });

  it('moves the selection with the arrow keys', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole('radio', { name: 'Alpha' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeChecked();
  });

  it('ignores clicks when the group is disabled', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} disabled />);
    const bravo = screen.getByRole('radio', { name: 'Bravo' });
    expect(bravo).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(bravo);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();
  });

  it('checks nothing when the value matches no option', () => {
    render(<Harness initial="" />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });
});
